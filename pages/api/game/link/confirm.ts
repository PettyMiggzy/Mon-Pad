import type { NextApiRequest, NextApiResponse } from 'next';
import { recoverMessageAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// POST /api/game/link/confirm  { wallet, code, signature }  ->  { ok: true }
// The wallet signs linkMessage(code); the code was issued to a Telegram user by the bot.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
export const linkMessage = (code: string) => `Mon-Pad Munchy Kart: link Telegram with code ${code}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });
  const b = (req.body || {}) as Record<string, any>;
  const wallet = lc(b.wallet);
  const code = String(b.code || '').trim().toUpperCase();
  if (!isAddr(wallet) || !/^[A-Z0-9]{6}$/.test(code)) return res.status(400).json({ error: 'wallet and 6-character code required' });
  try {
    const signer = lc(await recoverMessageAddress({ message: linkMessage(code), signature: b.signature }));
    if (signer !== wallet) return res.status(401).json({ error: 'bad signature' });
  } catch { return res.status(401).json({ error: 'bad signature' }); }

  const { data: row } = await supabase.from('game_link_codes').select('tg_id,expires_at').eq('code', code).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return res.status(404).json({ error: 'code not found or expired' });
  // One Telegram account per wallet and one wallet per Telegram account; re-linking replaces the old pairing.
  await supabase.from('game_links').delete().or(`wallet.eq.${wallet},tg_id.eq.${row.tg_id}`);
  const { error } = await supabase.from('game_links').insert({ tg_id: row.tg_id, wallet });
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('game_link_codes').delete().eq('code', code);
  return res.status(200).json({ ok: true });
}
