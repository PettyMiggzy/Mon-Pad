import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Storage health — same path the original bond pad used:
 *   Supabase `images` bucket (PFPs / logos via POST /api/upload)
 *   Supabase `token_meta` table (logo URL + socials via /api/token-meta)
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({
      ok: false,
      storage: 'supabase',
      configured: false,
      error: 'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel, then redeploy.',
      paths: { upload: '/api/upload', meta: '/api/token-meta' },
    });
  }

  try {
    const { error: bucketErr } = await supabase.storage.from('images').list('tokens', { limit: 1 });
    const { error: tableErr } = await supabase.from('token_meta').select('address').limit(1);
    const ok = !bucketErr && !tableErr;
    return res.status(ok ? 200 : 503).json({
      ok,
      storage: 'supabase',
      configured: true,
      bucket: 'images',
      table: 'token_meta',
      bucketOk: !bucketErr,
      tableOk: !tableErr,
      bucketError: bucketErr?.message || null,
      tableError: tableErr?.message || null,
      paths: { upload: '/api/upload', meta: '/api/token-meta' },
    });
  } catch (e: any) {
    return res.status(503).json({ ok: false, storage: 'supabase', configured: true, error: e?.message || 'probe failed' });
  }
}
