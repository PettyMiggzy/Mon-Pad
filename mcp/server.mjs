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
  buyWithMon,
  sell,
  sellForMon,
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
  'V4 pool token: price in USDC, liquidity, approximate USDC volume, creator tax from launcher/hook.',
  { token: addressSchema.describe('Token contract address') },
  async ({ token }) => getToken({ token }),
);

server.tool(
  'monpad_trending',
  'Tokens ranked by approximate USDC swap volume in recent blocks.',
  {
    limit: z.number().int().min(1).max(50).optional(),
    windowBlocks: z.number().int().min(100).max(50000).optional(),
  },
  async ({ limit, windowBlocks }) => trending({ limit, windowBlocks }),
);

const dryRunSchema = z.boolean().optional().describe('Simulate only (default true; no private key required)');

server.tool(
  'monpad_launch_token',
  'Launch a token into a Uniswap V4 Monpad pool paired with USDC. The creation fee and optional dev buy are paid in USDC (approved automatically when sending). dryRun defaults to true (no key). Set dryRun=false + MONPAD_PRIVATE_KEY to send.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    creatorTaxBps: z.number().int().min(0).max(500).optional().describe('Extra creator tax 0–500 (0–5%)'),
    devBuyUsdc: z.string().optional().describe('Optional dev buy in USDC, e.g. "50" (counts toward USDC spend limits)'),
    salt: bytes32Schema.optional().describe('bytes32 salt; random if omitted'),
    dryRun: dryRunSchema,
  },
  async (args) => launchToken(args),
);

server.tool(
  'monpad_buy',
  'Buy a token with USDC via MonpadV4Router.buyWithUsdc (the router is approved for exactly usdcIn). Requires minTokensOut. Simulated before send when dryRun=false.',
  {
    token: addressSchema.describe('Token to buy'),
    usdcIn: z.string().describe('USDC to spend, e.g. "25"'),
    minTokensOut: z.string().describe('Minimum tokens out (wei); reverts on-chain if not met'),
    dryRun: dryRunSchema,
  },
  async (args) => buy(args),
);

server.tool(
  'monpad_buy_with_mon',
  'Buy a token with native MON via MonpadV4Router.buyWithMon: MON → USDC on the hookless MON/USDC pool, then USDC → token. minTokensOut guards the whole trade; optional minUsdcOut guards the MON → USDC leg.',
  {
    token: addressSchema.describe('Token to buy'),
    monIn: z.string().describe('MON to spend, e.g. "0.5"'),
    minTokensOut: z.string().describe('Minimum tokens out (wei)'),
    minUsdcOut: z.string().optional().describe('Minimum USDC out of the MON → USDC leg (base units, 6 decimals)'),
    dryRun: dryRunSchema,
  },
  async (args) => buyWithMon(args),
);

server.tool(
  'monpad_sell',
  'Sell a token for USDC via MonpadV4Router.sellToUsdc. Requires minUsdcOut. Sell proceeds count toward MAX_USDC_PER_DAY.',
  {
    token: addressSchema.describe('Token to sell'),
    tokensIn: z.string().describe('Token amount in wei'),
    minUsdcOut: z.string().describe('Minimum USDC out (base units, 6 decimals)'),
    dryRun: dryRunSchema,
  },
  async (args) => sell(args),
);

server.tool(
  'monpad_sell_for_mon',
  'Sell a token for native MON via MonpadV4Router.sellToMon (token → USDC → MON). Requires minMonOut. Proceeds count toward MAX_MON_PER_DAY.',
  {
    token: addressSchema.describe('Token to sell'),
    tokensIn: z.string().describe('Token amount in wei'),
    minMonOut: z.string().describe('Minimum native MON out (wei)'),
    minUsdcOut: z.string().optional().describe('Minimum USDC out of the token → USDC leg (base units, 6 decimals)'),
    dryRun: dryRunSchema,
  },
  async (args) => sellForMon(args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
