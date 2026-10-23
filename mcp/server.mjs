#!/usr/bin/env node
/**
 * Monpad MCP server — Uniswap V4 hook launcher on Monad.
 *
 *   npx @monpad/mcp   OR   node mcp/server.mjs
 *
 * Writes use MONPAD_PRIVATE_KEY only. Default dryRun=true on launch/buy/sell.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
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
  version: '0.2.0',
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
  { token: z.string().describe('Token contract address') },
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

const dryRunSchema = z.boolean().optional().describe('Simulate only (default true)');

server.tool(
  'monpad_launch_token',
  'Launch a token into a Uniswap V4 Monpad pool. Requires MONPAD_PRIVATE_KEY. dryRun defaults to true.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    creatorTaxBps: z.number().int().min(0).max(500).optional().describe('Extra creator tax 0–500 (0–5%)'),
    devBuyMon: z.string().optional().describe('Optional dev buy MON (counts toward spend limits)'),
    salt: z.string().optional().describe('bytes32 salt; random if omitted'),
    dryRun: dryRunSchema,
  },
  async (args) => launchToken(args),
);

server.tool(
  'monpad_buy',
  'Buy token with native MON via configured V4 trader. Requires MONPAD_PRIVATE_KEY. dryRun defaults to true.',
  {
    token: z.string().describe('Token to buy'),
    monIn: z.string().describe('MON to spend, e.g. "0.5"'),
    dryRun: dryRunSchema,
  },
  async (args) => buy(args),
);

server.tool(
  'monpad_sell',
  'Sell token for native MON via configured V4 trader. Requires MONPAD_PRIVATE_KEY. dryRun defaults to true.',
  {
    token: z.string().describe('Token to sell'),
    tokensIn: z.string().describe('Token amount in wei'),
    dryRun: dryRunSchema,
  },
  async (args) => sell(args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
