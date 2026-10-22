#!/usr/bin/env node
/**
 * Monpad MCP server — AI-friendly launchpad surface on Monad.
 *
 * Tools let any MCP client (Cursor, Claude Desktop, custom agents):
 *   • discover fee/spec + addresses
 *   • list launches / inspect a token curve
 *   • read live Monchi (MONSHI) burn stats
 *   • launch a token with optional Minta-style "dev bot" (atomic first buy)
 *   • buy / sell on a curve
 *
 * Policy: bots & snipers welcome — no anti-sniper protection.
 * Writes require MONPAD_PRIVATE_KEY (or PRIVATE_KEY) in the environment.
 *
 *   npx @monpad/mcp   OR   node mcp/server.mjs
 *
 * Cursor MCP config example:
 *   { "mcpServers": { "monpad": { "command": "node", "args": ["/path/to/mcp/server.mjs"],
 *     "env": { "RPC_URL": "...", "MONPAD_FACTORY": "0x...", "MONPAD_PRIVATE_KEY": "0x..." } } } }
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  parseAbi,
} from 'viem';
import { privateKeyToAccount as pkAccount } from 'viem/accounts';

const MONAD_CHAIN_ID = 143;
const MONSHI = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const PLATFORM = '0x5899a0576A94327a6316E01190f951edf7645914';
const FEES = {
  burnTokenBps: 1000,
  burnMonshiBps: 1000,
  platformBps: 1000,
  creatorSaleShareBps: 8000,
  defaultSlippageBps: 200,
  antiSniper: false,
  botsWelcome: true,
};

const monad = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL || 'https://rpc.monad.xyz'] } },
};

const publicClient = createPublicClient({
  chain: monad,
  transport: http(process.env.RPC_URL || process.env.MONAD_RPC || 'https://rpc.monad.xyz'),
});

function factory() {
  const f = process.env.MONPAD_FACTORY || process.env.NEXT_PUBLIC_FACTORY_V3 || process.env.FACTORY_V3;
  if (!f) throw new Error('Set MONPAD_FACTORY (or NEXT_PUBLIC_FACTORY_V3)');
  return f;
}

function wallet() {
  const pk = process.env.MONPAD_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('Set MONPAD_PRIVATE_KEY to enable write tools (launch / buy / sell)');
  const account = pkAccount(pk);
  return createWalletClient({ account, chain: monad, transport: http(process.env.RPC_URL || 'https://rpc.monad.xyz') });
}

const factoryAbi = parseAbi([
  'function creationFeeFor(address) view returns (uint256)',
  'function allCounts() view returns (uint256, uint256)',
  'function allTokens(uint256) view returns (address)',
  'function allCurves(uint256) view returns (address)',
  'function createLaunch(string name, string symbol, (uint16,uint16,uint16,uint16) cfg) payable returns (address,address)',
]);
const curveAbi = parseAbi([
  'function buy(uint256 minTokensOut) payable returns (uint256)',
  'function sell(uint256 tokensIn, uint256 minMonOut) returns (uint256)',
  'function token() view returns (address)',
  'function creator() view returns (address)',
  'function graduated() view returns (bool)',
  'function monRaisedNet() view returns (uint256)',
  'function priceWeiPerToken() view returns (uint256)',
]);
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function approve(address,uint256) returns (bool)',
]);

const server = new McpServer({
  name: 'monpad',
  version: '0.1.0',
});

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
}

server.tool(
  'monpad_get_spec',
  'Monpad fee policy, platform wallet, Monchi token, and bot/AI policy (snipers welcome, no anti-sniper).',
  {},
  async () =>
    ok({
      chainId: MONAD_CHAIN_ID,
      name: 'Monpad',
      platformWallet: PLATFORM,
      monshi: MONSHI,
      dead: DEAD,
      fees: FEES,
      creatorDevBot:
        'Optional atomic first buy in createLaunch (devBuyMon) — same as Minta firstBuyUsdc so the creator is not sniped on their own launch.',
      factory: process.env.MONPAD_FACTORY || process.env.NEXT_PUBLIC_FACTORY_V3 || null,
    }),
);

server.tool(
  'monpad_get_monshi_burn',
  'Live Monchi (MONSHI) burn stats — balance at the dead address (what the site burn counter shows).',
  {},
  async () => {
    const [burned, totalSupply] = await Promise.all([
      publicClient.readContract({ address: MONSHI, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] }),
      publicClient.readContract({ address: MONSHI, abi: erc20Abi, functionName: 'totalSupply' }),
    ]);
    return ok({
      burned: burned.toString(),
      burnedFormatted: formatEther(burned),
      circulatingFormatted: formatEther(totalSupply > burned ? totalSupply - burned : 0n),
      totalSupply: totalSupply.toString(),
    });
  },
);

server.tool(
  'monpad_list_launches',
  'List recent Monpad token launches (newest first).',
  { limit: z.number().int().min(1).max(50).optional().describe('Max launches to return (default 10)') },
  async ({ limit }) => {
    const f = factory();
    const n = Number((await publicClient.readContract({ address: f, abi: factoryAbi, functionName: 'allCounts' }))[0]);
    const take = Math.min(limit ?? 10, n);
    const launches = [];
    for (let i = n - 1; i >= n - take; i--) {
      const token = await publicClient.readContract({ address: f, abi: factoryAbi, functionName: 'allTokens', args: [BigInt(i)] });
      const curve = await publicClient.readContract({ address: f, abi: factoryAbi, functionName: 'allCurves', args: [BigInt(i)] });
      let name = '?', symbol = '?';
      try {
        name = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' });
        symbol = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
      } catch { /* */ }
      launches.push({ index: i, token, curve, name, symbol });
    }
    return ok({ count: n, launches });
  },
);

server.tool(
  'monpad_get_curve',
  'Read curve state for a Monpad launch (price, raised, graduated, creator, token).',
  { curve: z.string().describe('Curve contract address') },
  async ({ curve }) => {
    const [token, creator, graduated, monRaisedNet, priceWeiPerToken] = await Promise.all([
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'token' }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'creator' }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'graduated' }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'monRaisedNet' }),
      publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'priceWeiPerToken' }),
    ]);
    return ok({
      curve,
      token,
      creator,
      graduated,
      monRaisedNet: monRaisedNet.toString(),
      monRaisedNetFormatted: formatEther(monRaisedNet),
      priceWeiPerToken: priceWeiPerToken.toString(),
    });
  },
);

server.tool(
  'monpad_launch_token',
  'Deploy a token on Monpad. Optional devBuyMon = Minta-style creator first buy in the SAME tx (dev bot) so you are not sniped on your own launch. Requires MONPAD_PRIVATE_KEY.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(1).max(10),
    devBuyMon: z.string().optional().describe('MON amount for atomic first buy, e.g. "1" (dev bot)'),
    taxBurnTokenBps: z.number().int().min(0).max(1000).optional(),
    taxLpBps: z.number().int().min(0).max(1000).optional(),
  },
  async (args) => {
    const w = wallet();
    const f = factory();
    const fee = await publicClient.readContract({
      address: f,
      abi: factoryAbi,
      functionName: 'creationFeeFor',
      args: [w.account.address],
    });
    const dev = args.devBuyMon ? parseEther(args.devBuyMon) : 0n;
    const cfg = {
      cfBurnTokenBps: 0,
      cfLpBps: 0,
      taxBurnTokenBps: args.taxBurnTokenBps ?? 0,
      taxLpBps: args.taxLpBps ?? 0,
    };
    // viem tuple: pass as array matching (uint16,uint16,uint16,uint16)
    const hash = await w.writeContract({
      address: f,
      abi: factoryAbi,
      functionName: 'createLaunch',
      args: [args.name, args.symbol, [cfg.cfBurnTokenBps, cfg.cfLpBps, cfg.taxBurnTokenBps, cfg.taxLpBps]],
      value: fee + dev,
      chain: monad,
      account: w.account,
    });
    return ok({
      hash,
      creator: w.account.address,
      creationFeeMon: formatEther(fee),
      devBuyMon: args.devBuyMon || '0',
      note: 'Poll monpad_list_launches or wait for receipt logs for token/curve addresses.',
    });
  },
);

server.tool(
  'monpad_buy',
  'Buy tokens on a Monpad curve with native MON. Bots/snipers welcome. Requires MONPAD_PRIVATE_KEY.',
  {
    curve: z.string(),
    monIn: z.string().describe('MON to spend, e.g. "0.5"'),
    minTokensOut: z.string().optional().describe('Slippage floor in wei (default 0)'),
  },
  async ({ curve, monIn, minTokensOut }) => {
    const w = wallet();
    const hash = await w.writeContract({
      address: curve,
      abi: curveAbi,
      functionName: 'buy',
      args: [BigInt(minTokensOut || '0')],
      value: parseEther(monIn),
      chain: monad,
      account: w.account,
    });
    return ok({ hash, curve, monIn });
  },
);

server.tool(
  'monpad_sell',
  'Sell curve tokens for MON. Platform fee is taken in MON (quote), never as project tokens. Requires MONPAD_PRIVATE_KEY.',
  {
    curve: z.string(),
    tokensIn: z.string().describe('Token wei to sell'),
    minMonOut: z.string().optional(),
  },
  async ({ curve, tokensIn, minMonOut }) => {
    const w = wallet();
    const token = await publicClient.readContract({ address: curve, abi: curveAbi, functionName: 'token' });
    await w.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [curve, BigInt(tokensIn)],
      chain: monad,
      account: w.account,
    });
    const hash = await w.writeContract({
      address: curve,
      abi: curveAbi,
      functionName: 'sell',
      args: [BigInt(tokensIn), BigInt(minMonOut || '0')],
      chain: monad,
      account: w.account,
    });
    return ok({ hash, curve, tokensIn });
  },
);


// ── Launch by chat: draft, art, 3D character, and a ready-to-sign launch link ──
// The wallet signs one daily message (same as Monpad Studio); every paid step is charged in
// Monpad credits BEFORE it runs and refunded if it fails. Needs MONPAD_PRIVATE_KEY.
const SITE = (process.env.MONPAD_SITE || 'https://www.monpad.net').replace(/\/$/, '');

async function launchCall(path, body) {
  const pk = process.env.MONPAD_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('Set MONPAD_PRIVATE_KEY to use paid launch tools, or use ' + SITE + '/chat in a browser.');
  const acct = pkAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  const day = new Date().toISOString().slice(0, 10);
  const signature = await acct.signMessage({ message: `Mon-Pad Studio: ${acct.address.toLowerCase()} ${day}` });
  const res = await fetch(`${SITE}/api/v1/launch/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: acct.address, signature, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
  return data;
}

server.tool(
  'monpad_launch_prices',
  'Prices (in Monpad credits, 1 credit = $0.01) for launch-by-chat: draft, art, 3D living character.',
  {},
  async () => ok(await (await fetch(`${SITE}/api/v1/launch/prices`)).json()),
);

server.tool(
  'monpad_draft_launch',
  'Turn a one-sentence idea into a launch draft (name, ticker, description, image prompt). Costs credits; refunded if it fails or is refused.',
  { idea: z.string().min(3).max(400) },
  async ({ idea }) => ok(await launchCall('draft', { prompt: idea })),
);

server.tool(
  'monpad_make_art',
  'Generate the token picture from a draft imagePrompt. Returns a data URL; upload it with the site /api/upload to get a public URL.',
  { imagePrompt: z.string().min(5).max(300) },
  async ({ imagePrompt }) => ok(await launchCall('art', { imagePrompt })),
);

server.tool(
  'monpad_start_character',
  'Start building a 3D living character for a token from its public https image URL. Takes a few minutes; poll monpad_character_status.',
  { imageUrl: z.string().url() },
  async ({ imageUrl }) => ok(await launchCall('character', { imageUrl })),
);

server.tool(
  'monpad_character_status',
  'Check a 3D character build. stage: model | rig | ready | failed. When ready, returns the glb URL.',
  { id: z.string().uuid() },
  async ({ id }) => ok(await (await fetch(`${SITE}/api/v1/launch/character/${id}`)).json()),
);

server.tool(
  'monpad_prepare_launch',
  'Build a link that opens Monpad /create pre-filled from a draft, so the human signs the launch in their wallet. Never signs for the user.',
  {
    name: z.string().min(1).max(32),
    symbol: z.string().min(2).max(10),
    description: z.string().max(240).optional(),
    imageUrl: z.string().url().optional(),
    characterId: z.string().uuid().optional(),
  },
  async ({ name, symbol, description, imageUrl, characterId }) => {
    const q = new URLSearchParams({ name, symbol });
    if (description) q.set('desc', description);
    if (imageUrl) q.set('img', imageUrl);
    if (characterId) q.set('cid', characterId);
    return ok({ url: `${SITE}/create?${q.toString()}`, next: 'Open this link, connect a wallet, and sign the launch transaction.' });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
