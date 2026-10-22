// Live MONSHI (Monchi) burn stats — balance at the dead address is total burned.
import { formatEther, parseAbi, type Address } from 'viem';
import { publicClient } from './chainV3';
import { DEAD_ADDRESS, MONSHI_TOKEN } from './constants';

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);

export type MonshiBurnStats = {
  burned: bigint;
  burnedWhole: number;
  totalSupply: bigint;
  circulatingWhole: number;
  updatedAt: number;
};

let cache: MonshiBurnStats | null = null;
let inflight: Promise<MonshiBurnStats> | null = null;

export async function fetchMonshiBurnStats(force = false): Promise<MonshiBurnStats> {
  if (!force && cache && Date.now() - cache.updatedAt < 8_000) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const token = MONSHI_TOKEN as Address;
    const dead = DEAD_ADDRESS as Address;
    const [burned, totalSupply] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [dead] }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'totalSupply' }),
    ]);
    const burnedWhole = Number(formatEther(burned));
    const circ = totalSupply > burned ? totalSupply - burned : 0n;
    const stats: MonshiBurnStats = {
      burned,
      burnedWhole,
      totalSupply,
      circulatingWhole: Number(formatEther(circ)),
      updatedAt: Date.now(),
    };
    cache = stats;
    return stats;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
