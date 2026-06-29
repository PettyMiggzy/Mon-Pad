import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Token-logo uploads. The browser POSTs a base64 data URL to this SAME-ORIGIN
// route (no external backend needed); the route streams it into the Supabase
// Storage `images` bucket using the SERVICE-ROLE key, which stays server-side
// and is never shipped to the client. Public read is enabled on the bucket, so
// the returned URL renders directly.
//
// Required server env (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                = https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = <service_role secret>   (NOT the anon key)

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const BUCKET = 'images';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({
      error: 'Image storage not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.',
    });
  }

  try {
    const { dataUrl, type } = (req.body || {}) as { dataUrl?: string; type?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'missing image' });
    }
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'invalid image data' });

    const contentType = (type && String(type)) || m[1] || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'images only' });
    }

    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'empty image' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'image too large (max 5 MB)' });

    const ext = (contentType.split('/')[1] || 'png').split('+')[0].replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png';
    const path = `tokens/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
      contentType,
      upsert: false,
      cacheControl: '31536000',
    });
    if (error) return res.status(500).json({ error: `upload failed: ${error.message}` });

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return res.status(200).json({ url: data.publicUrl });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'upload error' });
  }
}
