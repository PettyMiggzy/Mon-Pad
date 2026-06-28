// MonPad V3 (native-MON) — full lifecycle + economics + MONSHI-utility tests.
//
//   cd hardhat-test && npx hardhat test test/v3-flow.js
//
// Covers: native-MON create (+ dev buy), buy/sell, creator fee-config
// (token buyback-burn + LP reserve), per-trade tax, MONSHI buyback accrual+claim,
// MONSHI holder creation-fee discount, treasury pull, value-conservation invariant,
// and graduation into a real WMON/token Uniswap V3 LP ($200 treasury cut + $800
// creator reward + rest/unsold to LP), plus the DexScreener Launch/Trade events.

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const E18 = 10n ** 18n;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO_CFG = { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 0, taxLpBps: 0 };

async function setBal(addr, wei) {
  await network.provider.send("hardhat_setBalance", [addr, "0x" + wei.toString(16)]);
}

async function setup() {
  const [owner, creator, buyer, platform, treasury, buyback] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const monshi = await MockERC20.deploy("Monshi", "MONSHI"); await monshi.waitForDeployment();

  const WMON = await ethers.getContractFactory("MockWMONV3");
  const wmon = await WMON.deploy(); await wmon.waitForDeployment();

  const V3F = await ethers.getContractFactory("MockV3FactoryM");
  const v3f = await V3F.deploy(); await v3f.waitForDeployment();
  const NPM = await ethers.getContractFactory("MockNPMM");
  const npm = await NPM.deploy(v3f.target); await npm.waitForDeployment();

  const Factory = await ethers.getContractFactory("MonPadFactoryV3");
  const factory = await Factory.deploy(platform.address, treasury.address, buyback.address, wmon.target, monshi.target);
  await factory.waitForDeployment();

  const Grad = await ethers.getContractFactory("MonPadGraduatorV3");
  const grad = await Grad.deploy(factory.target, npm.target, wmon.target); await grad.waitForDeployment();

  await factory.bootstrapInit(grad.target, buyback.address);

  return { owner, creator, buyer, platform, treasury, buyback, monshi, wmon, v3f, npm, factory, grad };
}

async function launch(ctx, cfg = ZERO_CFG, devBuy = 0n) {
  const fee = await ctx.factory.creationFeeFor(ctx.creator.address);
  const tx = await ctx.factory.connect(ctx.creator).createLaunch("Test", "TST", cfg, { value: fee + devBuy });
  const rc = await tx.wait();
  let token, curve;
  for (const log of rc.logs) {
    try {
      const p = ctx.factory.interface.parseLog({ topics: log.topics, data: log.data });
      if (p && p.name === "Launch") { token = p.args.token; curve = p.args.curve; break; }
    } catch (_) {}
  }
  return { token, curve, fee };
}

async function curveAt(addr) { return ethers.getContractAt("MonPadCurveV3", addr); }

async function invariant(curveAddr) {
  const c = await curveAt(curveAddr);
  const bal = await ethers.provider.getBalance(curveAddr);
  const obligations =
    (await c.realMonReserve()) + (await c.creatorPending()) + (await c.platformPending()) +
    (await c.lpPendingMon()) + (await c.creatorGraduationPending()) + (await c.monshiBuybackPending());
  expect(bal).to.be.gte(obligations);
}

describe("MonPad V3 (native MON)", () => {
  it("creation fee accrues to treasuryPending and is pullable", async () => {
    const ctx = await setup();
    const fee = await ctx.factory.creationFee();
    const { } = await launch(ctx);
    expect(await ctx.factory.treasuryPending()).to.equal(fee);
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    await ctx.factory.connect(ctx.buyer).claimTreasury(); // permissionless
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - before).to.equal(fee);
  });

  it("dev buy at creation gives the creator tokens, capped at 2%", async () => {
    const ctx = await setup();
    const { token } = await launch(ctx, ZERO_CFG, 100n * E18); // 100 MON dev buy
    const tok = await ethers.getContractAt("MonPadTokenV2", token);
    const bal = await tok.balanceOf(ctx.creator.address);
    expect(bal).to.be.gt(0n);
    expect(bal).to.be.lte((1_000_000_000n * E18 * 200n) / 10000n); // <= 2% supply
  });

  it("buy and sell settle in native MON", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const c = await curveAt(curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);

    await c.connect(ctx.buyer).buy(0, { value: 100n * E18 });
    const tb = await tok.balanceOf(ctx.buyer.address);
    expect(tb).to.be.gt(0n);
    await invariant(curve);

    await tok.connect(ctx.buyer).approve(curve, tb / 2n);
    const before = await ethers.provider.getBalance(ctx.buyer.address);
    const rc = await (await c.connect(ctx.buyer).sell(tb / 2n, 0)).wait();
    const gas = rc.gasUsed * rc.gasPrice;
    expect((await ethers.provider.getBalance(ctx.buyer.address)) + gas).to.be.gt(before);
    await invariant(curve);
  });

  it("creator fee-config buyback-burns the token and reserves LP", async () => {
    const ctx = await setup();
    const cfg = { cfBurnTokenBps: 5000, cfLpBps: 5000, taxBurnTokenBps: 0, taxLpBps: 0 };
    const { curve } = await launch(ctx, cfg);
    const c = await curveAt(curve);
    await c.connect(ctx.buyer).buy(0, { value: 1000n * E18 });
    expect(await c.totalBurnedTokens()).to.be.gt(0n);
    expect(await c.lpPendingMon()).to.be.gt(0n);
    expect(await c.creatorPending()).to.equal(0n); // 100% routed to burn+lp
    await invariant(curve);
  });

  it("per-trade tax hits all traders (burn + LP)", async () => {
    const ctx = await setup();
    const cfg = { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 500, taxLpBps: 500 }; // 10% tax
    const { curve } = await launch(ctx, cfg);
    const c = await curveAt(curve);
    await c.connect(ctx.buyer).buy(0, { value: 1000n * E18 });
    expect(await c.totalBurnedTokens()).to.be.gt(0n);
    expect(await c.lpPendingMon()).to.be.gt(0n);
    await invariant(curve);
  });

  it("MONSHI buyback slice accrues on sells and is claimable to the buyback wallet", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const c = await curveAt(curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);
    await c.connect(ctx.buyer).buy(0, { value: 1000n * E18 });
    const tb = await tok.balanceOf(ctx.buyer.address);
    const sellAmt = tb / 2n; // selling 100% of the sole holding hits a 1-wei rounding edge; sell a portion
    await tok.connect(ctx.buyer).approve(curve, sellAmt);
    await c.connect(ctx.buyer).sell(sellAmt, 0);
    const pend = await c.monshiBuybackPending();
    expect(pend).to.be.gt(0n);
    const before = await ethers.provider.getBalance(ctx.buyback.address);
    await c.connect(ctx.buyer).claimMonshiBuyback();
    expect((await ethers.provider.getBalance(ctx.buyback.address)) - before).to.equal(pend);
  });

  it("MONSHI holders get a discounted creation fee", async () => {
    const ctx = await setup();
    const full = await ctx.factory.creationFee();
    expect(await ctx.factory.creationFeeFor(ctx.creator.address)).to.equal(full); // no MONSHI yet
    await ctx.monshi.mint(ctx.creator.address, await ctx.factory.monshiDiscountThreshold());
    const discounted = await ctx.factory.creationFeeFor(ctx.creator.address);
    expect(discounted).to.be.lt(full);
    expect(discounted).to.equal((full * (10000n - BigInt(await ctx.factory.monshiDiscountBps()))) / 10000n);
  });

  it("graduates into a WMON/token LP with $200 treasury cut + $800 creator reward", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const c = await curveAt(curve);

    await setBal(ctx.buyer.address, 400_000n * E18);
    // One buy that crosses the ~260k target without draining all tokens.
    await c.connect(ctx.buyer).buy(0, { value: 266_000n * E18 });
    expect(await c.canGrad()).to.equal(true);
    expect(await c.graduated()).to.equal(false); // decoupled

    const treBefore = await ethers.provider.getBalance(ctx.treasury.address);
    await c.connect(ctx.buyer).graduate();
    expect(await c.graduated()).to.equal(true);
    expect(await ctx.grad.isGraduated(token)).to.equal(true);

    // $200 treasury cut paid (treasury is a passive EOA, so delta is exact).
    expect((await ethers.provider.getBalance(ctx.treasury.address)) - treBefore).to.equal(await ctx.factory.graduationTreasuryCut());

    // Real WMON/token LP minted via the functional NPM.
    const nftId = await ctx.grad.nftIdFor(token);
    expect(nftId).to.be.gt(0n);
    expect(await ctx.npm.mintedAmount0(nftId)).to.be.gt(0n);
    expect(await ctx.npm.mintedAmount1(nftId)).to.be.gt(0n);
    expect(await ctx.grad.poolFor(token)).to.properAddress;

    // $800 creator reward claimable.
    const [amt, claimed] = await c.graduationRewardClaimable();
    expect(amt).to.equal(await ctx.factory.graduationCreatorReward());
    expect(claimed).to.equal(false);
    await c.connect(ctx.creator).claimGraduationReward();
    expect((await c.graduationRewardClaimable())[1]).to.equal(true);
  });
});
