import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { MAX_MILK_PER_RACE, MIN_CLAIM_SECS } from '@/lib/gameLoadout';

// POST /api/game/race/claim  { ticket, milk }  ->  { milk: <new balance> }
// Credits the ticket's wallet once. The server checks the race ran long enough and the milk is within
// the most a race can give; it does not yet replay the race, so a tampered client can still claim up to the cap.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });
  const b = (req.body || {}) as Record<string, any>;
  const ticket = String(b.ticket || '');
  const milk = Math.trunc(Number(b.milk));
  if (!/^[0-9a-f-]{36}$/i.test(ticket) || !Number.isFinite(milk) || milk < 0) return res.status(400).json({ error: 'ticket and milk required' });
  const { data, error } = await supabase.rpc('game_claim_race', { p_id: ticket, p_milk: milk, p_min_secs: MIN_CLAIM_SECS, p_max_milk: MAX_MILK_PER_RACE });
  if (error) {
    const known = ['unknown ticket', 'already claimed', 'too fast', 'milk out of range'].find((m) => error.message.includes(m));
    return res.status(known ? 409 : 500).json({ error: known || error.message });
  }
  return res.status(200).json({ milk: Number(data) });
}
