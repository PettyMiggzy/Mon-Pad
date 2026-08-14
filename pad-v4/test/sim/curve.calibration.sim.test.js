const { ethers } = require("hardhat");
const { expect } = require("chai");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// SIM — CALIBRATION at the real MonPad production geometry, proven against the actual V4 curve impl.
//
//   START_TICK 87300, CURVE_WIDTH 23000 (≈10x), ts=100, 1B supply @ 73% curve / 27% reserve
//   → ~373,000 MON raised, start FDV ~$3.4k, graduate FDV ~$33.9k, 10x chart.
//
// Targets a ~$34k graduation FDV. At $0.021/MON that is a ~373,000 MON raise, which funds a 20%/15%
// platform/creator split at graduation (~$1,566 / ~$1,174) while still leaving ~$5.1k of MON in the permanent
// locked LP. Raising the target further trades post-graduation liquidity for launch-day payout.
//
// Geometry is derived from the closed form for a single-sided currency1 range that is bought from its upper
// bound down to its lower bound:
//
//   raise = curveSupply / (√P_start · √P_grad) = curveSupply / 1.0001^((startTick + gradTick) / 2)
//
// (see scripts/calibrate.js — the same formula reproduces the audited Robinhood geometry's ~4.1 ETH raise from
// START 201600 / WIDTH 23000, which is what validates it.)
//
// The multiple (grad/start) and the MON raise are geometry/supply-fixed and independent of the MON price; the
// USD market caps below are shown at monUsd=$0.021.

const ZERO = ethers.ZeroAddress;
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const ONE = 10n ** 18n;

const START = 87300, WIDTH = 23000, GRAD = START - WIDTH, TS = 100, FEE = 10000, MINGRAD = 22800;
const SUPPLY = 1_000_000_000n * ONE;
const CURVE = 730_000_000n * ONE;   // 73% sold on the curve
const RESERVE = 270_000_000n * ONE; // 27% held back (pairs the permanent LP; the residue is burned at graduation)
const MON_USD = 0.021;

// token is currency1: price P (=1.0001^tick) is token-per-MON, so MON-per-token = 1/P and
// market cap (whole MON) = totalSupplyWholeTokens / P.
const mcMon = (tick) => 1e9 / Math.pow(1.0001, tick);
const mcUsd = (tick) => mcMon(tick) * MON_USD;

function poolIdOf(k) {
  return ethers.keccak256(
    abi.encode(["tuple(address,address,uint24,int24,address)"], [[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]])
  );
}

describe("SIM — MonPad production geometry (373k MON raise, ~$3.4k start, ~$33.9k graduate, 10x)", () => {
  it("launches at the MonPad geometry and reproduces the headline raise + market caps on the V4 curve", async () => {
    const [deployer, platform, creator, whale] = await ethers.getSigners();
    // the raise alone is ~373k MON, well past hardhat's default 10k account balance
    await ethers.provider.send("hardhat_setBalance", [whale.address, "0x" + (10n ** 24n).toString(16)]);

    const pm = await (await ethers.getContractFactory("PoolManager")).deploy(deployer.address);
    const stateView = await (await ethers.getContractFactory("MonPadStateView")).deploy(await pm.getAddress());
    const dep = await (await ethers.getContractFactory("DeterministicDeployer")).deploy();
    const reg = await (await ethers.getContractFactory("FeeWalletRegistry")).deploy(platform.address, deployer.address);
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const posm = await (await ethers.getContractFactory("MockPositionManagerV4")).deploy(await pm.getAddress(), await permit2.getAddress());
    const lockVault = await (await ethers.getContractFactory("LockVault")).deploy(await posm.getAddress(), await reg.getAddress());
    const curveDep = await (await ethers.getContractFactory("CurveV4Deployer")).deploy(await dep.getAddress());
    const stakeDep = await (await ethers.getContractFactory("StakingDeployer")).deploy(await dep.getAddress());
    // BASIC PAD: no floor vault, no ambush vault, no staking — so every share that would route to one is ZERO.
    // Leaving them non-zero with no vault wired would accrue MON into books that only flushFloor()/flushAmbush()
    // can release, and both revert while the target is unset.
    const feeCfg = await (await ethers.getContractFactory("MonPadV4FeeConfig")).deploy(deployer.address, {
      buyTaxBps: 100, sellTaxBps: 100, sellFloorShareBps: 0, buyLpFloorShareBps: 0, buyBufferShareBps: 2000, referralShareBps: 0,
      platformGradBps: 2000, creatorGradBps: 1500, ambushGradBps: 0,
      lpFee: FEE, startTickMag: START, curveWidth: WIDTH, minGradWidth: MINGRAD,
    });
    const factory = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
      await pm.getAddress(), await posm.getAddress(), await permit2.getAddress(), await stateView.getAddress(),
      await dep.getAddress(), await curveDep.getAddress(), await stakeDep.getAddress(), await feeCfg.getAddress(), await reg.getAddress(), await lockVault.getAddress()
    );
    await lockVault.setFactory(await factory.getAddress());

    const cfg = { name: "Calibrate", symbol: "CAL", decimals: 18, supply: SUPPLY, curveSupply: CURVE, reserveSupply: RESERVE, tickSpacing: TS, creator: creator.address };
    const tokenSalt = ethers.id("cal-tok"), curveSalt = ethers.id("cal-curve");
    const TokenF = await ethers.getContractFactory("PadToken");
    const tokenInit = ethers.concat([TokenF.bytecode, abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await factory.getAddress()])]);
    const predictedToken = ethers.getCreate2Address(await dep.getAddress(), tokenSalt, ethers.keccak256(tokenInit));
    const HookF = await ethers.getContractFactory("MonPadFeeHook");
    const { salt: hookSalt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, await pm.getAddress(), await factory.getAddress(), await reg.getAddress(), predictedToken));

    const [token, hook, curveAddr] = await factory.launch.staticCall(cfg, tokenSalt, hookSalt, curveSalt);
    await (await factory.launch(cfg, tokenSalt, hookSalt, curveSalt)).wait();
    const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: TS, hooks: hook };
    const poolId = poolIdOf(key);
    const curve = await ethers.getContractAt("MonPadCurveV4", curveAddr);
    const th = await (await ethers.getContractFactory("TickHelper")).deploy();
    const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(await pm.getAddress());
    const tokC = await ethers.getContractAt("PadToken", token);

    // ── start: the pool inits at startTick (curve top) ──
    const startTick = Number((await stateView.getSlot0(poolId))[1]);
    expect(startTick).to.equal(START);
    const startMc = mcUsd(startTick);

    // ── buy the curve OUT, capping EXACTLY at the graduation price (gradSqrt) so spot lands on the ceiling ──
    // Sized a modest margin above the ~373k MON principal: the buy tax is a fee-on-INPUT computed on the
    // REQUESTED amount, so a wildly oversized request would over-tax the whale on MON that never swaps.
    const gradSqrt = await th.sqrt(GRAD);
    const wBefore = await ethers.provider.getBalance(whale.address);
    const rc = await (await sw.connect(whale).swap(
      key, { zeroForOne: true, amountSpecified: -E(400_000), sqrtPriceLimitX96: gradSqrt },
      { takeClaims: false, settleUsingBurn: false }, "0x", { value: E(400_000) }
    )).wait();
    const spent = wBefore - await ethers.provider.getBalance(whale.address) - rc.gasUsed * rc.gasPrice;
    // the RAISE = the pool PRINCIPAL (what graduation distributes) = whale spend − the buy tax (which is money the
    // platform collects, not raise). The buy tax is minted as an ERC-6909 claim; read it back and subtract.
    const buyTax = await pm.balanceOf(hook, 0n); // ERC-6909 native-MON claim (the whole buy tax)
    const raise = spent - buyTax;
    const gradT = Number((await stateView.getSlot0(poolId))[1]);
    const tokBought = Number(await tokC.balanceOf(whale.address)) / 1e18;
    expect(await curve.ready()).to.equal(true);           // reached the ceiling
    expect(gradT).to.be.closeTo(GRAD, TS);                // spot at the ceiling (gradTick)
    // buy tax is MON (fee-on-input), so NO token is skimmed — the buyer gets the whole 730M curve.
    expect(tokBought).to.be.within(690e6, 735e6);
    const gradMc = mcUsd(GRAD);
    const multiple = mcMon(GRAD) / mcMon(startTick);
    const raiseMon = Number(raise) / 1e18;

    console.log(`      start FDV ~$${Math.round(startMc).toLocaleString()} | grad FDV ~$${Math.round(gradMc).toLocaleString()} | raise ${Math.round(raiseMon).toLocaleString()} MON ($${Math.round(raiseMon * MON_USD).toLocaleString()}) | ${multiple.toFixed(1)}x`);

    // ── assertions: the headline economics hold on the real V4 curve ──
    expect(raiseMon).to.be.within(340_000, 410_000);  // target ~373,000 MON (~$7.8k)
    expect(multiple).to.be.within(9, 11);             // ~10x chart (geometry-fixed, MON-price-independent)
    expect(startMc).to.be.within(2_800, 4_200);       // target ~$3.4k at $0.021/MON
    expect(gradMc).to.be.within(28_000, 42_000);      // target ~$33.9k at $0.021/MON
  });
});
