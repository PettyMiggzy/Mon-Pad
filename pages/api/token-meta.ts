import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

// Off-chain token metadata (logo + socials + description), keyed by the token
// contract address. Read is public; write is first-write-wins (a token's metadata
// can be set once — at launch — and not overwritten/defaced afterward). This runs
// same-origin on the app's own serverless function, so there is no external
// backend dependency and no 404s.

const TABLE = 'token_meta';
const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : null);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Metadata storage not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });

  // ── READ ────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { address, addresses } = req.query;
    if (typeof addresses === 'string' && addresses) {
      const list = Array.from(new Set(addresses.split(',').map(lc).filter(isAddr))).slice(0, 100);
      if (!list.length) return res.status(200).json([]);
      const { data, error } = await supabase.from(TABLE).select('*').in('address', list);
      if (error) return res.status(500).json({ error: error.message });
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
      return res.status(200).json(data || []);
    }
    if (typeof address === 'string' && isAddr(address)) {
      const { data, error } = await supabase.from(TABLE).select('*').eq('address', lc(address)).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
      return res.status(200).json(data || null);
    }
    return res.status(400).json({ error: 'address or addresses required' });
  }

  // ── WRITE (first-write-wins) ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, unknown>;
    if (!isAddr(b.address as string)) return res.status(400).json({ error: 'invalid address' });
    const address = lc(b.address as string);

    const { data: existing, error: readErr } = await supabase.from(TABLE).select('address').eq('address', address).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (existing) return res.status(409).json({ error: 'metadata already set' });

    const row = {
      address,
      name: clip(b.name, 64),
      symbol: clip(b.symbol, 16),
      image_url: clip(b.imageUrl, 512),
      description: clip(b.description, 2000),
      twitter: clip(b.twitter, 256),
      telegram: clip(b.telegram, 256),
      website: clip(b.website, 256),
      creator: isAddr(b.creator as string) ? lc(b.creator as string) : null,
    };
    const { error } = await supabase.from(TABLE).insert(row);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'GET or POST only' });
}
