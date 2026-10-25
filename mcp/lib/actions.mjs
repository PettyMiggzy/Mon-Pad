import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { getMonpad } from './monpad-client.mjs';
import { assertMonFlowAllowed, recordMonFlow, safetyLimitsForSpec } from './safety.mjs';

const ERC20_BAL = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }];
const json = (data) => JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
export const ok = (data) => ({ content: [{ type: 'text', text: json(data) }] });

const SITE = 'https://www.monpad.net';
const view = (t) => ({
  token: t.token, name: t.name, symbol: t.symbol, creator: t.creator,
  priceUsd: t.priceUsd, marketCapUsd: Math.round(t.marketCapUsd),
  creatorTaxPct: t.creatorTaxBps / 100, totalFeePct: t.totalFeeBps / 100, page: `${SITE}/token/${t.token}`,
});

export async function getSpec() {
  const { monpad } = getMonpad();
  const spec = await monpad.getSpec();
  return ok({ ...spec, safety: safetyLimitsForSpec() });
}

export async function getMonshiBurn() {
  const { monpad } = getMonpad();
  const b = await monpad.getMonshiBurned();
  return ok({ burned: formatEther(b.burned), circulating: formatEther(b.circulating), totalSupply: formatEther(b.totalSupply) });
}

export async function listLaunches({ limit = 10 } = {}) {
  const { monpad } = getMonpad();
  const { count, launches } = await monpad.listLaunches({ limit });
  return ok({ count, launches: launches.map(view) });
}

export async function getToken({ token }) {
  const { monpad } = getMonpad();
  return ok(view(await monpad.getToken(token)));
}

export async function trending({ limit = 10 } = {}) {
  const { monpad } = getMonpad();
  const { launches } = await monpad.listLaunches({ limit: 120 });
  return ok({ ranking: 'marketCap', trending: launches.sort((a, b) => b.marketCapUsd - a.marketCapUsd).slice(0, limit).map(view) });
}

export async function wallet({ token } = {}) {
  const { monpad, publicClient, walletClient } = getMonpad({ withWallet: true });
  const address = walletClient.account.address;
  const out = { address, mon: formatEther(await publicClient.getBalance({ address })) };
  if (token) out.tokenBalance = formatEther(await publicClient.readContract({ address: token, abi: ERC20_BAL, functionName: 'balanceOf', args: [address] }));
  out.claimableUsdc = formatUnits(await monpad.claimable(address, monpad.addresses.usdc), 6);
  return ok(out);
}

export async function launchToken(args) {
  const dryRun = args.dryRun !== false;
  const taxBps = Math.round((args.creatorTaxPct ?? 0) * 100);
  const dev = args.devBuyMon ? parseEther(args.devBuyMon) : 0n;
  const plan = { name: args.name, symbol: args.symbol, creatorTaxPct: taxBps / 100, devBuyMon: args.devBuyMon || '0', creationFee: 'free' };
  if (dryRun) {
    const { monpad } = getMonpad();
    const spec = await monpad.getSpec();
    return ok({ dryRun: true, wouldLaunch: plan, launchesPaused: spec.launchPaused, note: 'Set dryRun=false to send. Needs MONPAD_PRIVATE_KEY.' });
  }
  assertMonFlowAllowed(dev);
  const { monpad } = getMonpad({ withWallet: true });
  const r = await monpad.launch({ name: args.name, symbol: args.symbol, creatorTaxBps: taxBps, devBuyMon: dev });
  recordMonFlow(dev);
  return ok({ dryRun: false, hash: r.hash, token: r.token, page: r.token ? `${SITE}/token/${r.token}` : undefined, ...plan });
}

export async function buy(args) {
  const dryRun = args.dryRun !== false;
  const monIn = parseEther(args.monIn);
  const slippageBps = Math.round((args.slippagePct ?? 1) * 100);
  if (dryRun) {
    const { monpad } = getMonpad();
    const { tokensOut } = await monpad.quoteBuy({ token: args.token, monIn });
    return ok({ dryRun: true, token: args.token, monIn: args.monIn, expectedTokens: formatEther(tokensOut), minTokens: formatEther((tokensOut * BigInt(10_000 - slippageBps)) / 10_000n), note: 'Set dryRun=false to send.' });
  }
  assertMonFlowAllowed(monIn);
  const { monpad } = getMonpad({ withWallet: true });
  const r = await monpad.buy({ token: args.token, monIn, slippageBps });
  recordMonFlow(monIn);
  return ok({ dryRun: false, hash: r.hash, token: args.token, monIn: args.monIn, expectedTokens: formatEther(r.amountOut), minTokens: formatEther(r.minOut) });
}

export async function sell(args) {
  const dryRun = args.dryRun !== false;
  const slippageBps = Math.round((args.slippagePct ?? 1) * 100);
  const { monpad, publicClient, walletClient } = getMonpad({ withWallet: !dryRun || !!args.percent });
  let tokensIn;
  if (args.percent) {
    const have = await publicClient.readContract({ address: args.token, abi: ERC20_BAL, functionName: 'balanceOf', args: [walletClient.account.address] });
    tokensIn = (have * BigInt(Math.round(args.percent * 100))) / 10_000n;
  } else if (args.tokens) tokensIn = parseUnits(args.tokens, 18);
  else throw new Error('pass tokens (e.g. "1000") or percent (1-100)');
  if (tokensIn <= 0n) throw new Error('nothing to sell');
  const { amountOut } = await monpad.quoteSell({ token: args.token, tokensIn });
  if (dryRun) return ok({ dryRun: true, token: args.token, tokensIn: formatEther(tokensIn), expectedMon: formatEther(amountOut), note: 'Set dryRun=false to send.' });
  assertMonFlowAllowed(amountOut);
  const r = await monpad.sell({ token: args.token, tokensIn, slippageBps });
  recordMonFlow(amountOut);
  return ok({ dryRun: false, hash: r.hash, token: args.token, tokensIn: formatEther(tokensIn), expectedMon: formatEther(r.amountOut), minMon: formatEther(r.minOut) });
}

export async function claimFees(args) {
  const dryRun = args.dryRun !== false;
  const { monpad, walletClient } = getMonpad({ withWallet: true });
  const asset = args.token ?? monpad.addresses.usdc;
  const amount = await monpad.claimable(walletClient.account.address, asset);
  if (dryRun || amount === 0n) return ok({ dryRun, asset, claimable: asset === monpad.addresses.usdc ? formatUnits(amount, 6) : formatEther(amount), note: amount === 0n ? 'Nothing to claim.' : 'Set dryRun=false to claim.' });
  const r = await monpad.claim(asset);
  return ok({ dryRun: false, hash: r.hash, asset });
}
