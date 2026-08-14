const { ethers } = require("hardhat");
const { expect } = require("chai");

const DEAD = "0x000000000000000000000000000000000000dEaD";
const E = (x) => ethers.parseEther(String(x));
const RATE = 1870n * 10n ** 18n; // ~the live rate: 1 MON -> 1,870 MONSHI

describe("MonshiBuyback — platform revenue into burned MONSHI", () => {
  async function setup() {
    const [owner, keeper, stranger, treasury] = await ethers.getSigners();
    const monshi = await (await ethers.getContractFactory("MockMonshi")).deploy();
    const router = await (await ethers.getContractFactory("MockNadDexRouter")).deploy(await monshi.getAddress(), RATE);
    const bb = await (await ethers.getContractFactory("MonshiBuyback")).deploy(
      await monshi.getAddress(), await router.getAddress(), owner.address, treasury.address, 4000, E(1000), 60
    );
    await bb.setKeeper(keeper.address);
    return { owner, keeper, stranger, treasury, monshi, router, bb };
  }

  it("splits the buy 40% treasury / 60% burn, holding nothing afterwards", async () => {
    const { keeper, treasury, monshi, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    expect(await bb.pending()).to.equal(E(100));

    await bb.connect(keeper).buyback(E(180_000));

    const bought = E(187_000); // 100 MON * 1870
    expect(await monshi.balanceOf(treasury.address)).to.equal((bought * 4000n) / 10000n); // 40%
    expect(await monshi.balanceOf(DEAD)).to.equal(bought - (bought * 4000n) / 10000n);    // 60%
    expect(await monshi.balanceOf(await bb.getAddress())).to.equal(0n); // holds nothing after the split
    expect(await bb.totalMonSpent()).to.equal(E(100));
    expect(await bb.totalMonshiBurned()).to.equal(bought - (bought * 4000n) / 10000n);
    expect(await bb.totalMonshiToTreasury()).to.equal((bought * 4000n) / 10000n);
    expect(await bb.pending()).to.equal(0n);
  });

  it("caps the treasury share at 50% — the burn promise cannot be governed away", async () => {
    const { owner, treasury, bb } = await setup();
    await expect(bb.connect(owner).setTreasury(treasury.address, 5001)).to.be.revertedWithCustomError(bb, "BadBps");
    await bb.connect(owner).setTreasury(treasury.address, 5000); // the cap itself is allowed
    expect(await bb.treasuryBps()).to.equal(5000);
    expect(await bb.MAX_TREASURY_BPS()).to.equal(5000);
  });

  it("burns the rounding dust rather than giving it to the treasury", async () => {
    const { owner, keeper, treasury, monshi, router, bb } = await setup();
    await bb.connect(owner).setTreasury(treasury.address, 3333); // non-round split
    await router.setRate(1n); // 1 wei of MONSHI per 1e18 MON -> tiny, dust-prone amount
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(7) });
    await bb.connect(keeper).buyback(1n);
    const t = await monshi.balanceOf(treasury.address);
    const b = await monshi.balanceOf(DEAD);
    expect(t + b).to.equal(7n);          // nothing lost
    expect(t).to.equal((7n * 3333n) / 10000n); // floor
    expect(b).to.equal(7n - t);          // remainder, i.e. dust burns
  });

  it("sweeps stray MONSHI on the same fixed split, permissionlessly", async () => {
    const { stranger, treasury, monshi, bb } = await setup();
    await monshi.mint(await bb.getAddress(), E(1000)); // arrives outside a buyback
    await bb.connect(stranger).sweepStrandedMonshi(); // anyone may call; destination is not theirs to choose
    expect(await monshi.balanceOf(treasury.address)).to.equal(E(400));
    expect(await monshi.balanceOf(DEAD)).to.equal(E(600));
    expect(await monshi.balanceOf(await bb.getAddress())).to.equal(0n);
  });

  it("caps a single buy at maxSpendPerCall so one call can't drain the balance", async () => {
    const { keeper, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(5000) });
    await bb.connect(keeper).buyback(1n);
    expect(await bb.totalMonSpent()).to.equal(E(1000)); // the cap, not the 5000 balance
    expect(await bb.pending()).to.equal(E(4000));
  });

  it("enforces the cooldown between buys", async () => {
    const { keeper, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    await bb.connect(keeper).buyback(1n);
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    await expect(bb.connect(keeper).buyback(1n)).to.be.revertedWithCustomError(bb, "CoolingDown");
    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);
    await bb.connect(keeper).buyback(1n); // fine once the cooldown lapses
  });

  it("is keeper-gated: a stranger cannot trigger a buy with a loose slippage bound", async () => {
    const { keeper, stranger, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    await expect(bb.connect(stranger).buyback(1n)).to.be.revertedWithCustomError(bb, "NotKeeper");
  });

  it("honours the slippage bound — a bad price reverts instead of burning less", async () => {
    const { keeper, router, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    await router.setRate(1000n * 10n ** 18n); // price moved against us
    await expect(bb.connect(keeper).buyback(E(180_000))).to.be.revertedWithCustomError(router, "InsufficientOutput");
  });

  it("has no MON withdrawal path — MON can only ever leave as a MONSHI buy", async () => {
    const { bb } = await setup();
    const fns = bb.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["withdraw", "rescue", "emergencyWithdraw", "transferETH", "recover", "sweepMon"]) {
      expect(fns).to.not.include(bad);
    }
    // the only MONSHI exits are buyback + sweepStrandedMonshi, and BOTH use the same capped split
    expect(fns).to.include("buyback");
    expect(fns).to.include("sweepStrandedMonshi");
  });
});

describe("PlatformFeeSplitter — routing platform revenue", () => {
  async function setup(bps = 2000) {
    const [owner, treasury, funder] = await ethers.getSigners();
    const monshi = await (await ethers.getContractFactory("MockMonshi")).deploy();
    const router = await (await ethers.getContractFactory("MockNadDexRouter")).deploy(await monshi.getAddress(), RATE);
    const bb = await (await ethers.getContractFactory("MonshiBuyback")).deploy(
      await monshi.getAddress(), await router.getAddress(), owner.address, treasury.address, 4000, E(100000), 0
    );
    const sp = await (await ethers.getContractFactory("PlatformFeeSplitter")).deploy(
      await bb.getAddress(), treasury.address, owner.address, bps
    );
    return { owner, treasury, funder, monshi, router, bb, sp };
  }

  it("splits fresh revenue by buybackBps, remainder to treasury", async () => {
    const { treasury, funder, bb, sp } = await setup(2000);
    const before = await ethers.provider.getBalance(treasury.address);
    await funder.sendTransaction({ to: await sp.getAddress(), value: E(1000) });
    await sp.distribute();
    expect(await ethers.provider.getBalance(await bb.getAddress())).to.equal(E(200)); // 20%
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.equal(E(800)); // 80%
    expect(await ethers.provider.getBalance(await sp.getAddress())).to.equal(0n);
  });

  it("receive() cannot revert — the platform's claim path can never be blocked by routing", async () => {
    const { funder, sp } = await setup();
    // a plain transfer with no data must always succeed, whatever the splitter's state
    await expect(funder.sendTransaction({ to: await sp.getAddress(), value: E(1) })).to.not.be.reverted;
    expect(await ethers.provider.getBalance(await sp.getAddress())).to.equal(E(1));
  });

  it("a failing treasury cannot trap the buyback leg — it books and retries", async () => {
    const { owner, funder, bb, sp } = await setup(2000);
    const bad = await (await ethers.getContractFactory("RejectingRecipient")).deploy();
    await sp.connect(owner).setTreasury(await bad.getAddress());

    await funder.sendTransaction({ to: await sp.getAddress(), value: E(1000) });
    await sp.distribute();

    expect(await ethers.provider.getBalance(await bb.getAddress())).to.equal(E(200)); // buyback still paid
    expect(await sp.treasuryOwed()).to.equal(E(800)); // parked, not lost, not reverted

    await sp.connect(owner).setTreasury(funder.address); // repoint to something that works
    await sp.distribute();
    expect(await sp.treasuryOwed()).to.equal(0n);
    expect(await ethers.provider.getBalance(await sp.getAddress())).to.equal(0n);
  });

  it("caps the divertable share at 50% of platform revenue", async () => {
    const { owner, sp } = await setup();
    await expect(sp.connect(owner).setBuybackBps(5001)).to.be.revertedWithCustomError(sp, "BadBps");
    await sp.connect(owner).setBuybackBps(5000); // the cap itself is fine
    expect(await sp.buybackBps()).to.equal(5000);
  });

  it("end to end: platform revenue arrives, splits, buys MONSHI and burns the majority", async () => {
    const { funder, treasury, monshi, bb, sp } = await setup(2000);
    await funder.sendTransaction({ to: await sp.getAddress(), value: E(1000) });
    await sp.distribute();
    await bb.buyback(E(370_000));
    const bought = E(374_000); // 200 MON * 1870
    expect(await monshi.balanceOf(DEAD)).to.equal(bought - (bought * 4000n) / 10000n); // 60% burned
    expect(await monshi.balanceOf(treasury.address)).to.equal((bought * 4000n) / 10000n); // 40% treasury
  });
});
