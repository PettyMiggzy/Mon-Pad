import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// GET /api/game/leaderboard -> { rows: [{ wallet, milk, best, races }] }  top 20 by best score, public and read-only.
// Wallets are shortened server-side; nothing else about a player is exposed.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(200).json({ rows: [] });
  const { data, error } = await supabase.from('game_players').select('wallet, milk, best, races').order('best', { ascending: false }).order('milk', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: 'leaderboard unavailable' });
  const rows = (data || []).filter((r: any) => (r.best || 0) > 0 || (r.races || 0) > 0).map((r: any) => ({ player: `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}`, milk: Number(r.milk), best: Number(r.best), races: Number(r.races) }));
  return res.status(200).json({ rows });
}
