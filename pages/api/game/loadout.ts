import type { NextApiRequest, NextApiResponse } from 'next';
import { recoverMessageAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { loadoutCost, loadoutMessage, sanitizeLoadout } from '@/lib/gameLoadout';

// GET  /api/game/loadout?wallet=0x…  -> { wallet, loadout, milk, nonce }
// PUT  /api/game/loadout             -> body { wallet, loadout, signature } signed over loadoutMessage(wallet, nonce)
// Saving charges the milk cost of what changed (new cars, boosts, upgrade levels); it never adds milk.

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
    const { data: cur, error: readErr } = await supabase.from('game_players').select('nonce,milk,loadout').eq('wallet', wallet).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    const nonce = Number(cur?.nonce ?? 0);
    try {
      const signer = lc(await recoverMessageAddress({ message: loadoutMessage(wallet, nonce), signature: b.signature }));
      if (signer !== wallet) return res.status(401).json({ error: 'bad signature' });
    } catch { return res.status(401).json({ error: 'bad signature' }); }
    const loadout = sanitizeLoadout(b.loadout);
    const cost = loadoutCost(sanitizeLoadout(cur?.loadout), loadout);
    if (cost === null) return res.status(400).json({ error: 'loadout change not allowed' });
    if (cost > Number(cur?.milk ?? 0)) return res.status(402).json({ error: 'insufficient milk', cost });
    // Charge and save in one transaction; the nonce check makes a replayed signature fail.
    const { data, error } = await supabase.rpc('game_save_loadout', { p_wallet: wallet, p_nonce: nonce, p_loadout: loadout, p_cost: cost });
    if (error) return res.status(error.message.includes('insufficient') ? 402 : error.message.includes('nonce') ? 409 : 500).json({ error: error.message });
    return res.status(200).json({ wallet, loadout: data.loadout, milk: Number(data.milk), nonce: Number(data.nonce) });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method not allowed' });
}
