import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isReason } from '@/lib/pet/server';

const okEndpoint = (e: unknown): e is string => typeof e === 'string' && /^https:\/\/[^\s]{10,500}$/.test(e);

// POST   /api/pet/push {subscription:{endpoint,keys:{p256dh,auth}}, remindAt:<ms>, reason:'hungry'|'miss'}  (subscribe or reschedule)
// DELETE /api/pet/push {endpoint}                                                                      (unsubscribe)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = getSupabaseAdmin();
  if (!db) return res.status(503).json({ error: 'Reminders are not available yet.' });
  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (!okEndpoint(endpoint)) return res.status(400).json({ error: 'Bad endpoint.' });
    await db.from('pet_push_subs').delete().eq('endpoint', endpoint);
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or DELETE' });
  const { subscription, remindAt, reason } = req.body || {};
  const endpoint = subscription?.endpoint, p256dh = subscription?.keys?.p256dh, auth = subscription?.keys?.auth;
  if (!okEndpoint(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return res.status(400).json({ error: 'Bad subscription.' });
  const at = Number(remindAt), now = Date.now();
  const valid = isReason(reason) && Number.isFinite(at) && at > now - 60_000 && at < now + 4 * 86_400_000;
  const { error } = await db.from('pet_push_subs').upsert(
    { endpoint, p256dh, auth, remind_at: valid ? new Date(at).toISOString() : null, reason: valid ? reason : null },
    { onConflict: 'endpoint' },
  );
  if (error) return res.status(500).json({ error: 'Could not save.' });
  return res.status(200).json({ ok: true, scheduled: valid });
}
