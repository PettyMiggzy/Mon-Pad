// lib/chainV3.ts
// On-chain data layer for the V3 (native-MON) pad. Reads launches + curve state
// directly from the factory/curves so the app works even before the indexer is
// updated for V3. Uses a viem public client (QuickNode RPC) + multicall.

import { createPublicClient, http, parseAbiItem, formatEther, type Address } from 'viem';
import { FACTORY_V3, MONAD_CHAIN_ID, MONAD_RPC_URL, V3_GRADUATION_TARGET_MON } from './constants';
import { factoryV3Abi, curveV3Abi, tokenAbi } from './abis';

const monadChain = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
  // multicall3 is deployed on Monad at the canonical address. Without this,
  // publicClient.multicall() throws → listV3Tokens fails → homepage shows nothing.
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address } },
} as const;

// retryCount 1 so a rejected request (413/429) doesn't retry-storm; 7s timeout so a
// slow/dead RPC fails fast (was 12s → up to ~24s stalls) instead of hanging the UI.
export const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(MONAD_RPC_URL, { retryCount: 1, timeout: 7_000 }),
});

// Loose wrappers — the V3 ABIs are imported JSON; bypass viem's heavy ABI generics.
const read = (p: any): Promise<any> => (publicClient.readContract as any)(p);
const mc = (p: any): Promise<any[]> => (publicClient.multicall as any)(p);

const GRAD_TARGET_WEI = V3_GRADUATION_TARGET_MON * 10n ** 18n;

export type V3Token = {
  token: Address;
  curve: Address;
  name: string;
  symbol: string;
  creator: Address;
  monRaisedNet: string;     // wei
  graduated: boolean;
  progress: number;         // 0..1 toward graduation
  priceWeiPerToken: string; // wei
};

export type V3Reserves = {
  virtualMonReserve: bigint;
  virtualTokenReserve: bigint;
  realMonReserve: bigint;
  realTokenReserve: bigint;
};

/** Resolve a token's bonding-curve clone (via the token's `curve` getter). */
export async function curveOf(token: Address): Promise<Address> {
  return read({ address: token, abi: tokenAbi, functionName: 'curve' });
}

/**
 * Resolve a token's metadata straight from chain (no indexer): symbol/name/
 * decimals + whether it's a Mon-Pad token and whether it has graduated. Used by
 * the swap page to load an arbitrary token by address (e.g. deep-link from a
 * graduated token page) so trading works with no backend.
 */
export async function resolveTokenMeta(token: Address): Promise<
  { symbol: string; name: string; decimals: number; graduated: boolean; curve: Address; isMonPadToken: boolean } | null
> {
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  try {
    const [symbol, name] = await Promise.all([
      read({ address: token, abi: tokenAbi, functionName: 'symbol' }) as Promise<string>,
      read({ address: token, abi: tokenAbi, functionName: 'name' }) as Promise<string>,
    ]);
    let decimals = 18;
    try { decimals = Number(await read({ address: token, abi: tokenAbi, functionName: 'decimals' })); } catch { /* default 18 */ }
    let curve: Address = ZERO;
    let graduated = false;
    let isMonPadToken = false;
    try {
      curve = await curveOf(token);
      if (curve && curve !== ZERO) {
        isMonPadToken = true;
        graduated = (await read({ address: curve, abi: curveV3Abi, functionName: 'graduated' })) as boolean;
      }
    } catch { /* not a Mon-Pad token — still swappable as a plain ERC20 */ }
    return { symbol, name, decimals, graduated, curve, isMonPadToken };
  } catch {
    return null;
  }
}

/** Full curve state for one token (by curve address). */
export async function getCurveState(curve: Address) {
  const [reserves, monRaisedNet, graduated, price, creator, token] = await Promise.all([
    read({ address: curve, abi: curveV3Abi, functionName: 'getCurveReserves' }) as Promise<readonly [bigint, bigint, bigint, bigint]>,
    read({ address: curve, abi: curveV3Abi, functionName: 'monRaisedNet' }) as Promise<bigint>,
    read({ address: curve, abi: curveV3Abi, functionName: 'graduated' }) as Promise<boolean>,
    read({ address: curve, abi: curveV3Abi, functionName: 'priceWeiPerToken' }) as Promise<bigint>,
    read({ address: curve, abi: curveV3Abi, functionName: 'creator' }) as Promise<Address>,
    read({ address: curve, abi: curveV3Abi, functionName: 'token' }) as Promise<Address>,
  ]);
  const r: V3Reserves = {
    virtualMonReserve: reserves[0], virtualTokenReserve: reserves[1],
    realMonReserve: reserves[2], realTokenReserve: reserves[3],
  };
  return { reserves: r, monRaisedNet, graduated, priceWeiPerToken: price, creator, token };
}

/** Newest-first list of V3 launches read straight from the factory. */
// Short TTL cache so the homepage (grid + 3 rails) collapses its 4 concurrent
// calls into one RPC round instead of hammering the endpoint (avoids 429/413).
let _listCache: { limit: number; at: number; p: Promise<V3Token[]> } | null = null;
export function listV3Tokens(limit = 60): Promise<V3Token[]> {
  const now = Date.now();
  if (_listCache && _listCache.limit === limit && now - _listCache.at < 6000) return _listCache.p;
  const p = _listV3Tokens(limit);
  _listCache = { limit, at: now, p };
  p.catch(() => { if (_listCache && _listCache.p === p) _listCache = null; }); // don't cache failures
  return p;
}

async function _listV3Tokens(limit = 60): Promise<V3Token[]> {
  if (FACTORY_V3 === ('0x0000000000000000000000000000000000000000' as Address)) return [];
  const counts = (await read({ address: FACTORY_V3, abi: factoryV3Abi, functionName: 'allCounts' })) as readonly [bigint, bigint];
  const n = Number(counts[0]);
  if (n === 0) return [];
  const take = Math.min(n, limit);
  const idx = Array.from({ length: take }, (_, i) => n - 1 - i); // newest first

  // Resolve token + curve addresses (multicall).
  const tokAddrs = (await mc({
    contracts: idx.map((i) => ({ address: FACTORY_V3, abi: factoryV3Abi, functionName: 'allTokens', args: [BigInt(i)] })),
    allowFailure: false,
  })) as Address[];
  const curveAddrs = (await mc({
    contracts: idx.map((i) => ({ address: FACTORY_V3, abi: factoryV3Abi, functionName: 'allCurves', args: [BigInt(i)] })),
    allowFailure: false,
  })) as Address[];

  // Per-token metadata + per-curve state (multicall, failures tolerated).
  const metaCalls = tokAddrs.flatMap((t) => [
    { address: t, abi: tokenAbi, functionName: 'name' },
    { address: t, abi: tokenAbi, functionName: 'symbol' },
  ]);
  const stateCalls = curveAddrs.flatMap((c) => [
    { address: c, abi: curveV3Abi, functionName: 'monRaisedNet' },
    { address: c, abi: curveV3Abi, functionName: 'graduated' },
    { address: c, abi: curveV3Abi, functionName: 'priceWeiPerToken' },
    { address: c, abi: curveV3Abi, functionName: 'creator' },
  ]);
  const [meta, state] = await Promise.all([
    mc({ contracts: metaCalls, allowFailure: true }),
    mc({ contracts: stateCalls, allowFailure: true }),
  ]);

  const out: V3Token[] = [];
  for (let k = 0; k < take; k++) {
    const name = (meta[k * 2]?.result as string) ?? '';
    const symbol = (meta[k * 2 + 1]?.result as string) ?? '';
    const raised = (state[k * 4]?.result as bigint) ?? 0n;
    const graduated = (state[k * 4 + 1]?.result as boolean) ?? false;
    const price = (state[k * 4 + 2]?.result as bigint) ?? 0n;
    const creator = (state[k * 4 + 3]?.result as Address) ?? ('0x0000000000000000000000000000000000000000' as Address);
    const progress = GRAD_TARGET_WEI > 0n ? Math.min(1, Number(raised) / Number(GRAD_TARGET_WEI)) : 0;
    out.push({
      token: tokAddrs[k], curve: curveAddrs[k], name, symbol, creator,
      monRaisedNet: raised.toString(), graduated, progress, priceWeiPerToken: price.toString(),
    });
  }
  return out;
}

// ─── Trades feed + price chart (read straight from on-chain Trade events) ────
// No indexer required: we pull the curve's `Trade` logs over a bounded lookback
// and (a) render a live trades list, (b) aggregate OHLC candles for the chart.

const TRADE_EVENT = parseAbiItem(
  'event Trade(address indexed token, address indexed trader, bool isBuy, uint256 monAmount, uint256 tokenAmount, uint256 virtualMonReserve, uint256 virtualTokenReserve, uint256 realMonReserve, uint256 realTokenReserve, uint256 priceX18, uint256 tradedAt)'
);

export type V3Trade = {
  txHash: string;
  trader: Address;
  isBuy: boolean;
  mon: number;        // MON traded (gross)
  tokens: number;     // tokens traded
  price: number;      // MON per token (post-trade spot)
  time: number;       // unix seconds
  block: bigint;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

// ── getLogs window sizing ───────────────────────────────────────────────────
// The RPC caps eth_getLogs to a 100-block range (returns -32614 / HTTP 413 above
// that). So we scan in <=100-block chunks, fired CONCURRENTLY (bounded) so a wide
// window stays fast. After moving to a getLogs-friendly RPC, widen these via env
// (NEXT_PUBLIC_GETLOGS_CHUNK / _LOOKBACK) — no code change.
const LOGS_CHUNK = BigInt(process.env.NEXT_PUBLIC_GETLOGS_CHUNK || '99');            // blocks per getLogs call
const LOGS_LOOKBACK = BigInt(process.env.NEXT_PUBLIC_GETLOGS_LOOKBACK || '12000');   // token-page chart/trades window
const LOGS_CARD_LOOKBACK = BigInt(process.env.NEXT_PUBLIC_GETLOGS_CARD_LOOKBACK || '3000'); // homepage card sparklines (parallel scan)
const LOGS_CONCURRENCY = Number(process.env.NEXT_PUBLIC_GETLOGS_CONCURRENCY || '10'); // parallel getLogs calls per batch

/**
 * Scan an address's logs for `event` across a recent window, in <=100-block chunks
 * fired in bounded-concurrency batches (so a 12k-block window is ~12 fast batches
 * instead of 120 sequential calls). Returns raw decoded logs (any order).
 */
// Fetch one getLogs chunk with a couple of retries so a TRANSIENT 429/413/timeout
// doesn't silently drop that block range (which would omit trades from the chart/
// feed and skip holder candidates). Only a persistent failure falls through to [].
async function getLogsChunk(address: Address, event: any, begin: bigint, end: bigint, retries = 2): Promise<any[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (publicClient.getLogs as any)({ address, event, fromBlock: begin, toBlock: end });
    } catch (e) {
      if (attempt >= retries) return [];
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

async function scanLogs(address: Address, event: any, lookbackBlocks: bigint, chunk: bigint): Promise<any[]> {
  let head: bigint;
  try { head = await publicClient.getBlockNumber(); } catch { return []; }
  const from = head > lookbackBlocks ? head - lookbackBlocks : 0n;
  // Build the [begin,end] chunk ranges newest→oldest.
  const ranges: [bigint, bigint][] = [];
  for (let start = head; start >= from; start -= chunk + 1n) {
    const begin = start > chunk ? start - chunk : 0n;
    ranges.push([begin, start]);
    if (begin === 0n) break;
  }
  const out: any[] = [];
  for (let i = 0; i < ranges.length; i += LOGS_CONCURRENCY) {
    const batch = ranges.slice(i, i + LOGS_CONCURRENCY);
    const results = await Promise.all(batch.map(([begin, end]) => getLogsChunk(address, event, begin, end)));
    for (const logs of results) out.push(...logs);
  }
  return out;
}

/**
 * Read recent Trade events for a curve. Scans a bounded window of recent blocks,
 * chunking the range so public RPCs that cap getLogs spans still work. Newest first.
 */
// 6s cache keyed by curve+window so the token page's stats + the chart/trades
// component share a single RPC round instead of each scanning independently.
const _tradesCache = new Map<string, { at: number; p: Promise<V3Trade[]> }>();
export function getV3Trades(curve: Address, lookbackBlocks = LOGS_LOOKBACK, chunk = LOGS_CHUNK): Promise<V3Trade[]> {
  const key = `${curve}:${lookbackBlocks}:${chunk}`;
  const now = Date.now();
  const hit = _tradesCache.get(key);
  if (hit && now - hit.at < 6000) return hit.p;
  const p = _getV3Trades(curve, lookbackBlocks, chunk);
  _tradesCache.set(key, { at: now, p });
  p.catch(() => { if (_tradesCache.get(key)?.p === p) _tradesCache.delete(key); });
  return p;
}

async function _getV3Trades(curve: Address, lookbackBlocks = LOGS_LOOKBACK, chunk = LOGS_CHUNK): Promise<V3Trade[]> {
  if (!curve || curve === ('0x0000000000000000000000000000000000000000' as Address)) return [];
  const logs = await scanLogs(curve, TRADE_EVENT, lookbackBlocks, chunk);
  const trades: V3Trade[] = logs.map((lg) => {
    const a = lg.args || {};
    return {
      txHash: lg.transactionHash as string,
      trader: a.trader as Address,
      isBuy: Boolean(a.isBuy),
      mon: Number(formatEther((a.monAmount as bigint) ?? 0n)),
      tokens: Number(formatEther((a.tokenAmount as bigint) ?? 0n)),
      price: Number(formatEther((a.priceX18 as bigint) ?? 0n)),
      time: Number((a.tradedAt as bigint) ?? 0n),
      block: (lg.blockNumber as bigint) ?? 0n,
    };
  });
  // Newest first — sort by block then time.
  trades.sort((x, y) => (y.block === x.block ? y.time - x.time : Number(y.block - x.block)));
  return trades;
}

/** Aggregate trades (any order) into OHLC candles of `tfSeconds` buckets, oldest→newest. */
export function tradesToCandles(trades: V3Trade[], tfSeconds = 300): Candle[] {
  const valid = trades.filter((t) => t.price > 0 && t.time > 0).sort((a, b) => a.time - b.time);
  const buckets = new Map<number, Candle>();
  for (const t of valid) {
    const bt = Math.floor(t.time / tfSeconds) * tfSeconds;
    const c = buckets.get(bt);
    if (!c) buckets.set(bt, { time: bt, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.mon || 0 });
    else { c.high = Math.max(c.high, t.price); c.low = Math.min(c.low, t.price); c.close = t.price; c.volume += t.mon || 0; }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

// ─── Holders (derived from the token's Transfer logs; no indexer) ────────────
export type V3Holder = { address: string; balance: string; pct: number };
const _ZERO = '0x0000000000000000000000000000000000000000';
const _DEAD = '0x000000000000000000000000000000000000dead';
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const _holdersCache = new Map<string, { at: number; p: Promise<V3Holder[]> }>();

/** Top holders of a token, computed from Transfer logs. Excludes zero/dead + `exclude` (e.g. the curve). */
export function getV3Holders(token: Address, exclude: string[] = [], lookbackBlocks = LOGS_LOOKBACK, chunk = LOGS_CHUNK): Promise<V3Holder[]> {
  const key = `${(token || '').toLowerCase()}|${exclude.join(',')}`;
  const now = Date.now();
  const hit = _holdersCache.get(key);
  if (hit && now - hit.at < 30_000) return hit.p;
  const p = _getV3Holders(token, exclude, lookbackBlocks, chunk);
  _holdersCache.set(key, { at: now, p });
  p.catch(() => { if (_holdersCache.get(key)?.p === p) _holdersCache.delete(key); });
  return p;
}

async function _getV3Holders(token: Address, exclude: string[], lookbackBlocks: bigint, chunk: bigint): Promise<V3Holder[]> {
  if (!token || token === (_ZERO as Address)) return [];
  const logs = await scanLogs(token, TRANSFER_EVENT, lookbackBlocks, chunk);
  const excl = new Set([_ZERO, _DEAD, ...exclude.map((e) => (e || '').toLowerCase())].filter(Boolean));
  // Collect candidate holders (anyone who sent/received in the window). We only use
  // the logs to DISCOVER addresses — never to reconstruct balances, since summing a
  // bounded window of Transfer deltas yields wrong/negative balances for anyone who
  // acquired before the window (see audit). Real balances come from balanceOf below.
  const candidates = new Set<string>();
  for (const lg of logs) {
    const a = lg.args || {};
    const f = ((a.from as string) || '').toLowerCase();
    const t = ((a.to as string) || '').toLowerCase();
    if (f && !excl.has(f)) candidates.add(f);
    if (t && !excl.has(t)) candidates.add(t);
  }
  const addrs = [...candidates];
  if (addrs.length === 0) return [];

  // Read each candidate's REAL current balance on-chain (multicall). This is the
  // authoritative balance regardless of when the holder acquired their tokens.
  let results: any[] = [];
  try {
    results = await mc({
      contracts: addrs.map((a) => ({ address: token, abi: tokenAbi, functionName: 'balanceOf', args: [a as Address] })),
      allowFailure: true,
    });
  } catch { return []; }

  const SUPPLY = 1_000_000_000n * 10n ** 18n;
  return addrs
    .map((a, i) => [a, (results[i]?.result as bigint) ?? 0n] as [string, bigint])
    .filter(([, v]) => v > 0n)
    .sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0))
    .slice(0, 50)
    .map(([a, v]) => ({ address: a, balance: v.toString(), pct: Number((v * 10000n) / SUPPLY) / 100 }));
}

// ─── Lightweight per-card stats (volume + sparkline) for the homepage ────────
/** Small recent-window scan → volume (MON) + a price sparkline for token cards. */
export async function getV3CardStats(curve: Address): Promise<{ volMon: number; spark: number[] }> {
  try {
    const trades = await getV3Trades(curve, LOGS_CARD_LOOKBACK, LOGS_CHUNK); // small window; cached
    const volMon = trades.reduce((s, t) => s + (t.mon || 0), 0);
    const priced = trades.filter((t) => t.price > 0).sort((a, b) => a.time - b.time).map((t) => t.price);
    let spark = priced;
    if (priced.length > 20) {
      const step = priced.length / 20;
      spark = Array.from({ length: 20 }, (_, i) => priced[Math.floor(i * step)]);
    }
    return { volMon, spark };
  } catch { return { volMon: 0, spark: [] }; }
}
