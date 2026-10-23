#!/usr/bin/env node
/**
 * Monpad MCP server — Uniswap V4 hook launcher on Monad.
 *
 *   npx @monpad/mcp   OR   node mcp/server.mjs
 *
 * Writes use MONPAD_PRIVATE_KEY only when dryRun=false. Default dryRun=true.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { addressSchema, bytes32Schema } from './lib/schemas.mjs';
import {
  getSpec,
  getMonshiBurn,
  listLaunches,
  getToken,
  trending,
  launchToken,
  buy,
  sell,
} from './lib/actions.mjs';

const server = new McpServer({
  name: 'monpad',
  version: '0.2.1',
});

server.tool('monpad_get_spec', 'Monpad V4 fee policy, contract addresses, and safety limits.', {}, async () => getSpec());

server.tool(
  'monpad_get_monshi_burn',
  'Live Monchi (MONSHI) burn stats — balance at the dead address.',
  {},
  async () => getMonshiBurn(),
);

server.tool(
  'monpad_list_launches',
  'List recent Monpad V4 token launches (newest first).',
  { limit: z.number().int().min(1).max(50).optional().describe('Max launches (default 10)') },
  async ({ limit }) => listLaunches({ limit }),
);

server.tool(
  'monpad_get_token',
  'V4 pool token: price, liquidity, approximate MON volume, creator tax from launcher/hook.',
  { token: addressSchema.describe('Token contract address') },
  async ({ token }) => getToken({ token }),
);

server.tool(
  'monpad_trending',
  'Tokens ranked by approximate MON swap volume in recent blocks.',
  {
    limit: z.number().int().min(1).max(50).optional(),
    windowBlocks: z.number().int().min(100).max(50000).optional(),
  },
  async ({ limit, windowBlocks }) => trending({ limit, windowBlocks }),
);

const dryRunSchema = z.boolean().optional().describe('Simulate only (default true; no private key required)');

server.tool(
  'monpad_launch_token',
  'Launch a token into a Uniswap V4 Monpad pool. dryRun defaults to true (no key). Set dryRun=false + MONPAD_PRIVATE_KEY to send.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    creatorTaxBps: z.number().int().min(0).max(500).optional().describe('Extra creator tax 0–500 (0–5%)'),
    devBuyMon: z.string().optional().describe('Optional dev buy MON (counts toward spend limits)'),
    salt: bytes32Schema.optional().describe('bytes32 salt; random if omitted'),
    dryRun: dryRunSchema,
  },
  async (args) => launchToken(args),
);

server.tool(
  'monpad_buy',
  'One payable tx: MON → token via MonpadV4Router.buyExactIn. Requires minTokensOut. Simulated before send when dryRun=false.',
  {
    token: addressSchema.describe('Token to buy'),
    monIn: z.string().describe('MON to spend, e.g. "0.5"'),
    minTokensOut: z.string().describe('Minimum tokens out (wei); reverts on-chain if not met'),
    dryRun: dryRunSchema,
  },
  async (args) => buy(args),
);

server.tool(
  'monpad_sell',
  'Token → MON via MonpadV4Router.sellExactIn. Requires minMonOut. Sell proceeds count toward MAX_MON_PER_DAY.',
  {
    token: addressSchema.describe('Token to sell'),
    tokensIn: z.string().describe('Token amount in wei'),
    minMonOut: z.string().describe('Minimum native MON out (wei)'),
    dryRun: dryRunSchema,
  },
  async (args) => sell(args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
