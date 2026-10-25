#!/usr/bin/env node
/**
 * Monpad MCP server (self-hosted, with your own burner wallet). For most people the hosted connector is easier:
 * add https://www.monpad.net/api/mcp to your AI app, no install and no key. This server is for agents that should trade on their own.
 *
 *   npx -y @monpad/mcp
 *
 * Every write tool is a dry run (a live quote) unless you pass dryRun=false AND set MONPAD_PRIVATE_KEY.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { addressSchema } from './lib/schemas.mjs';
import { getSpec, getMonshiBurn, listLaunches, getToken, trending, wallet, launchToken, buy, sell, claimFees } from './lib/actions.mjs';

const server = new McpServer({ name: 'monpad', version: '0.3.0' });

const run = (fn) => async (args) => {
  try { return await fn(args); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: String(e?.shortMessage || e?.message || e).slice(0, 400) }] }; }
};
const dryRun = z.boolean().optional().describe('Default true: only show a live quote. Set false to send (needs MONPAD_PRIVATE_KEY).');

server.tool('monpad_get_spec', 'Fees, fee split, contract addresses and your safety limits.', {}, run(getSpec));
server.tool('monpad_get_monshi_burn', 'How much MONSHI has been burned.', {}, run(getMonshiBurn));
server.tool('monpad_list_launches', 'Newest Monpad coins with price and market cap in USD.', { limit: z.number().int().min(1).max(50).optional() }, run(listLaunches));
server.tool('monpad_get_token', 'Price, market cap, creator tax and total fee for one coin.', { token: addressSchema }, run(getToken));
server.tool('monpad_trending', 'The biggest coins by market cap.', { limit: z.number().int().min(1).max(50).optional() }, run(trending));
server.tool('monpad_wallet', 'Your burner wallet: address, MON balance, optional balance of one coin, claimable creator fees.', { token: addressSchema.optional() }, run(wallet));

server.tool(
  'monpad_launch_token',
  'Launch a coin. Free to launch; optionally buy some at launch with MON. Creator tax 0-5%.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    creatorTaxPct: z.number().min(0).max(5).optional().describe('Creator tax in percent, 0 to 5 (default 0). It burns the coin.'),
    devBuyMon: z.string().optional().describe('MON to spend on a first buy, e.g. "2" (counts toward your limits)'),
    dryRun,
  },
  run(launchToken),
);

server.tool(
  'monpad_buy',
  'Buy a coin with MON. The minimum you receive is set automatically from a live quote.',
  { token: addressSchema, monIn: z.string().describe('MON to spend, e.g. "0.5"'), slippagePct: z.number().min(0.1).max(20).optional().describe('Allowed price move in percent (default 1)'), dryRun },
  run(buy),
);

server.tool(
  'monpad_sell',
  'Sell a coin for MON. Pass tokens (e.g. "1000") or percent of your balance (e.g. 50).',
  { token: addressSchema, tokens: z.string().optional(), percent: z.number().min(1).max(100).optional(), slippagePct: z.number().min(0.1).max(20).optional(), dryRun },
  run(sell),
);

server.tool(
  'monpad_claim_fees',
  'Claim the creator fees you have earned (USDC by default, or a coin you launched).',
  { token: addressSchema.optional().describe('Leave empty for USDC'), dryRun },
  run(claimFees),
);

await server.connect(new StdioServerTransport());
