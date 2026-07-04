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

// Identify the image by its actual magic bytes — never by the client-supplied MIME.
// This rejects `image/svg+xml` (which would be stored+served inline as an XSS vector)
// and any non-image payload masquerading as a `data:image/...` URL. Returns the true
// content-type + extension, or null for anything that isn't a raster image we allow.
function sniffImage(buf: Buffer): { ct: string; ext: string } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ct: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ct: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return { ct: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ct: 'image/webp', ext: 'webp' };
  return null;
}

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
    const { dataUrl } = (req.body || {}) as { dataUrl?: string };
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'missing image' });
    }
    const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'invalid image data' });

    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) return res.status(400).json({ error: 'empty image' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'image too large (max 5 MB)' });

    // Trust the bytes, not the client MIME: only accept real PNG/JPEG/WebP/GIF.
    const kind = sniffImage(buf);
    if (!kind) return res.status(400).json({ error: 'unsupported image — use PNG, JPEG, WebP, or GIF' });
    const contentType = kind.ct;
    const path = `tokens/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${kind.ext}`;

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
