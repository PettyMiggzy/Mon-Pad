import type { NextApiRequest, NextApiResponse } from 'next';
import { MODES, veniceImage } from '@/lib/studioServer';
import { authed, logUsage, refund, spend } from '@/lib/launchAgent/account';
import { LAUNCH_PRICES } from '@/lib/launchAgent/pricing';
import { cleanPrompt, moderate } from '@/lib/launchAgent/moderation';

export const config = { api: { responseLimit: '8mb' } };

// POST /api/v1/launch/art {wallet, signature, imagePrompt}
// Makes the token picture. The client then uploads it through /api/upload.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const a = await authed(req, res);
  if (!a) return;
  const prompt = cleanPrompt(a.body.imagePrompt, 300);
  if (prompt.length < 5) return res.status(400).json({ error: 'image prompt required' });
  const flags = moderate(prompt);
  if (flags.length) return res.status(422).json({ error: `Monshi can't draw that: ${flags.join(', ')}`, flags });

  const price = LAUNCH_PRICES.art;
  const left = await spend(a.supabase, a.wallet, price);
  if (left === null) return res.status(402).json({ error: `needs ${price} credits — top up in Studio`, price });
  try {
    const image = await veniceImage(MODES.image.model, `${prompt}. Bold mascot sticker style, centered, plain solid background, no text.`);
    await logUsage(a.supabase, a.wallet, 'launch_art', MODES.image.model, price);
    return res.status(200).json({ image, charged: price, credits: left });
  } catch (e: any) {
    await refund(a.supabase, a.wallet, price);
    return res.status(502).json({ error: String(e?.message || 'image unavailable').slice(0, 160) });
  }
}
