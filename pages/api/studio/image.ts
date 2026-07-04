import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { HOLDER_MIN_MONSHI, MODES, OPEN_BETA, monshiBalance, veniceImage, verifyStudioSig } from '@/lib/studioServer';

// Monshi Studio image generation (flux via Venice). Always credit-priced — there is
// no free image tier. Debit before the call; refund on provider failure.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));

export const config = { api: { responseLimit: '8mb' } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST only' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Studio storage not configured' });

  const b = (req.body || {}) as Record<string, any>;
  const wallet = lc(b.wallet);
  const prompt = String(b.prompt || '').trim();
  if (!isAddr(wallet)) return res.status(400).json({ error: 'invalid wallet' });
  if (!prompt || prompt.length < 3) return res.status(400).json({ error: 'prompt required' });
  if (!(await verifyStudioSig(wallet, String(b.signature || '')))) return res.status(401).json({ error: 'bad signature — sign in again' });

  const cfg = MODES.image;
  const [{ data: acct }, monshi] = await Promise.all([
    supabase.from('studio_accounts').select('*').eq('wallet', wallet).maybeSingle(),
    monshiBalance(wallet),
  ]);
  if (!((acct?.access ?? false) || monshi >= HOLDER_MIN_MONSHI || OPEN_BETA)) return res.status(402).json({ error: 'unlock Monshi Studio first' });
  const credits = acct?.credits ?? 0;

  // Atomic conditional debit (see chat.ts): the `credits >= cost` guard runs under the
  // row lock, so concurrent image requests can't all spend the same balance.
  const { data: spent, error: spendErr } = await supabase.rpc('studio_spend_credits', { p_wallet: wallet, p_cost: cfg.credits });
  if (spendErr) return res.status(500).json({ error: spendErr.message });
  if (spent === null || spent === undefined) return res.status(402).json({ error: `needs ${cfg.credits} credits — top up`, credits });
  const newCredits = Number(spent);

  try {
    const image = await veniceImage(cfg.model, prompt);
    await supabase.from('studio_usage').insert({ wallet, mode: 'image', model: cfg.model, credits: cfg.credits });
    return res.status(200).json({ image, charged: cfg.credits, credits: newCredits });
  } catch (e: any) {
    await supabase.rpc('studio_add_credits', { p_wallet: wallet, p_amount: cfg.credits }); // relative refund
    return res.status(502).json({ error: String(e?.message || 'image generation unavailable').slice(0, 160) });
  }
}
