import type { NextApiRequest, NextApiResponse } from 'next';

// MON/USD price for USD display. Pulled server-side from DexScreener (free, has
// Monad) using the most-liquid WMON/stable pair, cached 60s. Returns { usd, at }.
const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

let cache: { usd: number; at: number } | null = null;

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const now = Date.now();
  if (cache && now - cache.at < 60_000) {
    res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(cache);
  }
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${WMON}`);
    const d = await r.json();
    const pairs = (d?.pairs || []).filter((p: any) => p?.chainId === 'monad' && p?.priceUsd);
    pairs.sort((a: any, b: any) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0));
    const usd = pairs.length ? Number(pairs[0].priceUsd) : 0;
    cache = { usd: isFinite(usd) ? usd : 0, at: now };
    res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(cache);
  } catch {
    return res.status(200).json({ usd: cache?.usd || 0, at: now });
  }
}
