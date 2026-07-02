import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { FREE_DAILY, HOLDER_MIN_MONSHI, MODES, MONSHI_SYSTEM, OPEN_BETA, monshiBalance, veniceChat, verifyStudioSig } from '@/lib/studioServer';

// Monshi Studio chat/code. Auth = daily wallet signature. Holders get FREE_DAILY
// capped chats/day on the cheap model at 0 credits; otherwise (and for code mode)
// credits are debited BEFORE the AI call at the flat per-call price (>= 3x provider
// worst-case — max_tokens is server-enforced so the worst case is known).

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const today = () => new Date().toISOString().slice(0, 10);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Studio storage not configured' });

  const b = (req.body || {}) as Record<string, any>;
  const wallet = lc(b.wallet);
  const wantMode = b.mode === 'code' ? 'code' : 'chat';
  if (!isAddr(wallet)) return res.status(400).json({ error: 'invalid wallet' });
  if (!(await verifyStudioSig(wallet, String(b.signature || '')))) return res.status(401).json({ error: 'bad signature — sign in again' });

  // Sanitize history: last 12 turns, plain strings, each clipped.
  const history = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'no message' });

  const [{ data: acct }, monshi] = await Promise.all([
    supabase.from('studio_accounts').select('*').eq('wallet', wallet).maybeSingle(),
    monshiBalance(wallet),
  ]);
  const holder = monshi >= HOLDER_MIN_MONSHI;
  const hasAccess = (acct?.access ?? false) || holder || OPEN_BETA;
  if (!hasAccess) return res.status(402).json({ error: 'unlock Monshi Studio first' });

  // Pick the lane: holders (and everyone during open beta) ride the free model
  // until the daily cap, then credits.
  const freeEligible = holder || OPEN_BETA;
  const freeUsed = acct?.free_date === today() ? (acct?.free_used ?? 0) : 0;
  const useFree = wantMode === 'chat' && freeEligible && freeUsed < FREE_DAILY;
  const mode = useFree ? 'free' : wantMode;
  const cfg = MODES[mode as keyof typeof MODES];
  const credits = acct?.credits ?? 0;
  if (cfg.credits > 0 && credits < cfg.credits) {
    return res.status(402).json({ error: `needs ${cfg.credits} credits — top up`, credits });
  }

  // Debit BEFORE the provider call (no free rides on errors we can't attribute).
  const newCredits = credits - cfg.credits;
  const { error: upErr } = await supabase.from('studio_accounts').upsert({
    wallet, credits: newCredits,
    access: acct?.access ?? false,
    free_used: useFree ? freeUsed + 1 : freeUsed,
    free_date: useFree ? today() : (acct?.free_date ?? null),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wallet' });
  if (upErr) return res.status(500).json({ error: upErr.message });

  try {
    const sys = mode === 'code'
      ? `${MONSHI_SYSTEM} You are in CODE mode: produce correct, complete, runnable code with brief explanations.`
      : MONSHI_SYSTEM;
    const reply = await veniceChat(cfg.model, [{ role: 'system', content: sys }, ...history], cfg.maxTokens);
    await supabase.from('studio_usage').insert({ wallet, mode, model: cfg.model, credits: cfg.credits });
    return res.status(200).json({
      reply, mode, charged: cfg.credits, credits: newCredits,
      freeLeft: freeEligible ? Math.max(0, FREE_DAILY - (useFree ? freeUsed + 1 : freeUsed)) : 0,
    });
  } catch (e: any) {
    // Provider failed — refund the debit.
    await supabase.from('studio_accounts').update({ credits, free_used: freeUsed, updated_at: new Date().toISOString() }).eq('wallet', wallet);
    return res.status(502).json({ error: String(e?.message || 'AI unavailable').slice(0, 160) });
  }
}
