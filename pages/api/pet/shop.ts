import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyStudioSig } from '@/lib/studioServer';
import { isPremium, PREMIUM } from '@/lib/pet/shop';
import { treasury, verifyMonshiPayment } from '@/lib/pet/server';
import { isAdmin, MONSHI_TOKEN } from '@/lib/constants';
import { randomUUID } from 'node:crypto';

const isWallet = (w: unknown): w is string => typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w);

// GET  /api/pet/shop?wallet=0x...  -> catalogue, treasury, and what this wallet already bought
// POST /api/pet/shop {wallet, signature, txHash, item} -> verifies the MONSHI transfer on-chain, records it once
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getSupabaseAdmin();
  const open = !!treasury() && !!db;
  if (req.method === 'GET') {
    const wallet = String(req.query.wallet || '');
    let purchases: { item: string; tx_hash: string }[] = [];
    if (db && isWallet(wallet)) {
      const { data } = await db.from('pet_purchases').select('item,tx_hash').ilike('wallet', wallet);
      purchases = data ?? [];
    }
    return res.status(200).json({ open, treasury: open ? treasury() : null, token: MONSHI_TOKEN, items: PREMIUM, purchases });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  if (!open || !db) return res.status(503).json({ error: 'The MONSHI shop is not open yet.' });

  const { wallet, signature, txHash, item, action } = req.body || {};
  if (!isWallet(wallet) || !isPremium(item)) return res.status(400).json({ error: 'Bad request.' });
  if (!(await verifyStudioSig(wallet, String(signature || '')))) return res.status(401).json({ error: 'Sign in with your wallet first.' });

  // Admin test unlock: lets the site owner try the whole shop flow without paying. Recorded with a 'test:' id and 0 MONSHI.
  if (action === 'grant') {
    if (!isAdmin(wallet)) return res.status(403).json({ error: 'Admins only.' });
    const { error: gerr } = await db.from('pet_purchases').insert({ wallet: wallet.toLowerCase(), item, tx_hash: `test:${randomUUID()}`, amount_monshi: 0 });
    return gerr ? res.status(500).json({ error: 'Could not save.' }) : res.status(200).json({ ok: true, item, test: true });
  }
  if (typeof txHash !== 'string') return res.status(400).json({ error: 'Bad request.' });

  const { data: seen } = await db.from('pet_purchases').select('wallet,item').eq('tx_hash', txHash.toLowerCase()).maybeSingle();
  if (seen) return res.status(seen.wallet.toLowerCase() === wallet.toLowerCase() && seen.item === item ? 200 : 409).json(seen.item === item ? { ok: true, already: true } : { error: 'That payment was already used.' });

  const sent = await verifyMonshiPayment(txHash, wallet, item);
  if (!sent) return res.status(402).json({ error: 'No matching MONSHI payment found in that transaction.' });
  const { error } = await db.from('pet_purchases').insert({ wallet: wallet.toLowerCase(), item, tx_hash: txHash.toLowerCase(), amount_monshi: Number(sent / 10n ** 18n) });
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That payment was already used.' : 'Could not save the purchase.' });
  return res.status(200).json({ ok: true, item });
}
