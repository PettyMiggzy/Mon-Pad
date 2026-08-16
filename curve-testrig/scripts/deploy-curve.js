/*
 * Bootstrap the MonPad V4 "curve-on-V4" suite on Monad (chain 143).
 * Deploys the free single-sided bonding-curve launch stack + the governed fee/economics config.
 *
 * Order (each depends on the prior):
 *   DeterministicDeployer → FeeWalletRegistry → LockVault → CurveV4Deployer
 *     → MonPadV4FeeConfig (governed defaults) → MonPadFactoryV4 → lockVault.setFactory
 *
 * The FeeConfig defaults are FORWARD-ONLY governance: retune them for FUTURE launches with
 * feeConfig.setDefaults(...) — never a factory redeploy. Live pads keep the fee they were born with.
 *
 * [MONAD] Two deltas from the Robinhood Chain original:
 *   - EIP-1559 IS supported here, so deploys are ordinary type-2 txs. Do NOT force `{ type: 0 }`.
 *   - StateView is NOT deployed. Monad already has the canonical Uniswap one; we point at it.
 *
 * Usage: MONAD_RPC=<rpc> PRIVATE_KEY=<key> PLATFORM_WALLET=<addr> \
 *        npx hardhat run scripts/deploy-curve.js --network monad
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Uniswap v4 on Monad mainnet (chain 143). Each verified to carry code on rpc.monad.xyz.
// Override via env for testnet — the testnet deployments differ; take them from
// https://developers.uniswap.org/contracts/v4/deployments
const POOL_MANAGER = process.env.POOL_MANAGER || "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const POSITION_MANAGER = process.env.POSITION_MANAGER || "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016";
const PERMIT2 = process.env.PERMIT2 || "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// [MONAD] Canonical Uniswap StateView, already deployed here — the Robin suite had to ship its own because
// Robinhood Chain had none paired with its PoolManager. contracts/core/MonPadStateView.sol is retained for the
// local test suite only and is NOT deployed to Monad.
const STATE_VIEW = process.env.STATE_VIEW || "0x77395f3b2e73ae90843717371294fa97cc419d64";

// Governed DEFAULT launch params (stamped IMMUTABLY per-pad at launch; retunable for FUTURE launches only).
//
// Geometry targets a ~$34k graduation FDV — a ~373,000 MON raise at $0.021/MON — over a ~10x chart. Derived from  raise = curveSupply / 1.0001^((startTick+gradTick)/2)  and proven end-to-end in
// test/sim/curve.calibration.sim.test.js. Re-derive with `node scripts/calibrate.js` if the target moves.
// Magnitudes are tick-spacing-aligned for ts=100 (87300/100, 23000/100, 22800/100 are integers) — launches
// must pass tickSpacing=100.
//
// BASIC PAD: this configuration ships with no floor vault, no ambush vault and no staking pool, so every share
// that would route to one is ZERO. Do not raise them without also deploying and wiring the corresponding vault:
// the MON would accrue into a book that only flushFloor()/flushAmbush() can release, and both revert while the
// target is unset.
const DEFAULTS = {
  buyTaxBps: Number(process.env.BUY_TAX_BPS || 100), // 1% buy tax (MON, fee-on-input) → 0.2% buffer / rest platform
  sellTaxBps: Number(process.env.SELL_TAX_BPS || 100), // 1% sell trade tax → 100% creator (no floor in the basic pad)
  sellFloorShareBps: Number(process.env.SELL_FLOOR_SHARE_BPS || 0), // NO floor vault ⇒ 0; full sell tax → creator
  buyLpFloorShareBps: Number(process.env.BUY_LP_FLOOR_SHARE_BPS || 0), // NO floor vault ⇒ 0
  buyBufferShareBps: Number(process.env.BUY_BUFFER_SHARE_BPS || 2000), // 20% of the buy tax → curve buffer → platform @ grad
  referralShareBps: Number(process.env.REFERRAL_SHARE_BPS || 2500), // 25% of the platform buy cut → referrer
  platformGradBps: Number(process.env.PLATFORM_GRAD_BPS || 2000), // 20% of the raise → platform at graduation
  creatorGradBps: Number(process.env.CREATOR_GRAD_BPS || 1500), // 15% of the raise → creator at graduation
  ambushGradBps: Number(process.env.AMBUSH_GRAD_BPS || 0), // NO ambush vault ⇒ 0 (LP takes the 65% remainder)
  lpFee: Number(process.env.LP_FEE || 10000), // 1% static pool LP fee
  startTickMag: Number(process.env.START_TICK_MAG || 87300), // curve top — calibrated for MON, not ETH
  curveWidth: Number(process.env.CURVE_WIDTH || 23000), // start → graduation ceiling span (~10x chart)
  minGradWidth: Number(process.env.MIN_GRAD_WIDTH || 22800), // informational min-grad marker (< curveWidth)
};

async function deploy(name, args = []) {
  const f = await ethers.getContractFactory(name);
  const c = await f.deploy(...args); // [MONAD] type-2 is fine here; Monad supports EIP-1559
  await c.waitForDeployment();
  console.log(`  ${name.padEnd(24)} ${await c.getAddress()}`);
  return c;
}

// This is a RESEARCH RIG. Deploying it to Monad mainnet would put experiment-grade contracts in front of real
// money, so refuse chain 143 outright unless someone opts in deliberately and in writing.
async function assertNotMainnet() {
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) === 143 && process.env.ALLOW_MAINNET_DEPLOY !== "1") {
    throw new Error(
      "Refusing to deploy curve-testrig to Monad mainnet (chain 143). This is a research rig, not a " +
        "production launchpad. Point it at a testnet or a fork, or set ALLOW_MAINNET_DEPLOY=1 if you " +
        "genuinely mean to do this.",
    );
  }
}

async function main() {
  await assertNotMainnet();
  const [deployer] = await ethers.getSigners();
  // Require PLATFORM_WALLET explicitly. Defaulting it to the hot deploy key silently makes that key the platform
  // fee wallet AND the root admin — undoing which costs FeeWalletRegistry.TIMELOCK (2 days). Fail loudly instead.
  const platform = process.env.PLATFORM_WALLET;
  if (!platform) throw new Error("PLATFORM_WALLET must be set (the platform fee wallet + root admin — never the hot deploy key)");
  console.log(`Deploying MonPad V4 curve suite as ${deployer.address} (platform wallet ${platform})`);
  console.log(`  poolManager ${POOL_MANAGER}\n  stateView   ${STATE_VIEW} (canonical Uniswap, not deployed by us)\n`);

  const dep = await deploy("DeterministicDeployer");
  const reg = await deploy("FeeWalletRegistry", [platform, deployer.address]);
  const lockVault = await deploy("LockVault", [POSITION_MANAGER, await reg.getAddress()]);
  const curveDeployer = await deploy("CurveV4Deployer", [await dep.getAddress()]);
  const stakingDeployer = await deploy("StakingDeployer", [await dep.getAddress()]);
  const feeConfig = await deploy("MonPadV4FeeConfig", [deployer.address, DEFAULTS]);
  const factory = await deploy("MonPadFactoryV4", [
    POOL_MANAGER,
    POSITION_MANAGER,
    PERMIT2,
    STATE_VIEW,
    await dep.getAddress(),
    await curveDeployer.getAddress(),
    await stakingDeployer.getAddress(),
    await feeConfig.getAddress(),
    await reg.getAddress(),
    await lockVault.getAddress(),
  ]);

  const rc = await (await lockVault.setFactory(await factory.getAddress())).wait();
  console.log(`  lockVault.setFactory -> ${await factory.getAddress()}\n`);

  const out = {
    chainId: Number(network.config.chainId || 143),
    deployer: deployer.address,
    platformWallet: platform,
    poolManager: POOL_MANAGER,
    positionManager: POSITION_MANAGER,
    permit2: PERMIT2,
    stateView: STATE_VIEW,
    curveFactoryBlock: rc.blockNumber,
    defaults: DEFAULTS,
    contracts: {
      deterministicDeployer: await dep.getAddress(),
      feeWalletRegistry: await reg.getAddress(),
      lockVault: await lockVault.getAddress(),
      curveDeployer: await curveDeployer.getAddress(),
      feeConfig: await feeConfig.getAddress(),
      curveFactory: await factory.getAddress(),
    },
  };
  const file = path.join(__dirname, "..", "deploy.curve.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Wrote ${file}`);
  console.log("\nNext:");
  console.log("  1. transfer FeeWalletRegistry + MonPadV4FeeConfig ownership to the platform multisig (Ownable2Step)");
  console.log("  2. verify on monadscan (npx hardhat verify --network monad <addr> <args>)");
  console.log("  3. point the app/indexer at contracts.curveFactory and watch CurvePadLaunched from curveFactoryBlock");
  console.log("\n  NOTE: the basic pad wires no staking pool, so at graduation the leftover reserve (~12% of supply)");
  console.log("  is BURNED to 0x…dEaD. To route it to holders instead, deploy a staking pool and call");
  console.log("  curve.setStaking(pool) BEFORE graduate() — it is one-shot and ordering matters.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
