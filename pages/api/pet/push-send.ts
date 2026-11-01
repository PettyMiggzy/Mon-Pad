import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { dueSubs, REASONS, type Reason } from '@/lib/pet/server';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Call hourly with `Authorization: Bearer $CRON_SECRET`. Sends the reminders that are due, at most one per device per 12 hours.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !same(given, secret)) return res.status(401).json({ error: 'unauthorized' });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const db = getSupabaseAdmin();
  if (!pub || !priv || !db) return res.status(503).json({ error: 'push is not configured' });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:hello@monpad.net', pub, priv);

  const { data: rows } = await db.from('pet_push_subs').select('endpoint,p256dh,auth,remind_at,reason,last_sent_at').lte('remind_at', new Date().toISOString()).limit(500);
  const due = dueSubs(rows ?? []);
  let sent = 0, removed = 0, failed = 0;
  for (const r of due) {
    const msg = REASONS[r.reason as Reason];
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify({ title: msg.title, body: msg.body, url: '/pet' }), { TTL: 6 * 3600 });
      await db.from('pet_push_subs').update({ last_sent_at: new Date().toISOString() }).eq('endpoint', r.endpoint); sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from('pet_push_subs').delete().eq('endpoint', r.endpoint); removed++; } else failed++;
    }
  }
  return res.status(200).json({ due: due.length, sent, removed, failed });
}
