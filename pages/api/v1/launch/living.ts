import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isAddr, lc } from '@/lib/launchAgent/account';

// GET /api/v1/launch/living?token=0x… -> the finished 3D character for a token (if it has one).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = lc(String(req.query.token || ''));
  if (!isAddr(token)) return res.status(400).json({ error: 'invalid token' });
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(200).json({ glb: null });
  const { data } = await supabase.from('launch_characters').select('glb_url,rigged').eq('token', token).eq('stage', 'ready').order('created_at', { ascending: false }).limit(1).maybeSingle();
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json({ glb: data?.glb_url || null, rigged: !!data?.rigged });
}
