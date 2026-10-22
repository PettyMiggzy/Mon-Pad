import type { NextApiRequest, NextApiResponse } from 'next';
import { authed, logUsage, refund, spend, startOfDayIso } from '@/lib/launchAgent/account';
import { LAUNCH_PRICES, LIMITS, MESHY_IMAGE_TO_3D_CREDITS } from '@/lib/launchAgent/pricing';
import { meshyConfigured, startImageTo3D } from '@/lib/launchAgent/meshy';

// POST /api/v1/launch/character {wallet, signature, imageUrl}
// Starts a 3D "living coin" build from the token picture. Paid first; capped per wallet and globally.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const a = await authed(req, res);
  if (!a) return;
  if (!meshyConfigured()) return res.status(503).json({ error: '3D characters are not available yet' });

  const imageUrl = String(a.body.imageUrl || '');
  if (!/^https:\/\/[^\s]+$/i.test(imageUrl) || imageUrl.length > 600) return res.status(400).json({ error: 'imageUrl must be a public https image' });

  const since = startOfDayIso();
  const [mine, all] = await Promise.all([
    a.supabase.from('launch_characters').select('id', { count: 'exact', head: true }).eq('wallet', a.wallet).gte('created_at', since),
    a.supabase.from('launch_characters').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ]);
  if ((mine.count ?? 0) >= LIMITS.charactersPerWalletPerDay) return res.status(429).json({ error: 'daily 3D character limit reached' });
  if ((all.count ?? 0) >= LIMITS.charactersGlobalPerDay) return res.status(429).json({ error: '3D builds are at capacity today — try tomorrow' });

  const price = LAUNCH_PRICES.character;
  const left = await spend(a.supabase, a.wallet, price);
  if (left === null) return res.status(402).json({ error: `needs ${price} credits — top up in Studio`, price });
  try {
    const task = await startImageTo3D(imageUrl);
    const { data, error } = await a.supabase.from('launch_characters').insert({
      wallet: a.wallet, source_image: imageUrl, model_task: task, credits: price, meshy_credits: MESHY_IMAGE_TO_3D_CREDITS,
    }).select('id').single();
    if (error) throw new Error(error.message);
    await logUsage(a.supabase, a.wallet, 'launch_character', 'meshy-7.1', price);
    return res.status(202).json({ id: data.id, charged: price, credits: left, status: 'model' });
  } catch (e: any) {
    await refund(a.supabase, a.wallet, price);
    return res.status(502).json({ error: String(e?.message || '3D service unavailable').slice(0, 160) });
  }
}
