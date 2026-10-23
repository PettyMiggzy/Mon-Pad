import { randomBytes } from 'node:crypto';
import { formatEther, parseEther, encodeFunctionData, parseAbiItem } from 'viem';
import { launcherAbi, hookAbi, stateViewAbi, v4TraderAbi, erc20Abi } from './abis.mjs';
import { loadConfig, requireLauncher, requireV4Trader } from './config.mjs';
import { getPublicClient, getWalletClient } from './clients.mjs';
import { DEAD, poolKeyForToken, monPerToken } from './pool.mjs';

const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
);
import { assertMonSpendAllowed, recordMonSpend, safetyLimitsForSpec } from './safety.mjs';

const BASE_FEE_BPS = 100;
const VOLUME_BLOCKS = Number(process.env.MONPAD_VOLUME_BLOCKS || '5000');

function json(data) {
  return JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

export function ok(data) {
  return { content: [{ type: 'text', text: json(data) }] };
}

export async function getSpec() {
  const config = loadConfig();
  let platform = config.contracts.platform || null;
  let launcherAddr = config.contracts.launcher || null;
  let hookAddr = config.contracts.hook || null;
  const client = getPublicClient(config);
  if (launcherAddr) {
    try {
      platform = platform || (await client.readContract({ address: launcherAddr, abi: launcherAbi, functionName: 'platform' }));
      hookAddr = hookAddr || (await client.readContract({ address: launcherAddr, abi: launcherAbi, functionName: 'hook' }));
    } catch {
      /* not deployed at address */
    }
  }
  return ok({
    chainId: config.chainId,
    name: 'Monpad (Uniswap V4 + hook)',
    model: 'No bonding curve — tokens launch directly into a V4 native-MON pool with MonpadHook swap fees.',
    contracts: {
      launcher: launcherAddr || null,
      hook: hookAddr || null,
      poolManager: config.contracts.poolManager,
      stateView: config.contracts.stateView,
      monshi: config.contracts.monshi,
      v4Trader: config.contracts.v4Trader || null,
      platform,
    },
    contractsReady: Boolean(launcherAddr && hookAddr),
    feePolicy: {
      baseSwapFeeBps: BASE_FEE_BPS,
      maxCreatorTaxBps: 500,
      totalFeeMaxBps: BASE_FEE_BPS + 500,
      baseSplit: { creator: 7000, platform: 1000, burnMonshi: 1000, burnToken: 1000 },
      creatorTaxDestination: '100% buys and burns the launched token (never paid to creator)',
    },
    safety: safetyLimitsForSpec(),
    rpcUrl: config.rpcUrl.replace(/\/\/[^@]+@/, '//***@'),
  });
}

export async function getMonshiBurn() {
  const config = loadConfig();
  const monshi = config.contracts.monshi;
  if (!monshi) throw new Error('contracts not deployed yet — set MONSHI in config');
  const client = getPublicClient(config);
  const [burned, totalSupply] = await Promise.all([
    client.readContract({ address: monshi, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] }),
    client.readContract({ address: monshi, abi: erc20Abi, functionName: 'totalSupply' }),
  ]);
  return ok({
    monshi,
    burned: burned.toString(),
    burnedFormatted: formatEther(burned),
    circulatingFormatted: formatEther(totalSupply > burned ? totalSupply - burned : 0n),
    totalSupply: totalSupply.toString(),
  });
}

export async function listLaunches({ limit = 10 } = {}) {
  const config = loadConfig();
  const { launcher } = requireLauncher(config);
  const client = getPublicClient(config);
  const n = Number(await client.readContract({ address: launcher, abi: launcherAbi, functionName: 'tokenCount' }));
  const take = Math.min(limit, n);
  const launches = [];
  for (let i = n - 1; i >= n - take && i >= 0; i--) {
    const token = await client.readContract({ address: launcher, abi: launcherAbi, functionName: 'allTokens', args: [BigInt(i)] });
    const [creator, taxBps, , poolId] = await client.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: 'launches',
      args: [token],
    });
    let name = '?';
    let symbol = '?';
    try {
      name = await client.readContract({ address: token, abi: erc20Abi, functionName: 'name' });
      symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
    } catch {
      /* */
    }
    launches.push({ index: i, token, creator, creatorTaxBps: taxBps, poolId, name, symbol });
  }
  return ok({ count: n, launches });
}

async function swapVolumeMon(client, poolId, poolManager, fromBlock, toBlock) {
  let total = 0n;
  try {
    const logs = await client.getLogs({
      address: poolManager,
      event: swapEvent,
      args: { id: poolId },
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      const a0 = log.args.amount0 ?? 0n;
      total += a0 < 0n ? -a0 : a0;
    }
  } catch {
    /* RPC may cap log range */
  }
  return total;
}

export async function getToken({ token }) {
  const config = loadConfig();
  const { launcher, hook } = requireLauncher(config);
  const client = getPublicClient(config);
  const [creator, taxBps, , poolId] = await client.readContract({
    address: launcher,
    abi: launcherAbi,
    functionName: 'launches',
    args: [token],
  });
  if (creator === '0x0000000000000000000000000000000000000000') {
    throw new Error('unknown token — not launched via this Monpad launcher');
  }
  const key = poolKeyForToken(token, hook);
  const stateView = config.contracts.stateView;
  const [slot0, liquidity] = await Promise.all([
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
    client.readContract({ address: stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
  ]);
  const sqrtPriceX96 = slot0[0];
  const tick = slot0[1];
  let feeUnits = 0;
  try {
    feeUnits = await client.readContract({ address: hook, abi: hookAbi, functionName: 'feeUnits', args: [poolId] });
  } catch {
    /* */
  }
  const block = await client.getBlockNumber();
  const fromBlock = block > BigInt(VOLUME_BLOCKS) ? block - BigInt(VOLUME_BLOCKS) : 0n;
  const volumeMon = await swapVolumeMon(client, poolId, config.contracts.poolManager, fromBlock, block);
  const mpt = monPerToken(sqrtPriceX96);
  let name = '?';
  let symbol = '?';
  try {
    name = await client.readContract({ address: token, abi: erc20Abi, functionName: 'name' });
    symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
  } catch {
    /* */
  }
  return ok({
    token,
    name,
    symbol,
    creator,
    creatorTaxBps: taxBps,
    totalSwapFeeBps: BASE_FEE_BPS + Number(taxBps),
    poolId,
    poolKey: key,
    price: {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      approxMonPerToken: mpt != null ? String(mpt) : null,
      feeUnits: feeUnits.toString(),
    },
    liquidity: liquidity.toString(),
    volumeMonApprox: volumeMon.toString(),
    volumeMonFormatted: formatEther(volumeMon),
    volumeWindowBlocks: VOLUME_BLOCKS,
  });
}

export async function trending({ limit = 10, windowBlocks = VOLUME_BLOCKS } = {}) {
  const config = loadConfig();
  const { launcher, hook } = requireLauncher(config);
  const client = getPublicClient(config);
  const n = Number(await client.readContract({ address: launcher, abi: launcherAbi, functionName: 'tokenCount' }));
  const block = await client.getBlockNumber();
  const fromBlock = block > BigInt(windowBlocks) ? block - BigInt(windowBlocks) : 0n;
  const scored = [];
  const scan = Math.min(n, 50);
  for (let i = n - 1; i >= n - scan && i >= 0; i--) {
    const token = await client.readContract({ address: launcher, abi: launcherAbi, functionName: 'allTokens', args: [BigInt(i)] });
    const [, taxBps, , poolId] = await client.readContract({
      address: launcher,
      abi: launcherAbi,
      functionName: 'launches',
      args: [token],
    });
    const volumeMon = await swapVolumeMon(client, poolId, config.contracts.poolManager, fromBlock, block);
    let symbol = '?';
    try {
      symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
    } catch {
      /* */
    }
    scored.push({ token, symbol, creatorTaxBps: taxBps, poolId, volumeMon: volumeMon.toString(), volumeMonFormatted: formatEther(volumeMon) });
  }
  scored.sort((a, b) => (BigInt(b.volumeMon) > BigInt(a.volumeMon) ? 1 : -1));
  return ok({ windowBlocks, count: n, trending: scored.slice(0, limit) });
}

export async function launchToken(args) {
  const dryRun = args.dryRun !== false;
  const config = loadConfig();
  const { launcher } = requireLauncher(config);
  const client = getPublicClient(config);
  const creationFee = await client.readContract({ address: launcher, abi: launcherAbi, functionName: 'creationFee' });
  const dev = args.devBuyMon ? parseEther(args.devBuyMon) : 0n;
  const value = creationFee + dev;
  if (!dryRun) assertMonSpendAllowed(value);

  const salt =
    args.salt && args.salt.startsWith('0x')
      ? args.salt
      : `0x${randomBytes(32).toString('hex')}`;
  const creatorTaxBps = args.creatorTaxBps ?? 0;

  const w = getWalletClient(config);
  const txArgs = {
    address: launcher,
    abi: launcherAbi,
    functionName: 'launch',
    args: [args.name, args.symbol, salt, creatorTaxBps],
    value,
    account: w.account,
  };

  if (dryRun) {
    const { result, request } = await client.simulateContract({ ...txArgs, account: w.account });
    return ok({
      dryRun: true,
      simulated: true,
      result,
      request: { to: request.address, value: value.toString(), data: request.data },
      creationFeeMon: formatEther(creationFee),
      devBuyMon: args.devBuyMon || '0',
      creatorTaxBps,
      salt,
    });
  }

  const hash = await w.writeContract(txArgs);
  recordMonSpend(value);
  return ok({
    dryRun: false,
    hash,
    creator: w.account.address,
    creationFeeMon: formatEther(creationFee),
    devBuyMon: args.devBuyMon || '0',
    creatorTaxBps,
    salt,
    note: 'Poll monpad_list_launches or wait for Launched event for token address.',
  });
}

async function poolKeyForLaunchToken(token, config) {
  const { hook } = requireLauncher(config);
  return poolKeyForToken(token, hook);
}

export async function buy(args) {
  const dryRun = args.dryRun !== false;
  const config = loadConfig();
  requireLauncher(config);
  const trader = requireV4Trader(config);
  const monIn = parseEther(args.monIn);
  if (!dryRun) assertMonSpendAllowed(monIn);

  const key = await poolKeyForLaunchToken(args.token, config);
  const w = getWalletClient(config);
  const client = getPublicClient(config);

  const buyCall = {
    address: trader,
    abi: v4TraderAbi,
    functionName: 'buy',
    args: [key, monIn],
    account: w.account,
  };

  if (dryRun) {
    const { result, request } = await client.simulateContract({
      ...buyCall,
      stateOverride: [{ address: trader, balance: monIn * 2n }],
    });
    return ok({
      dryRun: true,
      simulated: true,
      tokensOut: result?.toString?.() ?? result,
      request: {
        steps: [
          { action: 'fund_trader', to: trader, value: monIn.toString() },
          { action: 'buy', to: request.address, data: request.data },
        ],
      },
      token: args.token,
      monIn: args.monIn,
    });
  }

  const fundHash = await w.sendTransaction({ to: trader, value: monIn, account: w.account });
  const hash = await w.writeContract(buyCall);
  recordMonSpend(monIn);
  return ok({ dryRun: false, fundHash, hash, token: args.token, monIn: args.monIn });
}

export async function sell(args) {
  const dryRun = args.dryRun !== false;
  const config = loadConfig();
  requireLauncher(config);
  const trader = requireV4Trader(config);
  const tokensIn = BigInt(args.tokensIn);
  const key = await poolKeyForLaunchToken(args.token, config);
  const w = getWalletClient(config);
  const client = getPublicClient(config);

  const allowance = await client.readContract({
    address: args.token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [w.account.address, trader],
  });

  const calls = [];
  if (allowance < tokensIn) {
    calls.push({
      to: args.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [trader, tokensIn],
      }),
    });
  }
  calls.push({
    to: trader,
    data: encodeFunctionData({
      abi: v4TraderAbi,
      functionName: 'sell',
      args: [key, tokensIn],
    }),
  });

  if (dryRun) {
    if (allowance < tokensIn) {
      await client.simulateContract({
        address: args.token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [trader, tokensIn],
        account: w.account,
      });
    }
    const { result, request } = await client.simulateContract({
      address: trader,
      abi: v4TraderAbi,
      functionName: 'sell',
      args: [key, tokensIn],
      account: w.account,
    });
    return ok({
      dryRun: true,
      simulated: true,
      nativeOut: result?.toString?.() ?? result,
      needsApprove: allowance < tokensIn,
      request: { to: request.address, data: request.data },
      token: args.token,
      tokensIn: args.tokensIn,
    });
  }

  let approveHash;
  if (allowance < tokensIn) {
    approveHash = await w.writeContract({
      address: args.token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [trader, tokensIn],
      account: w.account,
    });
  }
  const hash = await w.writeContract({
    address: trader,
    abi: v4TraderAbi,
    functionName: 'sell',
    args: [key, tokensIn],
    account: w.account,
  });
  return ok({ dryRun: false, hash, approveHash: approveHash || null, token: args.token, tokensIn: args.tokensIn });
}
