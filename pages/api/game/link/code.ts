import type { NextApiRequest, NextApiResponse } from 'next';
import { randomInt } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { gameKeyOk } from '@/lib/gameAuth';

// POST /api/game/link/code  { tg_id }  (x-game-key)  ->  { code, expires_in }
// The bot asks for a short code for a Telegram user; the player confirms it with their wallet in the game.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_SECS = 600;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  if (!gameKeyOk(req.headers['x-game-key'] as string | undefined)) return res.status(401).json({ error: 'unauthorized' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });
  const tg = String((req.body || {}).tg_id || '');
  if (!/^\d{1,20}$/.test(tg)) return res.status(400).json({ error: 'tg_id required' });
  await supabase.from('game_link_codes').delete().eq('tg_id', tg);
  const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const { error } = await supabase.from('game_link_codes').insert({ code, tg_id: tg, expires_at: new Date(Date.now() + TTL_SECS * 1000).toISOString() });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ code, expires_in: TTL_SECS });
}
