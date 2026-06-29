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
} as const;

// retryCount: 1 so a rejected request (e.g. a provider 413/429) doesn't retry-storm.
export const publicClient = createPublicClient({
  chain: monadChain,
  transport: http(MONAD_RPC_URL, { retryCount: 1, timeout: 12_000 }),
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

export type Candle = { time: number; open: number; high: number; low: number; close: number };

/**
 * Read recent Trade events for a curve. Scans a bounded window of recent blocks,
 * chunking the range so public RPCs that cap getLogs spans still work. Newest first.
 */
export async function getV3Trades(curve: Address, lookbackBlocks = 12_000n, chunk = 1_000n): Promise<V3Trade[]> {
  if (!curve || curve === ('0x0000000000000000000000000000000000000000' as Address)) return [];
  let head: bigint;
  try { head = await publicClient.getBlockNumber(); } catch { return []; }
  const from = head > lookbackBlocks ? head - lookbackBlocks : 0n;

  const trades: V3Trade[] = [];
  for (let start = head; start >= from; start -= chunk + 1n) {
    const end = start;
    const begin = start > chunk ? start - chunk : 0n;
    let logs: any[] = [];
    try {
      logs = (await (publicClient.getLogs as any)({ address: curve, event: TRADE_EVENT, fromBlock: begin, toBlock: end })) as any[];
    } catch {
      // Range too wide for this RPC — skip this chunk rather than fail the whole feed.
      if (begin === 0n) break;
      continue;
    }
    for (const lg of logs) {
      const a = lg.args || {};
      trades.push({
        txHash: lg.transactionHash as string,
        trader: a.trader as Address,
        isBuy: Boolean(a.isBuy),
        mon: Number(formatEther((a.monAmount as bigint) ?? 0n)),
        tokens: Number(formatEther((a.tokenAmount as bigint) ?? 0n)),
        price: Number(formatEther((a.priceX18 as bigint) ?? 0n)),
        time: Number((a.tradedAt as bigint) ?? 0n),
        block: (lg.blockNumber as bigint) ?? 0n,
      });
    }
    if (begin === 0n) break;
  }
  // Newest first, dedup by (tx + logIndex isn't tracked) — sort by block then time.
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
    if (!c) buckets.set(bt, { time: bt, open: t.price, high: t.price, low: t.price, close: t.price });
    else { c.high = Math.max(c.high, t.price); c.low = Math.min(c.low, t.price); c.close = t.price; }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
