import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { getMonpad } from './monpad-client.mjs';
import { assertFlowAllowed, recordFlow, safetyLimitsForSpec } from './safety.mjs';

const usdc = (v) => formatUnits(v, 6);

function json(data) {
  return JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function ok(data) {
  return { content: [{ type: 'text', text: json(data) }] };
}

export async function getSpec() {
  const mp = await getMonpad({ dryRun: true });
  const spec = await mp.getSpec();
  const contractsReady = Boolean(spec.contracts?.launcher && spec.contracts?.hook);
  // USDC can be paused or can blacklist the launcher/router/PoolManager; either freezes every trade and launch.
  const quoteHealth = contractsReady ? await mp.quoteHealth().catch(() => null) : null;
  return ok({
    ...spec,
    contractsReady,
    quoteHealth,
    safety: safetyLimitsForSpec(),
  });
}

export async function getMonshiBurn() {
  const mp = await getMonpad({ dryRun: true });
  try {
    const b = await mp.getMonshiBurned();
    return ok({
      burned: b.burned.toString(),
      burnedFormatted: formatEther(b.burned),
      circulatingFormatted: formatEther(b.circulating),
      totalSupply: b.totalSupply.toString(),
    });
  } catch (e) {
    throw new Error(e?.message || 'contracts not deployed yet — configure monshi/dead via spec');
  }
}

export async function listLaunches({ limit = 10 } = {}) {
  const mp = await getMonpad({ dryRun: true });
  const { count, launches, nextCursor } = await mp.listLaunches({ limit });
  return ok({ count, launches, nextCursor });
}

export async function getToken({ token }) {
  const mp = await getMonpad({ dryRun: true });
  const t = await mp.getToken(token);
  return ok({
    token: t.token,
    quoteAsset: t.quoteAsset,
    creatorTaxBps: t.creatorTaxBps,
    totalSwapFeeBps: t.totalSwapFeeBps,
    poolId: t.poolId,
    poolKey: t.poolKey,
    price: {
      sqrtPriceX96: t.sqrtPriceX96.toString(),
      tick: t.tick,
      approxUsdcPerToken: t.approxUsdcPerToken != null ? String(t.approxUsdcPerToken) : null,
    },
    liquidity: t.liquidity.toString(),
    volumeUsdcApprox: t.volumeUsdcApprox.toString(),
    volumeUsdcFormatted: usdc(t.volumeUsdcApprox),
    buybackReserveUsdc: usdc(t.buybackReserveUsdc),
  });
}

export async function trending({ limit = 10, windowBlocks } = {}) {
  const mp = await getMonpad({ dryRun: true });
  const { count, trending: list } = await mp.trending({ limit, windowBlocks });
  return ok({
    count,
    trending: list.map((x) => ({
      ...x,
      volumeUsdc: x.volumeUsdc.toString(),
      volumeUsdcFormatted: usdc(x.volumeUsdc),
    })),
  });
}

/** Launch: the creation fee and the optional dev buy are both paid in USDC. */
export async function launchToken(args) {
  const dryRun = args.dryRun !== false;
  const dev = args.devBuyUsdc ? parseUnits(args.devBuyUsdc, 6) : 0n;
  const mpPreview = await getMonpad({ dryRun: true });
  const preview = await mpPreview.launch({
    name: args.name,
    symbol: args.symbol,
    metadataUri: args.metadataUri,
    creatorTaxBps: args.creatorTaxBps ?? 0,
    devBuyUsdc: dev,
    salt: args.salt,
    simulate: true,
  });
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      creationFeeUsdc: usdc(preview.creationFee ?? 0n),
      devBuyUsdc: args.devBuyUsdc || '0',
      totalUsdc: usdc(preview.totalUsdc ?? 0n),
      gas: preview.gas?.toString(),
      salt: args.salt,
    });
  }
  const total = (preview.creationFee ?? 0n) + dev;
  assertFlowAllowed('usdc', total);
  const mp = await getMonpad({ dryRun: false });
  const result = await mp.launch({
    name: args.name,
    symbol: args.symbol,
    creatorTaxBps: args.creatorTaxBps ?? 0,
    devBuyUsdc: dev,
    salt: args.salt,
    simulate: false,
  });
  recordFlow('usdc', total);
  return ok({
    dryRun: false,
    hash: result.hash,
    gas: result.gas?.toString(),
    devBuyUsdc: args.devBuyUsdc || '0',
    totalUsdc: usdc(total),
  });
}

/** Buy with USDC (the quote asset). */
export async function buy(args) {
  const dryRun = args.dryRun !== false;
  const usdcIn = parseUnits(args.usdcIn, 6);
  const minTokensOut = BigInt(args.minTokensOut);
  const mp = await getMonpad({ dryRun: true });
  const result = await mp.buy(args.token, usdcIn, { slippageBps: 100, simulate: true, minTokensOut, maxUsdcPerTx: usdcIn });
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      tokensOut: result.tokensOut?.toString?.() ?? String(result.tokensOut),
      token: args.token,
      usdcIn: args.usdcIn,
      minTokensOut: args.minTokensOut,
    });
  }
  assertFlowAllowed('usdc', usdcIn);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.buy(args.token, usdcIn, { slippageBps: 100, simulate: false, minTokensOut, maxUsdcPerTx: usdcIn });
  recordFlow('usdc', usdcIn);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, usdcIn: args.usdcIn, minTokensOut: args.minTokensOut });
}

/** Buy with native MON: MON → USDC on the hookless MON/USDC pool, then USDC → token. */
export async function buyWithMon(args) {
  const dryRun = args.dryRun !== false;
  const monIn = parseEther(args.monIn);
  const minTokensOut = BigInt(args.minTokensOut);
  const minUsdcOut = args.minUsdcOut ? BigInt(args.minUsdcOut) : undefined;
  const mp = await getMonpad({ dryRun: true });
  const result = await mp.buyWithMon(args.token, monIn, { slippageBps: 100, simulate: true, minTokensOut, minUsdcOut, maxMonPerTx: monIn });
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      tokensOut: result.tokensOut?.toString?.() ?? String(result.tokensOut),
      token: args.token,
      monIn: args.monIn,
      minTokensOut: args.minTokensOut,
      minUsdcOut: result.minUsdcOut?.toString(),
    });
  }
  assertFlowAllowed('mon', monIn);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.buyWithMon(args.token, monIn, { slippageBps: 100, simulate: false, minTokensOut, minUsdcOut, maxMonPerTx: monIn });
  recordFlow('mon', monIn);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, monIn: args.monIn, minTokensOut: args.minTokensOut });
}

/** Sell for USDC. */
export async function sell(args) {
  const dryRun = args.dryRun !== false;
  const tokensIn = BigInt(args.tokensIn);
  const minUsdcOut = BigInt(args.minUsdcOut);
  const mp = await getMonpad({ dryRun: true });
  await mp.sell(args.token, tokensIn, { slippageBps: 100, simulate: true, minUsdcOut });
  const quote = await mp.quoteSell(args.token, tokensIn);
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      usdcOut: quote.usdcOut.toString(),
      usdcOutFormatted: usdc(quote.usdcOut),
      token: args.token,
      tokensIn: args.tokensIn,
      minUsdcOut: args.minUsdcOut,
    });
  }
  assertFlowAllowed('usdc', quote.usdcOut);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.sell(args.token, tokensIn, { simulate: false, minUsdcOut });
  recordFlow('usdc', quote.usdcOut);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, tokensIn: args.tokensIn, minUsdcOut: args.minUsdcOut });
}

/** Sell for native MON: token → USDC → MON. */
export async function sellForMon(args) {
  const dryRun = args.dryRun !== false;
  const tokensIn = BigInt(args.tokensIn);
  const minMonOut = BigInt(args.minMonOut);
  const minUsdcOut = args.minUsdcOut ? BigInt(args.minUsdcOut) : undefined;
  const mp = await getMonpad({ dryRun: true });
  await mp.sellForMon(args.token, tokensIn, { slippageBps: 100, simulate: true, minMonOut, minUsdcOut });
  const quote = await mp.quoteSellForMon(args.token, tokensIn);
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      monOut: quote.monOut.toString(),
      token: args.token,
      tokensIn: args.tokensIn,
      minMonOut: args.minMonOut,
    });
  }
  assertFlowAllowed('mon', quote.monOut);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.sellForMon(args.token, tokensIn, { simulate: false, minMonOut, minUsdcOut });
  recordFlow('mon', quote.monOut);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, tokensIn: args.tokensIn, minMonOut: args.minMonOut });
}
