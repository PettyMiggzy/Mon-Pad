// MonPad MONSHI-native rebuild — lifecycle + creator-tokenomics tests.
//
// Run:
//   cd hardhat-test && npx hardhat test test/monshi-flow.js
//
// Covers:
//   - createLaunch pays the creation fee in MONSHI (ERC20), not native MON
//   - buy()/sell() denominated in MONSHI (approve + transferFrom / transfer)
//   - Creator-fee routing: burn token (buyback) + burn MONSHI + LP reserve
//   - Per-trade tax applied to ALL traders, routed to burn/LP
//   - Value-conservation invariant on the curve's MONSHI balance
//   - Graduation builds a MONSHI/token Uniswap V3 LP (real graduator + functional mocks)
//   - setFeeConfig is creator-only and capped
//   - Uniswap-V2 read shim (getReserves/token0/token1) for DEX index-readiness

const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
const DEAD = "0x000000000000000000000000000000000000dEaD";

const ZERO_CFG = {
  cfBurnTokenBps: 0, cfBurnMonshiBps: 0, cfLpBps: 0,
  taxBurnTokenBps: 0, taxBurnMonshiBps: 0, taxLpBps: 0,
};

async function setup() {
  const [owner, creator, buyer, platform, treasury, buyback] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const monshi = await MockERC20.deploy("Monshi", "MONSHI");
  await monshi.waitForDeployment();

  const V3F = await ethers.getContractFactory("MockV3FactoryM");
  const v3factory = await V3F.deploy();
  await v3factory.waitForDeployment();

  const NPM = await ethers.getContractFactory("MockNPMM");
  const npm = await NPM.deploy(v3factory.target);
  await npm.waitForDeployment();

  const Factory = await ethers.getContractFactory("MonPadFactoryV2Monshi");
  const factory = await Factory.deploy(platform.address, treasury.address, buyback.address, monshi.target);
  await factory.waitForDeployment();

  const Grad = await ethers.getContractFactory("MonPadGraduatorMonshi");
  const grad = await Grad.deploy(factory.target, npm.target, monshi.target);
  await grad.waitForDeployment();

  // bootstrap: graduator, rewardRouter = buyback EOA (staking fee transfers there), poolFactory = dummy nonzero
  await factory.bootstrapInit(grad.target, buyback.address, treasury.address);

  await monshi.mint(creator.address, 3_000_000n * E18);
  await monshi.mint(buyer.address, 3_000_000n * E18);

  return { owner, creator, buyer, platform, treasury, buyback, monshi, factory, grad, npm, v3factory };
}

async function launch(ctx, cfg = ZERO_CFG, devBuy = 0n) {
  const fee = await ctx.factory.creationFee();
  const quoteAmount = fee + devBuy;
  await ctx.monshi.connect(ctx.creator).approve(ctx.factory.target, quoteAmount);
  const tx = await ctx.factory.connect(ctx.creator).createLaunch("Test", "TST", quoteAmount, cfg);
  const rc = await tx.wait();
  let token, curve;
  for (const log of rc.logs) {
    try {
      const p = ctx.factory.interface.parseLog({ topics: log.topics, data: log.data });
      if (p && p.name === "Launched") { token = p.args.token; curve = p.args.curve; break; }
    } catch (_) { /* not a factory event */ }
  }
  return { token, curve };
}

async function buy(ctx, curveAddr, quoteIn) {
  const curve = await ethers.getContractAt("MonPadCurveV2Monshi", curveAddr);
  await ctx.monshi.connect(ctx.buyer).approve(curveAddr, quoteIn);
  return curve.connect(ctx.buyer).buy(quoteIn, 0);
}

async function invariant(ctx, curveAddr) {
  const curve = await ethers.getContractAt("MonPadCurveV2Monshi", curveAddr);
  const bal = await ctx.monshi.balanceOf(curveAddr);
  const obligations =
    (await curve.realMonReserve()) +
    (await curve.creatorPending()) +
    (await curve.platformPending()) +
    (await curve.lpPendingMonshi()) +
    (await curve.creatorGraduationPending());
  expect(bal).to.be.gte(obligations);
}

describe("MONSHI-native MonPad", () => {
  it("createLaunch charges the creation fee in MONSHI to the treasury", async () => {
    const ctx = await setup();
    const fee = await ctx.factory.creationFee();
    const before = await ctx.monshi.balanceOf(ctx.treasury.address);
    const { token, curve } = await launch(ctx);
    expect(token).to.properAddress;
    expect(curve).to.properAddress;
    expect((await ctx.monshi.balanceOf(ctx.treasury.address)) - before).to.equal(fee);
    expect(await ctx.factory.tokToCurve(token)).to.equal(curve);
  });

  it("buy and sell are denominated in MONSHI", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    await buy(ctx, curve, 1000n * E18);
    const tokBal = await tok.balanceOf(ctx.buyer.address);
    expect(tokBal).to.be.gt(0n);
    expect(await curveC.realMonReserve()).to.be.gt(0n);
    await invariant(ctx, curve);

    // sell half back
    const sellAmt = tokBal / 2n;
    await tok.connect(ctx.buyer).approve(curve, sellAmt);
    const monBefore = await ctx.monshi.balanceOf(ctx.buyer.address);
    await curveC.connect(ctx.buyer).sell(sellAmt, 0);
    expect(await ctx.monshi.balanceOf(ctx.buyer.address)).to.be.gt(monBefore);
    await invariant(ctx, curve);
  });

  it("creator-fee routing burns token + MONSHI and reserves LP", async () => {
    const ctx = await setup();
    // Creator routes 100% of their fee: 30% token-buyback-burn, 30% MONSHI burn, 40% LP.
    const cfg = { ...ZERO_CFG, cfBurnTokenBps: 3000, cfBurnMonshiBps: 3000, cfLpBps: 4000 };
    const { curve } = await launch(ctx, cfg);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    const deadBefore = await ctx.monshi.balanceOf(DEAD);
    await buy(ctx, curve, 5000n * E18);

    expect(await curveC.totalBurnedTokens()).to.be.gt(0n);   // buyback-burn happened
    expect(await curveC.totalBurnedMonshi()).to.be.gt(0n);   // MONSHI burn happened
    expect(await curveC.lpPendingMonshi()).to.be.gt(0n);     // LP reserved
    expect(await ctx.monshi.balanceOf(DEAD)).to.be.gt(deadBefore); // MONSHI actually left to dEaD
    // creator routed 100% of fee → nothing to claim
    expect(await curveC.creatorPending()).to.equal(0n);
    await invariant(ctx, curve);
  });

  it("per-trade tax hits all traders and routes to burn/LP", async () => {
    const ctx = await setup();
    const cfg = { ...ZERO_CFG, taxBurnTokenBps: 200, taxBurnMonshiBps: 100, taxLpBps: 200 }; // 5% total tax
    const { curve } = await launch(ctx, cfg);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    await buy(ctx, curve, 5000n * E18);
    expect(await curveC.totalBurnedTokens()).to.be.gt(0n);
    expect(await curveC.totalBurnedMonshi()).to.be.gt(0n);
    expect(await curveC.lpPendingMonshi()).to.be.gt(0n);
    await invariant(ctx, curve);
  });

  it("setFeeConfig is creator-only and capped", async () => {
    const ctx = await setup();
    const { curve } = await launch(ctx);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    await expect(
      curveC.connect(ctx.buyer).setFeeConfig({ ...ZERO_CFG, cfLpBps: 5000 })
    ).to.be.revertedWith("!creator");

    // tax over MAX_TRADE_TAX_BPS (1000) rejected
    await expect(
      curveC.connect(ctx.creator).setFeeConfig({ ...ZERO_CFG, taxLpBps: 2000 })
    ).to.be.revertedWith("tax > max");

    // creator-fee buckets over 100% rejected
    await expect(
      curveC.connect(ctx.creator).setFeeConfig({ ...ZERO_CFG, cfBurnTokenBps: 6000, cfLpBps: 6000 })
    ).to.be.revertedWith("cf > 100%");

    // valid update succeeds
    await curveC.connect(ctx.creator).setFeeConfig({ ...ZERO_CFG, cfLpBps: 5000 });
    const cfg = await curveC.feeConfig();
    expect(cfg.cfLpBps).to.equal(5000n);
  });

  it("exposes a Uniswap-V2 read shim for DEX index-readiness", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    const t0 = await curveC.token0();
    const t1 = await curveC.token1();
    expect(BigInt(t0)).to.be.lt(BigInt(t1)); // address-ordered
    const [r0, r1] = await curveC.getReserves();
    expect(r0).to.be.gt(0n);
    expect(r1).to.be.gt(0n);
    // the pair is token vs MONSHI
    expect([t0.toLowerCase(), t1.toLowerCase()]).to.include(token.toLowerCase());
    expect([t0.toLowerCase(), t1.toLowerCase()]).to.include(ctx.monshi.target.toLowerCase());
  });

  it("graduates into a MONSHI/token V3 LP and pays the creator reward in MONSHI", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);

    // One big buy to cross the 425k MONSHI graduation target. Graduation is decoupled from
    // buy() (audit fix), so the buy itself must NOT revert and must NOT auto-graduate.
    await buy(ctx, curve, 450_000n * E18);
    expect(await curveC.graduated()).to.equal(false);
    expect(await curveC.canGrad()).to.equal(true);

    // Finalize via the separate, permissionless, retryable graduate().
    await curveC.connect(ctx.buyer).graduate();
    expect(await curveC.graduated()).to.equal(true);
    expect(await ctx.grad.isGraduated(token)).to.equal(true);

    // The functional NPM minted a position with both token + MONSHI.
    const nftId = await ctx.grad.nftIdFor(token);
    expect(nftId).to.be.gt(0n);
    expect(await ctx.npm.mintedAmount0(nftId)).to.be.gt(0n);
    expect(await ctx.npm.mintedAmount1(nftId)).to.be.gt(0n);

    // The pool holds both sides → MONSHI/token pair.
    const pool = await ctx.grad.poolFor(token);
    expect(pool).to.properAddress;
    expect(await ctx.monshi.balanceOf(ctx.npm.target)).to.be.gt(0n);

    // Creator graduation reward (25k MONSHI) claimable.
    const [amt, claimed] = await curveC.graduationRewardClaimable();
    expect(amt).to.equal(25_000n * E18);
    expect(claimed).to.equal(false);

    const before = await ctx.monshi.balanceOf(ctx.creator.address);
    await curveC.connect(ctx.creator).claimGraduationReward();
    expect((await ctx.monshi.balanceOf(ctx.creator.address)) - before).to.equal(25_000n * E18);
  });
});
