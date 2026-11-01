import type { NextApiRequest, NextApiResponse } from 'next';
import webpush from 'web-push';
import { isAdmin } from '@/lib/constants';
import { verifyStudioSig } from '@/lib/studioServer';
import { REASONS } from '@/lib/pet/server';

// POST /api/pet/push-test {wallet, signature, subscription} -> sends one test notification to that device. Admin wallets only.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { wallet, signature, subscription } = req.body || {};
  if (typeof wallet !== 'string' || !isAdmin(wallet) || !(await verifyStudioSig(wallet, String(signature || '')))) return res.status(403).json({ error: 'Admins only.' });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return res.status(503).json({ error: 'Push keys are not set.' });
  const ep = subscription?.endpoint, k = subscription?.keys;
  if (typeof ep !== 'string' || !/^https:\/\//.test(ep) || typeof k?.p256dh !== 'string' || typeof k?.auth !== 'string') return res.status(400).json({ error: 'Bad subscription.' });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@monpad.net', pub, priv);
  try {
    await webpush.sendNotification({ endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } }, JSON.stringify({ title: '[Test] ' + REASONS.hungry.title, body: REASONS.hungry.body, url: '/pet' }), { TTL: 300 });
    return res.status(200).json({ ok: true });
  } catch (e: any) { return res.status(502).json({ error: `Push service said ${e?.statusCode ?? 'error'}.` }); }
}
