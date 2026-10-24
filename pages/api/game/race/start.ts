import type { NextApiRequest, NextApiResponse } from 'next';
import { randomInt } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { RACE_SECS } from '@/lib/gameLoadout';

// POST /api/game/race/start  { wallet }  ->  { ticket, seed }
// The server picks the seed and starts the clock. A wallet has at most one open ticket;
// asking again within a race's length returns the same ticket.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });
  const wallet = lc(String((req.body || {}).wallet || ''));
  if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });

  const since = new Date(Date.now() - (RACE_SECS + 30) * 1000).toISOString();
  const { data: open } = await supabase.from('game_races').select('id,seed').eq('wallet', wallet).is('claimed_at', null).gte('started_at', since).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (open) return res.status(200).json({ ticket: open.id, seed: Number(open.seed) });

  const seed = randomInt(1, 2 ** 31 - 1);
  const { data, error } = await supabase.from('game_races').insert({ wallet, seed }).select('id,seed').single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ticket: data.id, seed: Number(data.seed) });
}
