// MonPad V3 — exit-liquidity / "no MON liquidity" regression test.
//
//   cd hardhat-test && npx hardhat test test/v3-sell-cushion.js
//
// Proves a sole holder can buy then sell their FULL position back under the
// low-fee TEST economics (1 MON create / 20 MON graduate), where the creation
// buffer is tiny. Before the fix, the buy "buffer" fee was pulled out to the
// platform and the curve launched with ~0 real-MON exit liquidity, so a 100%
// sell tripped the constant-product rounding edge and reverted "no MON liquidity".
// The fix keeps the buy buffer fee in the curve as exit liquidity until graduation.

const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
const ZERO_CFG = { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 0, taxLpBps: 0 };

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

async function launch(ctx) {
  const fee = await ctx.factory.creationFee();
  const tx = await ctx.factory.connect(ctx.creator).createLaunch("Trucka", "TRK", ZERO_CFG, { value: fee });
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

describe("MonPad V3 — exit liquidity (no MON liquidity regression)", () => {
  it("seeds a real-MON buffer from the creation fee", async () => {
    const ctx = await deploy();
    const buffer = await ctx.factory.CREATION_BUFFER_MON();
    const { curve } = await launch(ctx);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    expect(await c.realMonReserve()).to.equal(buffer);
    expect(buffer).to.be.gt(0n); // must be <= creationFee or the launch seeds nothing
  });

  it("a sole holder can sell 100% of their position back without reverting", async () => {
    const ctx = await deploy();
    const { token, curve } = await launch(ctx);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);

    // Buy a modest amount well under the 20 MON graduation target.
    await c.connect(ctx.buyer).buy(0, { value: 3n * E18 });
    const held = await tok.balanceOf(ctx.buyer.address);
    expect(held).to.be.gt(0n);

    // Sell the ENTIRE balance back — this is the case that used to revert.
    await tok.connect(ctx.buyer).approve(curve, held);
    const monBefore = await ethers.provider.getBalance(ctx.buyer.address);
    await expect(c.connect(ctx.buyer).sell(held, 0)).to.not.be.reverted;
    const monAfter = await ethers.provider.getBalance(ctx.buyer.address);

    // Received MON back (net of gas it's still a meaningful refund) and dust-only tokens left.
    expect(await tok.balanceOf(ctx.buyer.address)).to.equal(0n);
    expect(monAfter).to.be.gt(monBefore - (E18 / 100n)); // didn't lose ~everything to a failed tx
  });

  it("multiple buyers can each fully exit (cushion grows with volume)", async () => {
    const ctx = await deploy();
    const [, , , , , , a, b] = await ethers.getSigners();
    const { token, curve } = await launch(ctx);
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    const tok = await ethers.getContractAt("MonPadTokenV2", token);

    await c.connect(a).buy(0, { value: 4n * E18 });
    await c.connect(b).buy(0, { value: 5n * E18 });

    // First buyer exits fully while the second still holds.
    const aHeld = await tok.balanceOf(a.address);
    await tok.connect(a).approve(curve, aHeld);
    await expect(c.connect(a).sell(aHeld, 0)).to.not.be.reverted;

    // Second buyer then exits fully too.
    const bHeld = await tok.balanceOf(b.address);
    await tok.connect(b).approve(curve, bHeld);
    await expect(c.connect(b).sell(bHeld, 0)).to.not.be.reverted;
  });
});

describe("MonPad V3 — graduation still works with buffer-in-curve", () => {
  it("reaches the target via buys and graduates (LP includes the buffer)", async () => {
    const [owner, creator, buyer, platform, treasury, buyback, w1, w2, w3] = await ethers.getSigners();
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

    const fee = await factory.creationFee();
    const tx = await factory.connect(creator).createLaunch("Grad", "GRD", ZERO_CFG, { value: fee });
    const rc = await tx.wait();
    let token, curve;
    for (const log of rc.logs) { try { const p = factory.interface.parseLog({ topics: log.topics, data: log.data }); if (p && p.name === "Launch") { token = p.args.token; curve = p.args.curve; break; } } catch (_) {} }
    const c = await ethers.getContractAt("MonPadCurveV3", curve);

    // Buy in chunks to push monRaisedNet past the 20 MON target.
    // Protocol skims ~21% of gross on buys, so need more than 4×6 MON gross.
    for (const w of [buyer, w1, w2, w3, buyer, w1]) {
      await c.connect(w).buy(0, { value: 6n * E18 });
      if (await c.canGrad()) break;
    }
    expect(await c.canGrad()).to.equal(true);
    await expect(c.graduate()).to.not.be.reverted;
    expect(await c.graduated()).to.equal(true);
  });
});
