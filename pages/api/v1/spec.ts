import type { NextApiRequest, NextApiResponse } from 'next';
import {
  MONPAD_PLATFORM_WALLET,
  MONSHI_TOKEN,
  DEAD_ADDRESS,
  PROTOCOL_BURN_TOKEN_BPS,
  PROTOCOL_BURN_MONSHI_BPS,
  PROTOCOL_PLATFORM_BPS,
  CREATOR_SALE_SHARE_BPS,
  FACTORY_V3,
  GRADUATOR_V3,
  MONAD_CHAIN_ID,
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
    },
    fees: {
      burnTokenBps: PROTOCOL_BURN_TOKEN_BPS,
      burnMonshiBps: PROTOCOL_BURN_MONSHI_BPS,
      platformBps: PROTOCOL_PLATFORM_BPS,
      creatorSaleShareBps: CREATOR_SALE_SHARE_BPS,
      platformOnSells: 'quote (MON) only — never project tokens',
      creatorTax: 'independent, creator-set',
    },
    addresses: {
      factory: FACTORY_V3,
      graduator: GRADUATOR_V3,
      platformWallet: MONPAD_PLATFORM_WALLET,
      monshi: MONSHI_TOKEN,
      dead: DEAD_ADDRESS,
    },
  });
}
