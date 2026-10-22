// MonPad V3 — monRaisedNet must exclude buyback-burn MON (graduation-progress fix).
//
//   cd hardhat-test && npx hardhat test test/v3-monraised-net.js
//
// Regression for the audit Low: _buyAndBurn used to do `monRaisedNet += monAmt`,
// so recycled buyback-burn MON (from a creator's per-trade tax) inflated the
// graduation-progress driver and could bond a token before gradTarget of genuine
// buy-in. monRaisedNet must reflect ONLY curve-directed net buys (monForBuy).

const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
// 10% per-trade tax, all to buyback-burn — guarantees _buyAndBurn fires on every buy.
const TAX_CFG = { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 1000, taxLpBps: 0 };

async function deploy() {
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
  return { owner, creator, buyer, platform, treasury, factory };
}

async function launch(ctx, cfg) {
  const fee = await ctx.factory.creationFee();
  const tx = await ctx.factory.connect(ctx.creator).createLaunch("Taxed", "TAX", cfg, { value: fee });
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

describe("MonPad V3 — monRaisedNet excludes buyback-burn", () => {
  it("a buy on a tax-burn token advances monRaisedNet by monForBuy only", async () => {
    const ctx = await deploy();
    const { curve } = await launch(ctx, TAX_CFG);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);

    // monRaisedNet starts at 0 (no dev buy).
    expect(await c.monRaisedNet()).to.equal(0n);

    const monIn = 5n * E18;
    const creatorBps = await ctx.factory.buyFeeCreatorBps();
    const bufferBps  = await ctx.factory.buyFeeBufferBps();
    const stakingBps = await ctx.factory.sellFeeStakingBps();
    const platformBps = await ctx.factory.sellFeePlatformBps();
    const taxBps     = await c.tradeTaxBps();
    const creatorFee = (monIn * creatorBps) / 10000n;
    const bufferFee  = (monIn * bufferBps) / 10000n;
    const stakingFee = (monIn * stakingBps) / 10000n;
    const platformFee = (monIn * platformBps) / 10000n;
    const taxTotal   = (monIn * taxBps) / 10000n;
    const expectedNet = monIn - creatorFee - bufferFee - stakingFee - platformFee - taxTotal;
    expect(taxTotal).to.be.gt(0n); // sanity: the tax (and thus the burn path) is live

    // The buy must emit BuybackBurn (proves _buyAndBurn ran — the code path that
    // used to inflate monRaisedNet).
    await expect(c.connect(ctx.buyer).buy(0, { value: monIn })).to.emit(c, "BuybackBurn");

    // monRaisedNet reflects ONLY curve-directed net buys — NOT the recycled burn MON.
    expect(await c.monRaisedNet()).to.equal(expectedNet);
    // Gross monRaised is strictly larger (it includes fees + the burn micro-buy).
    expect(await c.monRaised()).to.be.gt(await c.monRaisedNet());
  });

  it("does not graduate earlier than genuine net buy-in reaches gradTarget", async () => {
    const ctx = await deploy();
    const { curve } = await launch(ctx, TAX_CFG);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    const target = await c.gradTarget();

    // Buy in chunks; canGrad must track monRaisedNet >= gradTarget, and monRaisedNet
    // must never exceed the sum of net buys (no burn inflation pushing it over early).
    const [, , , , , , w1, w2, w3, w4, w5] = await ethers.getSigners();
    for (const w of [ctx.buyer, w1, w2, w3, w4, w5]) {
      await c.connect(w).buy(0, { value: 6n * E18 });
      const net = await c.monRaisedNet();
      expect(await c.canGrad()).to.equal(net >= target);
    }
  });
});
