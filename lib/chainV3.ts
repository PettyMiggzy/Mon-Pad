// lib/chainV3.ts
// On-chain data layer for the V3 (native-MON) pad. Reads launches + curve state
// directly from the factory/curves so the app works even before the indexer is
// updated for V3. Uses a viem public client (QuickNode RPC) + multicall.

import { createPublicClient, http, type Address } from 'viem';
import { FACTORY_V3, MONAD_CHAIN_ID, MONAD_RPC_URL, V3_GRADUATION_TARGET_MON } from './constants';
import { factoryV3Abi, curveV3Abi, tokenAbi } from './abis';

const monadChain = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } },
} as const;

export const publicClient = createPublicClient({ chain: monadChain, transport: http(MONAD_RPC_URL) });

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
export async function listV3Tokens(limit = 60): Promise<V3Token[]> {
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
