// Starts the MCP server over stdio against a local mainnet fork and drives every tool.
//   (cd ../hardhat-test && FORK_RPC=https://rpc.monad.xyz npx hardhat node) & ; evm_mine once; then:
//   FORK_URL=http://127.0.0.1:8545 npm test
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = process.env.FORK_URL;
if (!url) { console.log('skipped: set FORK_URL to a running mainnet fork'); process.exit(0); }
const home = mkdtempSync(join(tmpdir(), 'monpad-mcp-'));
const transport = new StdioClientTransport({
  command: 'node', args: ['server.mjs'],
  env: { ...process.env, HOME: home, RPC_URL: url, MONPAD_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', MAX_MON_PER_TX: '5', MAX_MON_PER_DAY: '8' },
});
const client = new Client({ name: 'test', version: '1' });
await client.connect(transport);
let n = 0; const ok = (m) => console.log(`PASS ${++n}. ${m}`);
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const text = r.content[0].text; let data; try { data = JSON.parse(text); } catch { data = text; } return { error: !!r.isError, data }; };

const tools = (await client.listTools()).tools.map((t) => t.name);
assert.deepEqual(tools.sort(), ['monpad_buy', 'monpad_claim_fees', 'monpad_get_monshi_burn', 'monpad_get_spec', 'monpad_get_token', 'monpad_launch_token', 'monpad_list_launches', 'monpad_sell', 'monpad_trending', 'monpad_wallet']); ok(`${tools.length} tools`);

const spec = await call('monpad_get_spec'); assert.equal(spec.data.chainId, 143); assert.equal(spec.data.safety.maxMonPerTx, '5'); ok('spec shows safety limits');
const list = await call('monpad_list_launches', { limit: 2 }); assert.ok(list.data.launches.length >= 1); const token = list.data.launches[0].token; ok(`list_launches: ${list.data.count} coin(s)`);
const tk = await call('monpad_get_token', { token }); assert.equal(tk.data.token.toLowerCase(), token.toLowerCase()); ok('get_token');
assert.ok((await call('monpad_trending', { limit: 3 })).data.trending.length >= 1); ok('trending');
assert.ok(Number((await call('monpad_get_monshi_burn')).data.burned) > 0); ok('monshi burn');
assert.equal((await call('monpad_get_token', { token: '0x0000000000000000000000000000000000000001' })).error, true); ok('unknown coin is a clean error');

const dry = await call('monpad_buy', { token, monIn: '2' }); assert.equal(dry.data.dryRun, true); assert.ok(Number(dry.data.expectedTokens) > 0); ok(`buy defaults to a dry run: ${dry.data.expectedTokens} tokens`);
const big = await call('monpad_buy', { token, monIn: '6', dryRun: false }); assert.equal(big.error, true); assert.match(big.data, /MAX_MON_PER_TX/); ok('per-transaction cap refuses 6 MON');
const real = await call('monpad_buy', { token, monIn: '4', dryRun: false }); assert.equal(real.error, false); assert.ok(real.data.hash); ok(`real buy: ${real.data.expectedTokens} tokens`);
const over = await call('monpad_buy', { token, monIn: '5', dryRun: false }); assert.equal(over.error, true); assert.match(over.data, /MAX_MON_PER_DAY/); ok('daily cap refuses the next buy');
const w = await call('monpad_wallet', { token }); assert.ok(Number(w.data.tokenBalance) > 0); ok(`wallet: ${Number(w.data.mon).toFixed(0)} MON, ${Number(w.data.tokenBalance).toFixed(0)} tokens`);
const sd = await call('monpad_sell', { token, percent: 50 }); assert.equal(sd.data.dryRun, true); ok(`sell dry run: ${sd.data.expectedMon} MON`);
const sbig = await call('monpad_sell', { token, percent: 50, dryRun: false }); assert.equal(sbig.error, true); assert.match(sbig.data, /MAX_MON_PER_TX/); ok('sell proceeds count toward the cap (50% refused)');
const sr = await call('monpad_sell', { token, percent: 5, dryRun: false }); assert.equal(sr.error, false); assert.ok(sr.data.hash); ok('real sell of 5%');
const ld = await call('monpad_launch_token', { name: 'MCP Dry', symbol: 'MDRY', creatorTaxPct: 1 }); assert.equal(ld.data.dryRun, true); ok('launch dry run');
const lr = await call('monpad_launch_token', { name: 'MCP Real', symbol: 'MREAL', creatorTaxPct: 1.5, devBuyMon: '1', dryRun: false }); assert.equal(lr.error, false); assert.ok(lr.data.token); ok(`real launch -> ${lr.data.token}`);
const lt = await call('monpad_get_token', { token: lr.data.token }); assert.equal(lt.data.creatorTaxPct, 1.5); ok('launched coin has the 1.5% tax');
const cl = await call('monpad_claim_fees'); assert.equal(cl.data.dryRun, true); ok('claim_fees dry run');
console.log(`\nall ${n} checks passed`);
await client.close();
