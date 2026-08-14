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
      await monshi.getAddress(), await router.getAddress(), owner.address, E(1000), 60
    );
    await bb.setKeeper(keeper.address);
    return { owner, keeper, stranger, treasury, monshi, router, bb };
  }

  it("buys MONSHI straight into the burn address — never holds it", async () => {
    const { keeper, monshi, bb } = await setup();
    await keeper.sendTransaction({ to: await bb.getAddress(), value: E(100) });
    expect(await bb.pending()).to.equal(E(100));

    await bb.connect(keeper).buyback(E(180_000));

    expect(await monshi.balanceOf(DEAD)).to.equal(E(187_000)); // 100 MON * 1870
    expect(await monshi.balanceOf(await bb.getAddress())).to.equal(0n); // never touches this contract
    expect(await bb.totalMonSpent()).to.equal(E(100));
    expect(await bb.totalMonshiBurned()).to.equal(E(187_000));
    expect(await bb.pending()).to.equal(0n);
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

  it("has no withdrawal path — MON can only ever leave as a MONSHI burn", async () => {
    const { bb } = await setup();
    const fns = bb.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["withdraw", "sweep", "rescue", "emergencyWithdraw", "transferETH", "recover"]) {
      expect(fns).to.not.include(bad);
    }
  });
});

describe("PlatformFeeSplitter — routing platform revenue", () => {
  async function setup(bps = 2000) {
    const [owner, treasury, funder] = await ethers.getSigners();
    const monshi = await (await ethers.getContractFactory("MockMonshi")).deploy();
    const router = await (await ethers.getContractFactory("MockNadDexRouter")).deploy(await monshi.getAddress(), RATE);
    const bb = await (await ethers.getContractFactory("MonshiBuyback")).deploy(
      await monshi.getAddress(), await router.getAddress(), owner.address, E(100000), 0
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

  it("end to end: platform revenue arrives, splits, and burns MONSHI", async () => {
    const { funder, monshi, bb, sp } = await setup(2000);
    await funder.sendTransaction({ to: await sp.getAddress(), value: E(1000) });
    await sp.distribute();
    await bb.buyback(E(370_000));
    expect(await monshi.balanceOf(DEAD)).to.equal(E(374_000)); // 200 MON * 1870
  });
});
