// Protocol fee stack: 10% token burn + 10% MONSHI buyback (MON) + 10% platform (MON)
// on every buy and sell. Platform never takes project tokens on sells.
//
//   cd hardhat-test && npx hardhat test test/v3-protocol-fees.js

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
  await setBal(buyer.address, 10_000n * E18);
  await setBal(creator.address, 10_000n * E18);

  return { owner, creator, buyer, platform, treasury, buyback, monshi, wmon, factory, grad };
}

async function launch(ctx, cfg = ZERO_CFG) {
  const fee = await ctx.factory.creationFeeFor(ctx.creator.address);
  const tx = await ctx.factory.connect(ctx.creator).createLaunch("FeeTok", "FEE", cfg, { value: fee });
  const rc = await tx.wait();
  let token, curve;
  for (const log of rc.logs) {
    try {
      const p = ctx.factory.interface.parseLog({ topics: log.topics, data: log.data });
      if (p && p.name === "Launch") { token = p.args.token; curve = p.args.curve; break; }
    } catch (_) {}
  }
  return { token, curve };
}

describe("MonPad V3 protocol fee stack", () => {
  it("factory defaults: 10% token burn, 10% monshi, 10% platform", async () => {
    const ctx = await setup();
    expect(await ctx.factory.protocolBurnTokenBps()).to.equal(1000);
    expect(await ctx.factory.sellFeeStakingBps()).to.equal(1000);
    expect(await ctx.factory.sellFeePlatformBps()).to.equal(1000);
  });

  it("buy burns 10% of tokens to DEAD and accrues MON platform + monshi fees", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);

    const monIn = 10n * E18;
    const deadBefore = await tok.balanceOf(DEAD);
    const buyTx = await c.connect(ctx.buyer).buy(0, { value: monIn });
    await buyTx.wait();

    const buyerBal = await tok.balanceOf(ctx.buyer.address);
    const deadAfter = await tok.balanceOf(DEAD);
    const burned = deadAfter - deadBefore;

    // Buyer got 90%; dead got 10% of gross tokensOut ⇒ burned * 9 ≈ buyerBal
    expect(burned).to.be.gt(0n);
    const diff = burned * 9n > buyerBal ? burned * 9n - buyerBal : buyerBal - burned * 9n;
    expect(diff).to.be.lte(buyerBal / 500n);

    const platformPending = await c.platformPending();
    const monshiPending = await c.monshiBuybackPending();
    expect(platformPending).to.equal((monIn * 1000n) / 10000n);
    expect(monshiPending).to.equal((monIn * 1000n) / 10000n);
    expect(await c.totalBurnedTokens()).to.equal(burned);
  });

  it("sell burns 10% of tokens; platform + monshi taken in MON only", async () => {
    const ctx = await setup();
    const { token, curve } = await launch(ctx);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);

    await (await c.connect(ctx.buyer).buy(0, { value: 50n * E18 })).wait();
    const bal = await tok.balanceOf(ctx.buyer.address);
    const sellAmt = bal / 2n;

    const deadBefore = await tok.balanceOf(DEAD);
    const platBefore = await c.platformPending();
    const monshiBefore = await c.monshiBuybackPending();

    await (await tok.connect(ctx.buyer).approve(curve, sellAmt)).wait();
    await (await c.connect(ctx.buyer).sell(sellAmt, 0)).wait();

    const burned = (await tok.balanceOf(DEAD)) - deadBefore;
    expect(burned).to.equal((sellAmt * 1000n) / 10000n);

    const platDelta = (await c.platformPending()) - platBefore;
    const monshiDelta = (await c.monshiBuybackPending()) - monshiBefore;
    expect(platDelta).to.be.gt(0n);
    expect(monshiDelta).to.be.gt(0n);
    // Platform never received project tokens
    expect(await tok.balanceOf(ctx.platform.address)).to.equal(0n);
  });
});
