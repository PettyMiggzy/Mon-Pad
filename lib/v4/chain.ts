// Read side + quotes for Monpad V4 pools (USDC / token). Prices are USDC per whole token (6 vs 18 decimals handled).
import { encodeAbiParameters, keccak256, maxUint256, toHex, zeroAddress, type Address, type Hex } from 'viem';
import { publicClient } from '../chainV3';
import type { TokenSummary } from '../api';
import { DYNAMIC_FEE, HOOK_V4, LAUNCHER_V4, ROUTER_V4, STATE_VIEW_V4, TICK_SPACING, BASE_FEE_BPS, MON_USDC_FEE, MON_USDC_TICK_SPACING } from './config';
import { erc20V4Abi, launcherV4Abi, routerV4Abi, stateViewV4Abi } from './abis';

const pc = publicClient as any; // the app's client is typed loosely elsewhere; keep the V4 reads simple
const TOKEN_SUPPLY = 1_000_000_000;

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

let quoteCache: Address | null = null;
export async function getQuoteAsset(): Promise<Address> {
  if (quoteCache) return quoteCache;
  quoteCache = (await pc.readContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'quoteAsset' })) as Address;
  return quoteCache;
}

export const quoteIsCurrency0 = (quote: Address, token: Address) => BigInt(quote) < BigInt(token);

export function poolKeyFor(token: Address, quote: Address): PoolKey {
  const q0 = quoteIsCurrency0(quote, token);
  return { currency0: q0 ? quote : token, currency1: q0 ? token : quote, fee: DYNAMIC_FEE, tickSpacing: TICK_SPACING, hooks: HOOK_V4 };
}

/** Whole USDC per whole token from sqrtPriceX96 (raw price is currency1/currency0 in base units; USDC has 6 decimals, tokens 18). */
export function usdcPerToken(sqrtPriceX96: bigint, quoteIs0: boolean): number {
  const raw = Number(sqrtPriceX96 * sqrtPriceX96) / Number(2n ** 192n);
  if (!(raw > 0) || !Number.isFinite(raw)) return 0;
  return quoteIs0 ? 1e12 / raw : raw * 1e12;
}

export type V4Token = {
  address: Address;
  name: string;
  symbol: string;
  creator: Address;
  taxBps: number;
  poolId: Hex;
  priceUsdc: number;
  mcapUsdc: number;
  liquidity: bigint;
  totalFeeBps: number;
};

async function readOne(token: Address): Promise<V4Token | null> {
  const [creator, taxBps, , poolId] = (await pc.readContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'launches', args: [token] })) as [Address, number, bigint, Hex];
  if (creator === zeroAddress) return null;
  const quote = await getQuoteAsset();
  const [name, symbol, slot0, liquidity] = await Promise.all([
    pc.readContract({ address: token, abi: erc20V4Abi, functionName: 'name' }).catch(() => '?'),
    pc.readContract({ address: token, abi: erc20V4Abi, functionName: 'symbol' }).catch(() => '?'),
    pc.readContract({ address: STATE_VIEW_V4, abi: stateViewV4Abi, functionName: 'getSlot0', args: [poolId] }),
    pc.readContract({ address: STATE_VIEW_V4, abi: stateViewV4Abi, functionName: 'getLiquidity', args: [poolId] }),
  ]);
  const price = usdcPerToken((slot0 as any)[0] as bigint, quoteIsCurrency0(quote, token));
  return { address: token, name: name as string, symbol: symbol as string, creator, taxBps: Number(taxBps), poolId, priceUsdc: price, mcapUsdc: price * TOKEN_SUPPLY, liquidity: liquidity as bigint, totalFeeBps: BASE_FEE_BPS + Number(taxBps) };
}

export const getV4Token = (token: Address) => readOne(token);

/** True when `token` was launched by the Monpad V4 launcher. */
export async function isV4Token(token: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return false;
  try {
    const r = (await pc.readContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'launches', args: [token as Address] })) as [Address];
    return r[0] !== zeroAddress;
  } catch {
    return false;
  }
}

/** Newest first. Shaped like the existing board's TokenSummary; amounts are USDC (see `quote`), stored with 18 decimals. */
export async function listV4Tokens(limit = 60): Promise<TokenSummary[]> {
  const n = Number(await pc.readContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'tokenCount' }));
  const idx = Array.from({ length: Math.min(n, limit) }, (_, i) => n - 1 - i);
  const tokens = (await Promise.all(idx.map((i) => pc.readContract({ address: LAUNCHER_V4, abi: launcherV4Abi, functionName: 'allTokens', args: [BigInt(i)] })))) as Address[];
  const rows = await Promise.all(tokens.map((t) => readOne(t).catch(() => null)));
  return rows
    .filter((r): r is V4Token => !!r)
    .map((t) => ({
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      creator: t.creator,
      marketCapMon: BigInt(Math.round(t.mcapUsdc * 1e6)) * 10n ** 12n + '',
      volume24hMon: '0',
      monRaisedNet: '0',
      graduated: false,
      createdAt: 0,
      sparkline: [],
      quote: 'USDC' as const,
      feeBps: t.totalFeeBps,
    }));
}

// ── quotes (eth_call). USDC is a Circle FiatToken v2: balances are storage slot 9, allowances slot 10 (checked on Monad). ──
const slot = (owner: Address, mappingSlot: bigint): Hex => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [owner, mappingSlot]));
const allowanceSlot = (owner: Address, spender: Address, mappingSlot: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [spender, slot(owner, mappingSlot)]));

const usdcOverride = (usdc: Address, owner: Address, spender: Address, amount: bigint) => ({
  address: usdc,
  stateDiff: [
    { slot: slot(owner, 9n), value: toHex(amount, { size: 32 }) },
    { slot: allowanceSlot(owner, spender, 10n), value: toHex(amount, { size: 32 }) },
  ],
});
const tokenOverride = (token: Address, owner: Address, spender: Address, balance?: bigint) => ({
  address: token,
  stateDiff: [
    { slot: allowanceSlot(owner, spender, 1n), value: toHex(maxUint256, { size: 32 }) }, // OpenZeppelin _allowances = slot 1
    ...(balance !== undefined ? [{ slot: slot(owner, 0n), value: toHex(balance, { size: 32 }) }] : []), // _balances = slot 0 (anonymous quotes only)
  ],
});

const SIM_FROM = '0x000000000000000000000000000000000000dEaD' as Address;
const dl = () => BigInt(Math.floor(Date.now() / 1000) + 600);

export async function quoteBuy(token: Address, usdcIn: bigint, from?: Address): Promise<bigint> {
  const quote = await getQuoteAsset();
  const account = from ?? SIM_FROM;
  const { result } = await pc.simulateContract({
    address: ROUTER_V4, abi: routerV4Abi, functionName: 'buyWithUsdc',
    args: [poolKeyFor(token, quote), usdcIn, 0n, dl(), 0n], account, stateOverride: [usdcOverride(quote, account, ROUTER_V4, usdcIn)],
  });
  return result as bigint;
}

export async function quoteSell(token: Address, tokensIn: bigint, from?: Address): Promise<bigint> {
  const quote = await getQuoteAsset();
  const account = from ?? SIM_FROM;
  const { result } = await pc.simulateContract({
    address: ROUTER_V4, abi: routerV4Abi, functionName: 'sellToUsdc',
    args: [poolKeyFor(token, quote), tokensIn, 0n, dl(), 0n], account, stateOverride: [tokenOverride(token, account, ROUTER_V4, from ? undefined : tokensIn)],
  });
  return result as bigint;
}

/** MON in → tokens out (router swaps MON→USDC→token). Simulated with the caller's MON balance topped up so a quote never fails on funds. */
export async function quoteBuyMon(token: Address, monIn: bigint, from?: Address): Promise<bigint> {
  const quote = await getQuoteAsset();
  const account = from ?? SIM_FROM;
  const { result } = await pc.simulateContract({
    address: ROUTER_V4, abi: routerV4Abi, functionName: 'buyWithMon',
    args: [poolKeyFor(token, quote), 0n, 0n, dl(), 0n, 0n], account, value: monIn, stateOverride: [{ address: account, balance: monIn + 10n ** 18n }],
  });
  return result as bigint;
}

/** Tokens in → MON out (token→USDC→MON). */
export async function quoteSellMon(token: Address, tokensIn: bigint, from?: Address): Promise<bigint> {
  const quote = await getQuoteAsset();
  const account = from ?? SIM_FROM;
  const { result } = await pc.simulateContract({
    address: ROUTER_V4, abi: routerV4Abi, functionName: 'sellToMon',
    args: [poolKeyFor(token, quote), tokensIn, 0n, 0n, dl(), 0n, 0n], account, stateOverride: [tokenOverride(token, account, ROUTER_V4, from ? undefined : tokensIn)],
  });
  return result as bigint;
}

export const deadline = dl;

export type DepthRow = { usdc: number; avgPrice: number | null; impactPct: number | null };

/** Price impact by trade size, from real router simulations (includes fees). Not resting orders. */
export async function poolDepth(t: V4Token, sizesUsdc = [50, 250, 1000, 5000]): Promise<{ buys: DepthRow[]; sells: DepthRow[] }> {
  if (!(t.priceUsdc > 0)) return { buys: [], sells: [] };
  const buys = await Promise.all(sizesUsdc.map(async (usdc): Promise<DepthRow> => {
    try {
      const out = await quoteBuy(t.address, BigInt(Math.round(usdc * 1e6)));
      const tokens = Number(out) / 1e18;
      const avg = tokens > 0 ? usdc / tokens : null;
      return { usdc, avgPrice: avg, impactPct: avg ? (avg / t.priceUsdc - 1) * 100 : null };
    } catch { return { usdc, avgPrice: null, impactPct: null }; }
  }));
  const sells = await Promise.all(sizesUsdc.map(async (usdc): Promise<DepthRow> => {
    try {
      const tokensIn = usdc / t.priceUsdc;
      const out = await quoteSell(t.address, BigInt(Math.round(tokensIn * 1e6)) * 10n ** 12n);
      const got = Number(out) / 1e6;
      const avg = got > 0 ? got / tokensIn : null;
      return { usdc, avgPrice: avg, impactPct: avg ? (1 - avg / t.priceUsdc) * 100 : null };
    } catch { return { usdc, avgPrice: null, impactPct: null }; }
  }));
  return { buys, sells };
}

/** USDC base units (6 dec) per 1 wei of MON, from the MON/USDC pool. Used to size the minimum-out of launchWithMon. */
export async function monUsdcRaw(): Promise<number> {
  const quote = await getQuoteAsset();
  const id = keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [zeroAddress, quote, MON_USDC_FEE, MON_USDC_TICK_SPACING, zeroAddress],
  ));
  const slot0 = (await pc.readContract({ address: STATE_VIEW_V4, abi: stateViewV4Abi, functionName: 'getSlot0', args: [id] })) as any;
  const sqrt = slot0[0] as bigint;
  return Number(sqrt * sqrt) / Number(2n ** 192n);
}
