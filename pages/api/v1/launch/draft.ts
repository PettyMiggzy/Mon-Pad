import type { NextApiRequest, NextApiResponse } from 'next';
import { MODES } from '@/lib/studioServer';
import { authed, logUsage, refund, spend, startOfDayIso } from '@/lib/launchAgent/account';
import { LAUNCH_PRICES, LIMITS } from '@/lib/launchAgent/pricing';
import { makeDraft } from '@/lib/launchAgent/draft';

// POST /api/v1/launch/draft {wallet, signature, prompt}
// Turns an idea into {name, symbol, description, imagePrompt}. Paid first, refunded on failure.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const a = await authed(req, res);
  if (!a) return;
  const idea = String(a.body.prompt || '').trim();
  if (idea.length < 3) return res.status(400).json({ error: 'describe your coin in a sentence' });

  const { count } = await a.supabase.from('studio_usage').select('id', { count: 'exact', head: true })
    .eq('wallet', a.wallet).eq('mode', 'launch_draft').gte('created_at', startOfDayIso());
  if ((count ?? 0) >= LIMITS.draftsPerWalletPerDay) return res.status(429).json({ error: 'daily draft limit reached' });

  const price = LAUNCH_PRICES.draft;
  const left = await spend(a.supabase, a.wallet, price);
  if (left === null) return res.status(402).json({ error: `needs ${price} credits — top up in Studio`, price });
  try {
    const draft = await makeDraft(idea);
    await logUsage(a.supabase, a.wallet, 'launch_draft', MODES.chat.model, price);
    if (draft.flags.length) {
      await refund(a.supabase, a.wallet, price);
      return res.status(422).json({ error: `Monshi can't launch that: ${draft.flags.join(', ')}`, flags: draft.flags });
    }
    return res.status(200).json({ draft, charged: price, credits: left });
  } catch (e: any) {
    await refund(a.supabase, a.wallet, price);
    return res.status(502).json({ error: String(e?.message || 'draft unavailable').slice(0, 160) });
  }
}
