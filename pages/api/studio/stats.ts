import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MODES, MON_USD, verifyStudioSig } from '@/lib/studioServer';
import { isAdmin } from '@/lib/constants';

// Monshi Studio revenue dashboard (admins only). Aggregates:
//   • MON in (access unlocks + credit top-ups) → gross USD
//   • credits sold vs credits spent → outstanding liability
//   • provider cost = sum of worst-case model cost per call (MODES[mode].estUsd)
//   • margin = revenue recognized (credits burned × $0.01) − provider cost
// The whole point of the 3x pricing: this margin multiple must stay well above 1.
// Auth: admin wallet (constants) + the same daily Studio signature the UI already has.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const est = (mode: string) => (MODES as any)[mode]?.estUsd ?? 0;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Studio storage not configured' });

  const b = (req.body || {}) as Record<string, any>;
  const wallet = lc(b.wallet);
  if (!isAddr(wallet)) return res.status(400).json({ error: 'invalid wallet' });
  if (!isAdmin(wallet)) return res.status(403).json({ error: 'admins only' });
  if (!(await verifyStudioSig(wallet, String(b.signature || '')))) return res.status(401).json({ error: 'bad signature — sign in again' });

  const [{ data: pays }, { data: usage }, { data: accts }] = await Promise.all([
    supabase.from('studio_payments').select('mon, kind, credits, created_at'),
    supabase.from('studio_usage').select('mode, credits, created_at'),
    supabase.from('studio_accounts').select('credits, access'),
  ]);

  const P = pays || [], U = usage || [], A = accts || [];
  const now = Date.now();
  const since = (ms: number) => (row: any) => now - new Date(row.created_at).getTime() <= ms;
  const DAY = 86_400_000;

  // ── Revenue in (MON paid to treasury) ──────────────────────────────────────
  const monIn = P.reduce((s, p) => s + num(p.mon), 0);
  const accessPays = P.filter((p) => p.kind === 'access');
  const creditPays = P.filter((p) => p.kind === 'credits');
  const creditsSold = P.reduce((s, p) => s + num(p.credits), 0);
  const monIn24h = P.filter(since(DAY)).reduce((s, p) => s + num(p.mon), 0);
  const monIn7d = P.filter(since(7 * DAY)).reduce((s, p) => s + num(p.mon), 0);

  // ── Usage / cost ───────────────────────────────────────────────────────────
  const creditsSpent = U.reduce((s, u) => s + num(u.credits), 0);
  const providerCostUsd = U.reduce((s, u) => s + est(u.mode), 0);
  const revenueRecognizedUsd = creditsSpent * 0.01; // credits burned at $0.01 face

  const byMode = Object.keys(MODES).map((mode) => {
    const rows = U.filter((u) => u.mode === mode);
    const credits = rows.reduce((s, u) => s + num(u.credits), 0);
    const costUsd = rows.length * est(mode);
    return { mode, calls: rows.length, credits, revenueUsd: credits * 0.01, costUsd };
  }).filter((m) => m.calls > 0).sort((a, b) => b.calls - a.calls);

  const marginUsd = revenueRecognizedUsd - providerCostUsd;
  const marginMultiple = providerCostUsd > 0 ? revenueRecognizedUsd / providerCostUsd : null;

  return res.status(200).json({
    monUsd: MON_USD,
    revenue: {
      monIn, grossUsd: monIn * MON_USD, monIn24h, monIn7d,
      accessUnlocks: accessPays.length,
      creditTopups: creditPays.length,
      creditsSold,
    },
    usage: {
      totalCalls: U.length,
      calls24h: U.filter(since(DAY)).length,
      calls7d: U.filter(since(7 * DAY)).length,
      creditsSpent,
      providerCostUsd,
      revenueRecognizedUsd,
      marginUsd,
      marginMultiple, // target: >= 3
    },
    liability: {
      creditsOutstanding: A.reduce((s, a) => s + num(a.credits), 0),
      creditsOutstandingUsd: A.reduce((s, a) => s + num(a.credits), 0) * 0.01,
    },
    accounts: {
      total: A.length,
      paid: A.filter((a) => a.access).length,
    },
    byMode,
  });
}
