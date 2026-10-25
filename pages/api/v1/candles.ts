// OHLCV candles for a Monpad V4 pool, proxied from GeckoTerminal (which indexes the pool by its V4 poolId).
// Public RPCs cap eth_getLogs at 100 blocks, so rebuilding history from chain logs is not practical here.
import type { NextApiRequest, NextApiResponse } from 'next';

const TF: Record<string, { path: string; agg: number; sec: number }> = {
  '1m': { path: 'minute', agg: 1, sec: 60 },
  '5m': { path: 'minute', agg: 5, sec: 300 },
  '15m': { path: 'minute', agg: 15, sec: 900 },
  '1h': { path: 'hour', agg: 1, sec: 3600 },
  '4h': { path: 'hour', agg: 4, sec: 14400 },
  '1d': { path: 'day', agg: 1, sec: 86400 },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pool = String(req.query.pool || '').toLowerCase();
  const tf = TF[String(req.query.tf || '5m')];
  if (!/^0x[0-9a-f]{64}$/.test(pool) || !tf) return res.status(400).json({ error: 'bad pool or tf' });
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/monad/pools/${pool}/ohlcv/${tf.path}?aggregate=${tf.agg}&limit=300&currency=usd`;
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (r.status === 404) return res.status(200).json({ candles: [], indexed: false });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j: any = await r.json();
    const rows: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
    const sorted = rows
      .filter((x) => x.length >= 6 && x.every((n) => Number.isFinite(n)))
      .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
      .sort((a, b) => a.time - b.time);
    // Periods with no trades come back missing; carry the last close forward so the chart is continuous.
    const candles: typeof sorted = [];
    for (const c of sorted) {
      const prev = candles[candles.length - 1];
      if (prev) for (let t = prev.time + tf.sec; t < c.time && candles.length < 1500; t += tf.sec) candles.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 });
      candles.push(c);
    }
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
    return res.status(200).json({ candles: candles.slice(-300), indexed: true });
  } catch (e: any) {
    return res.status(502).json({ error: String(e?.message || 'upstream failed').slice(0, 120) });
  }
}
