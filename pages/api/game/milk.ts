import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// GET  /api/game/milk?wallet=0x…  -> { wallet, milk }   (public, read-only; the bot uses this)
// POST /api/game/milk             -> body { wallet, delta }  header x-game-key: GAME_API_KEY
//   Trusted server-side credit/debit (game results, bot rewards). Balance never goes below 0.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const MAX_DELTA = 1_000_000;

function keyOk(got: string | undefined) {
  const want = process.env.GAME_API_KEY;
  if (!want || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });

  if (req.method === 'GET') {
    const wallet = lc(String(req.query.wallet || ''));
    if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });
    const { data, error } = await supabase.from('game_players').select('milk').eq('wallet', wallet).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ wallet, milk: Number(data?.milk ?? 0) });
  }

  if (req.method === 'POST') {
    if (!keyOk(req.headers['x-game-key'] as string | undefined)) return res.status(401).json({ error: 'unauthorized' });
    const b = (req.body || {}) as Record<string, any>;
    const wallet = lc(b.wallet);
    const delta = Math.trunc(Number(b.delta));
    if (!isAddr(wallet) || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
      return res.status(400).json({ error: 'wallet and non-zero delta (|delta| <= 1000000) required' });
    }
    const { data, error } = await supabase.rpc('game_adjust_milk', { p_wallet: wallet, p_delta: delta });
    if (error) return res.status(error.message.includes('insufficient') ? 409 : 500).json({ error: error.message });
    return res.status(200).json({ wallet, milk: Number(data) });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}
