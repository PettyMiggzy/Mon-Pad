// Runs the SDK against a local fork of Monad mainnet:
//   (cd ../hardhat-test && FORK_RPC=https://rpc.monad.xyz npx hardhat node) &   # then mine one block: evm_mine
//   FORK_URL=http://127.0.0.1:8545 npm test
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, encodeAbiParameters, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createMonpad, MAINNET, parseUnits, SlippageExceeded } from '../dist/index.js';

const url = process.env.FORK_URL;
if (!url) { console.log('skipped: set FORK_URL to a running mainnet fork'); process.exit(0); }

const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [url] } } };
const publicClient = createPublicClient({ chain, transport: http(url) });
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // hardhat account #1
const walletClient = createWalletClient({ account, chain, transport: http(url) });
const monpad = createMonpad({ publicClient, walletClient });
const reader = createMonpad({ publicClient }); // no wallet: read + quote only
const rpc = (method, params) => publicClient.request({ method, params });
let n = 0; const ok = (m) => console.log(`PASS ${++n}. ${m}`);

const spec = await monpad.getSpec();
assert.equal(spec.chainId, 143); assert.equal(spec.creationFeeUsdc, '0'); ok(`spec (creation fee ${spec.creationFeeUsdc}, paused ${spec.launchPaused})`);

const { count, launches } = await reader.listLaunches({ limit: 3 });
assert.ok(count >= 1 && launches.length >= 1); const t0 = launches[0]; ok(`listLaunches: ${count} coin(s), newest ${t0.symbol} at $${t0.priceUsd.toExponential(3)}`);
const tok = await reader.getToken(t0.token); assert.equal(tok.totalFeeBps, 100 + tok.creatorTaxBps); ok('getToken');
await assert.rejects(() => reader.getToken(MAINNET.usdc), /not launched on Monpad/); ok('getToken rejects a non-Monpad address');

const q = await reader.quoteBuy({ token: tok.token, monIn: parseEther('100') }); assert.ok(q.tokensOut > 0n); ok(`quoteBuy without a wallet: 100 MON -> ${formatEther(q.tokensOut)} tokens`);

// buy with MON (dry run, then real)
const sim = await monpad.buy({ token: tok.token, monIn: parseEther('100'), simulate: true }); assert.ok(sim.simulated && !sim.hash); ok('buy simulate');
const bal = async (t) => publicClient.readContract({ address: t, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [account.address] });
const before = await bal(tok.token);
const b = await monpad.buy({ token: tok.token, monIn: parseEther('100'), slippageBps: 100 }); assert.ok(b.hash);
const gained = (await bal(tok.token)) - before; assert.ok(gained >= b.minOut && gained > 0n); ok(`buy with MON: got ${formatEther(gained)} (min ${formatEther(b.minOut)})`);

// slippage guard: an absurd minimum must fail with a typed error
await assert.rejects(() => monpad.buy({ token: tok.token, monIn: parseEther('1'), minTokensOut: 10n ** 30n }), (e) => e instanceof SlippageExceeded || /Slippage|slippage|too little|revert/i.test(String(e.message))); ok('buy refuses when minTokensOut cannot be met');

// sell half back for MON
const half = gained / 2n; const monBefore = await publicClient.getBalance({ address: account.address });
const s = await monpad.sell({ token: tok.token, tokensIn: half, slippageBps: 100 }); assert.ok(s.hash);
assert.ok((await publicClient.getBalance({ address: account.address })) + parseEther('1') > monBefore); ok(`sell to MON: quoted ${formatEther(s.amountOut)} MON`);

// USDC path: give the account USDC with a storage write (Circle FiatToken balances = slot 9)
const usdcSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account.address, 9n]));
await rpc('hardhat_setStorageAt', [MAINNET.usdc, usdcSlot, toHex(parseUnits('500', 6), { size: 32 })]);
const u = await monpad.buy({ token: tok.token, usdcIn: parseUnits('50', 6) }); assert.ok(u.hash); ok('buy with USDC (approval handled)');
const us = await monpad.sell({ token: tok.token, tokensIn: u.amountOut / 2n, receive: 'usdc' }); assert.ok(us.hash); ok('sell to USDC');

// launch with a MON dev buy
const L = await monpad.launch({ name: 'SDK Test', symbol: 'SDKT', creatorTaxBps: 200, devBuyMon: parseEther('50') });
assert.ok(L.hash && L.token); const lt = await monpad.getToken(L.token);
assert.equal(lt.symbol, 'SDKT'); assert.equal(lt.creatorTaxBps, 200); assert.equal(lt.creator.toLowerCase(), account.address.toLowerCase()); ok(`launch with MON dev buy -> ${L.token}`);
await assert.rejects(() => monpad.launch({ name: 'x', symbol: 'X', creatorTaxBps: 900 }), /0 to 500/); ok('launch validates the creator tax');
assert.ok((await monpad.launch({ name: 'Dry', symbol: 'DRY', simulate: true })).simulated); ok('launch simulate');

await monpad.harvest(L.token, true); ok('harvest simulate');
const c = await monpad.claimable(account.address, MAINNET.usdc); assert.equal(typeof c, 'bigint'); ok(`claimable ${c}`);
const burn = await reader.getMonshiBurned(); assert.ok(burn.burned > 0n); ok(`MONSHI burned ${formatEther(burn.burned)}`);
await assert.rejects(() => reader.buy({ token: tok.token, monIn: 1n }), /walletClient/); ok('writes need a wallet');
console.log(`\nall ${n} checks passed`);
