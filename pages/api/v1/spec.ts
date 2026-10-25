import type { NextApiRequest, NextApiResponse } from 'next';
import { MONSHI_TOKEN, DEAD_ADDRESS, MONAD_CHAIN_ID } from '@/lib/constants';
import { HOOK_V4, LAUNCHER_V4, ROUTER_V4, STATE_VIEW_V4, v4Configured } from '@/lib/v4/config';
import { LP_FEE_SLICES } from '@/lib/fees';

/** Public Monpad policy + addresses for bots, traders and AI agents. */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json({
    name: 'Monpad',
    chainId: MONAD_CHAIN_ID,
    live: v4Configured(),
    policy: {
      botsAndSnipers: 'welcome',
      antiSniper: false,
      creationFee: 'free',
      liquidity: 'Uniswap V4, single-sided, locked in the launcher. Pools are quoted in USDC; pay and receive MON through the router.',
      supply: 1_000_000_000,
      ai: 'https://www.monpad.net/api/mcp (MCP over HTTP, read tools + buy/sell/launch links)',
    },
    fees: {
      source: 'v4_hook',
      baseFeeBps: 100,
      creatorTaxBps: '0-500 (burns the coin)',
      split: LP_FEE_SLICES.map((s) => ({ id: s.id, label: s.label, bps: s.bps })),
    },
    addresses: {
      launcher: LAUNCHER_V4,
      hook: HOOK_V4,
      router: ROUTER_V4,
      stateView: STATE_VIEW_V4,
      usdc: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
      poolManager: '0x188d586ddcf52439676ca21a244753fa19f9ea8e',
      monshi: MONSHI_TOKEN,
      dead: DEAD_ADDRESS,
    },
    endpoints: { spec: '/api/v1/spec', burn: '/api/v1/burn', candles: '/api/v1/candles?pool=<poolId>&tf=5m', mcp: '/api/mcp' },
  });
}
