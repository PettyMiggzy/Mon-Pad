import { formatEther, parseEther } from 'viem';
import { getMonpad } from './monpad-client.mjs';
import { assertMonFlowAllowed, recordMonFlow, safetyLimitsForSpec } from './safety.mjs';

function json(data) {
  return JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function ok(data) {
  return { content: [{ type: 'text', text: json(data) }] };
}

export async function getSpec() {
  const mp = await getMonpad({ dryRun: true });
  const spec = await mp.getSpec();
  return ok({
    ...spec,
    contractsReady: Boolean(spec.contracts?.launcher && spec.contracts?.hook),
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
    creatorTaxBps: t.creatorTaxBps,
    totalSwapFeeBps: t.totalSwapFeeBps,
    poolId: t.poolId,
    poolKey: t.poolKey,
    price: {
      sqrtPriceX96: t.sqrtPriceX96.toString(),
      tick: t.tick,
      approxMonPerToken: t.approxMonPerToken != null ? String(t.approxMonPerToken) : null,
    },
    liquidity: t.liquidity.toString(),
    volumeMonApprox: t.volumeMonApprox.toString(),
    volumeMonFormatted: formatEther(t.volumeMonApprox),
  });
}

export async function trending({ limit = 10, windowBlocks } = {}) {
  const mp = await getMonpad({ dryRun: true });
  const { count, trending: list } = await mp.trending({ limit, windowBlocks });
  return ok({
    count,
    trending: list.map((x) => ({
      ...x,
      volumeMon: x.volumeMon.toString(),
      volumeMonFormatted: formatEther(x.volumeMon),
    })),
  });
}

export async function launchToken(args) {
  const dryRun = args.dryRun !== false;
  const dev = args.devBuyMon ? parseEther(args.devBuyMon) : 0n;
  const mpPreview = await getMonpad({ dryRun: true });
  const preview = await mpPreview.launch({
    name: args.name,
    symbol: args.symbol,
    metadataUri: args.metadataUri,
    creatorTaxBps: args.creatorTaxBps ?? 0,
    devBuyMon: dev,
    salt: args.salt,
    simulate: true,
  });
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      creationFeeMon: formatEther(preview.creationFee ?? 0n),
      devBuyMon: args.devBuyMon || '0',
      gas: preview.gas?.toString(),
      salt: args.salt,
    });
  }
  assertMonFlowAllowed((preview.creationFee ?? 0n) + dev);
  const mp = await getMonpad({ dryRun: false });
  const result = await mp.launch({
    name: args.name,
    symbol: args.symbol,
    creatorTaxBps: args.creatorTaxBps ?? 0,
    devBuyMon: dev,
    salt: args.salt,
    simulate: false,
  });
  recordMonFlow((preview.creationFee ?? 0n) + dev);
  return ok({
    dryRun: false,
    hash: result.hash,
    gas: result.gas?.toString(),
    devBuyMon: args.devBuyMon || '0',
  });
}

export async function buy(args) {
  const dryRun = args.dryRun !== false;
  const monIn = parseEther(args.monIn);
  const minTokensOut = BigInt(args.minTokensOut);
  const mp = await getMonpad({ dryRun: true });
  const result = await mp.buy(args.token, monIn, { slippageBps: 100, simulate: true, minTokensOut });
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      tokensOut: result.tokensOut?.toString?.() ?? String(result.tokensOut),
      token: args.token,
      monIn: args.monIn,
      minTokensOut: args.minTokensOut,
    });
  }
  assertMonFlowAllowed(monIn);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.buy(args.token, monIn, { slippageBps: 100, simulate: false, minTokensOut });
  recordMonFlow(monIn);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, monIn: args.monIn, minTokensOut: args.minTokensOut });
}

export async function sell(args) {
  const dryRun = args.dryRun !== false;
  const tokensIn = BigInt(args.tokensIn);
  const minMonOut = BigInt(args.minMonOut);
  const mp = await getMonpad({ dryRun: true });
  await mp.sell(args.token, tokensIn, { slippageBps: 100, simulate: true, minMonOut });
  const quote = await mp.quoteSell(args.token, tokensIn);
  if (dryRun) {
    return ok({
      dryRun: true,
      simulated: true,
      nativeOut: quote.monOut.toString(),
      token: args.token,
      tokensIn: args.tokensIn,
      minMonOut: args.minMonOut,
    });
  }
  assertMonFlowAllowed(quote.monOut);
  const mpSend = await getMonpad({ dryRun: false });
  const sent = await mpSend.sell(args.token, tokensIn, { simulate: false, minMonOut });
  recordMonFlow(quote.monOut);
  return ok({ dryRun: false, hash: sent.hash, token: args.token, tokensIn: args.tokensIn, minMonOut: args.minMonOut });
}
