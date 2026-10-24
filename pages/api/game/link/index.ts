import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { gameKeyOk } from '@/lib/gameAuth';

// GET /api/game/link?tg_id=123  (x-game-key)  ->  { wallet, milk } or 404 when not linked. Used by the bot.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  if (!gameKeyOk(req.headers['x-game-key'] as string | undefined)) return res.status(401).json({ error: 'unauthorized' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });
  const tg = String(req.query.tg_id || '');
  if (!/^\d{1,20}$/.test(tg)) return res.status(400).json({ error: 'tg_id required' });
  const { data: link } = await supabase.from('game_links').select('wallet').eq('tg_id', tg).maybeSingle();
  if (!link) return res.status(404).json({ error: 'not linked' });
  const { data: p } = await supabase.from('game_players').select('milk').eq('wallet', link.wallet).maybeSingle();
  return res.status(200).json({ wallet: link.wallet, milk: Number(p?.milk ?? 0) });
}
