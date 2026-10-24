import type { NextApiRequest, NextApiResponse } from 'next';
import { recoverMessageAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { loadoutMessage, sanitizeLoadout } from '@/lib/gameLoadout';

// GET  /api/game/loadout?wallet=0x…  -> { wallet, loadout, milk, nonce }
// PUT  /api/game/loadout             -> body { wallet, loadout, signature } signed over loadoutMessage(wallet, nonce)
// Milk is never written here — it only changes through /api/game/milk.

const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Game storage not configured' });

  if (req.method === 'GET') {
    const wallet = lc(String(req.query.wallet || ''));
    if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });
    const { data, error } = await supabase.from('game_players').select('wallet,milk,loadout,nonce').eq('wallet', wallet).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data ? { ...data, milk: Number(data.milk) } : { wallet, milk: 0, loadout: sanitizeLoadout({}), nonce: 0 });
  }

  if (req.method === 'PUT') {
    const b = (req.body || {}) as Record<string, any>;
    const wallet = lc(b.wallet);
    if (!isAddr(wallet)) return res.status(400).json({ error: 'wallet required' });
    const { data: cur, error: readErr } = await supabase.from('game_players').select('nonce').eq('wallet', wallet).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    const nonce = Number(cur?.nonce ?? 0);
    try {
      const signer = lc(await recoverMessageAddress({ message: loadoutMessage(wallet, nonce), signature: b.signature }));
      if (signer !== wallet) return res.status(401).json({ error: 'bad signature' });
    } catch { return res.status(401).json({ error: 'bad signature' }); }
    const loadout = sanitizeLoadout(b.loadout);
    // Optimistic nonce check so a replayed signature can't win a race.
    const q = cur
      ? supabase.from('game_players').update({ loadout, nonce: nonce + 1, updated_at: new Date().toISOString() }).eq('wallet', wallet).eq('nonce', nonce)
      : supabase.from('game_players').insert({ wallet, loadout, nonce: 1 });
    const { data, error } = await q.select('wallet,milk,loadout,nonce').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(409).json({ error: 'nonce changed, retry' });
    return res.status(200).json({ ...data, milk: Number(data.milk) });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method not allowed' });
}
