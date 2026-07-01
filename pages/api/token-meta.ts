import type { NextApiRequest, NextApiResponse } from 'next';
import { createPublicClient, http, recoverMessageAddress, type Address } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { FACTORY_V3, MONAD_CHAIN_ID } from '@/lib/constants';
import { factoryV3Abi } from '@/lib/abis';

// Off-chain token metadata (logo + socials + description), keyed by the token
// contract address. Read is public. Write is bound to the token's ON-CHAIN creator:
//  - the address must be a real Mon-Pad token (factory.creatorOf(token) != 0);
//  - client-supplied `creator` is ignored — we store the on-chain creator;
//  - a write SIGNED by the on-chain creator upserts (so the real creator can set or
//    correct metadata and always beats an unsigned squatter), while an unsigned
//    write is first-write-wins. This closes the unauthenticated squatting hole.

const TABLE = 'token_meta';
const lc = (s?: string) => (s || '').toLowerCase();
const isAddr = (s?: string) => !!s && /^0x[0-9a-f]{40}$/.test(lc(s));
const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : null);
const ZERO = '0x0000000000000000000000000000000000000000';

// Only http(s) URLs are stored (reject javascript:/data:/etc.) — defense-in-depth
// against a stored-XSS link even though the client also sanitizes on render.
function safeUrl(u: unknown, max: number): string | null {
  if (typeof u !== 'string') return null;
  const s = u.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.slice(0, max);
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#]|$)/i.test(s)) return `https://${s}`.slice(0, max);
  return null;
}

// The metadata signing message (EIP-191 personal_sign). Must match the client.
export const metaSignMessage = (address: string) => `Mon-Pad: set metadata for token ${lc(address)}`;

// Read the token's on-chain creator from the factory. Returns lowercased address,
// or null if it's not a Mon-Pad token / the RPC read fails.
async function onchainCreator(address: string): Promise<string | null> {
  const rpc = process.env.RPC_URL || 'https://rpc.monad.xyz';
  try {
    const client = createPublicClient({
      chain: { id: MONAD_CHAIN_ID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as any,
      transport: http(rpc, { timeout: 7_000, retryCount: 1 }),
    });
    const c = await (client.readContract as any)({ address: FACTORY_V3 as Address, abi: factoryV3Abi as any, functionName: 'creatorOf', args: [address as Address] });
    const creator = lc(c as string);
    return creator && creator !== ZERO ? creator : null;
  } catch { return null; }
}

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

  // ── WRITE ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = (req.body || {}) as Record<string, unknown>;
    if (!isAddr(b.address as string)) return res.status(400).json({ error: 'invalid address' });
    const address = lc(b.address as string);

    // Verify this is a real Mon-Pad token and get its authoritative creator.
    const creator = await onchainCreator(address);
    if (!creator) return res.status(400).json({ error: 'not a Mon-Pad token (or chain unavailable)' });

    // If a signature is present and recovers to the on-chain creator, allow an
    // authoritative upsert (create OR correct). Otherwise fall back to first-write.
    let signedByCreator = false;
    if (typeof b.signature === 'string' && /^0x[0-9a-fA-F]+$/.test(b.signature)) {
      try {
        const signer = lc(await recoverMessageAddress({ message: metaSignMessage(address), signature: b.signature as `0x${string}` }));
        signedByCreator = signer === creator;
      } catch { signedByCreator = false; }
    }

    const row = {
      address,
      name: clip(b.name, 64),
      symbol: clip(b.symbol, 16),
      image_url: clip(b.imageUrl, 512),
      description: clip(b.description, 2000),
      twitter: safeUrl(b.twitter, 256),
      telegram: safeUrl(b.telegram, 256),
      website: safeUrl(b.website, 256),
      creator, // always the on-chain creator, never client-supplied
    };

    if (signedByCreator) {
      // Authoritative write by the verified creator — overwrite any squatted row.
      const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'address' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, authoritative: true });
    }

    // Unsigned: first-write-wins. Insert and map the PK unique-violation (a
    // concurrent double-submit / race) to a clean 409 instead of leaking a 500.
    const { error } = await supabase.from(TABLE).insert(row);
    if (error) {
      if ((error as any).code === '23505') return res.status(409).json({ error: 'metadata already set' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'GET or POST only' });
}
