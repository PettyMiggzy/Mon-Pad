import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HOLDER_MIN_MONSHI, MODES, OPEN_BETA, monshiBalance, veniceVideoPoll, veniceVideoStart, verifyStudioSig } from '@/lib/studioServer';

// Monshi Studio video (top tier — does everything cheaper tiers do, plus video).
// Async: action:'start' debits credits + queues (charge only on a successful queue);
// action:'poll' checks the queue and returns the mp4 when ready. Debit is on start,
// refunded if the queue call itself fails.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
export const config = { api: { responseLimit: '16mb' } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Studio storage not configured' });

  const b = (req.body || {}) as Record<string, any>;
  const wallet = lc(b.wallet);
  if (!isAddr(wallet)) return res.status(400).json({ error: 'invalid wallet' });
  if (!(await verifyStudioSig(wallet, String(b.signature || '')))) return res.status(401).json({ error: 'bad signature — sign in again' });
  const cfg = MODES.video;

  // Poll: no charge, just check the queue.
  if (b.action === 'poll') {
    const queueId = String(b.queueId || '');
    if (!queueId) return res.status(400).json({ error: 'queueId required' });
    try {
      const r = await veniceVideoPoll(cfg.model, queueId);
      return res.status(200).json(r);
    } catch (e: any) { return res.status(502).json({ error: String(e?.message || 'video poll failed').slice(0, 160) }); }
  }

  // Start: verify access + credits, debit, queue.
  const prompt = String(b.prompt || '').trim();
  if (prompt.length < 3) return res.status(400).json({ error: 'prompt required' });
  const [{ data: acct }, monshi] = await Promise.all([
    supabase.from('studio_accounts').select('*').eq('wallet', wallet).maybeSingle(),
    monshiBalance(wallet),
  ]);
  if (!((acct?.access ?? false) || monshi >= HOLDER_MIN_MONSHI || OPEN_BETA)) return res.status(402).json({ error: 'unlock Monshi Studio first' });
  const credits = acct?.credits ?? 0;
  if (credits < cfg.credits) return res.status(402).json({ error: `needs ${cfg.credits} credits — top up`, credits });

  const newCredits = credits - cfg.credits;
  const { error: upErr } = await supabase.from('studio_accounts').update({ credits: newCredits, updated_at: new Date().toISOString() }).eq('wallet', wallet);
  if (upErr) return res.status(500).json({ error: upErr.message });

  try {
    const queueId = await veniceVideoStart(cfg.model, prompt);
    await supabase.from('studio_usage').insert({ wallet, mode: 'video', model: cfg.model, credits: cfg.credits });
    return res.status(200).json({ queueId, charged: cfg.credits, credits: newCredits });
  } catch (e: any) {
    await supabase.from('studio_accounts').update({ credits, updated_at: new Date().toISOString() }).eq('wallet', wallet);
    return res.status(502).json({ error: String(e?.message || 'video unavailable').slice(0, 160) });
  }
}
