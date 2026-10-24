import type { NextApiRequest, NextApiResponse } from 'next';
import {
  MONSHI_TOKEN,
  DEAD_ADDRESS,
  PROTOCOL_BURN_TOKEN_BPS,
  PROTOCOL_BURN_MONSHI_BPS,
  PROTOCOL_PLATFORM_BPS,
  CREATOR_SALE_SHARE_BPS,
  CREATOR_PAYOUT_BPS,
  LP_FEE_SPLIT_COPY,
  FACTORY_V3,
  GRADUATOR_V3,
  MONAD_CHAIN_ID,
  UNISWAP_V3_NPM,
} from '@/lib/constants';

/** Public Monpad policy + addresses for bots, traders, snipers, and AI agents. */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).json({
    name: 'Monpad',
    chainId: MONAD_CHAIN_ID,
    policy: {
      botsAndSnipers: 'welcome',
      antiSniper: false,
      creatorDevBot: 'optional atomic first buy in createLaunch (same as Minta firstBuy)',
      mcp: 'mcp/server.mjs — AI agents can launch/buy/sell via MCP tools',
      sdk: '@monpad/sdk',
      liquidity: 'Uniswap V3 LP (Minta-style — no bonding curve)',
    },
    fees: {
      source: 'lp_fees',
      dex: 'uniswap_v3',
      poolFeeBps: 100, // Uniswap V3 pool fee tier 10000 = 1%
      split: {
        creatorBps: CREATOR_SALE_SHARE_BPS, // 80% headline (includes nested burn)
        creatorPayoutBps: CREATOR_PAYOUT_BPS, // ~70% paid to creator wallet
        burnTokenBpsNestedInCreator: PROTOCOL_BURN_TOKEN_BPS, // 10pts inside the 80%
        platformBps: PROTOCOL_PLATFORM_BPS, // 10%
        burnMonshiBps: PROTOCOL_BURN_MONSHI_BPS, // 10%
      },
      burnTokenBps: PROTOCOL_BURN_TOKEN_BPS,
      burnMonshiBps: PROTOCOL_BURN_MONSHI_BPS,
      platformBps: PROTOCOL_PLATFORM_BPS,
      creatorSaleShareBps: CREATOR_SALE_SHARE_BPS,
      platformOnSells: 'quote (MON) only — never project tokens',
      note: LP_FEE_SPLIT_COPY,
    },
    addresses: {
      factory: FACTORY_V3,
      graduator: GRADUATOR_V3,
      uniswapV3Npm: UNISWAP_V3_NPM,
      monshi: MONSHI_TOKEN,
      dead: DEAD_ADDRESS,
    },
  });
}
