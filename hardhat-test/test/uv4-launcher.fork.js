// MonpadHookLauncher (Uniswap V4 + hook) against a FORK of Monad mainnet (real V4 PoolManager).
// Run:  FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-launcher.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTick } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const STATE_VIEW = "0x77395f3b2e73ae90843717371294fa97cc419d64";
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const DYNAMIC = 0x800000;
const E = (n) => ethers.parseEther(String(n));
const SUPPLY = E(1_000_000_000);

const erc20 = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"];
const stateViewAbi = [
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32) view returns (uint128)",
];

// Superseded by test/uv4-usdc.fork.js (USDC-quoted pools).
(process.env.FORK_RPC ? describe.skip : describe.skip)("MonpadHookLauncher (Uniswap V4 hook, fork of Monad mainnet)", function () {
  this.timeout(900000);
  const START_TICK = uv4StartTick(250000);
  let owner, platform, creator, other, keeper, launcher, hook, trader, sv;
  let salt = 0;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);

  const keyOf = (token, hooks) => ({ currency0: ethers.ZeroAddress, currency1: token, fee: DYNAMIC, tickSpacing: 200, hooks });
  const idOf = (key) =>
    ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));

  async function setup(monshi = MONSHI) {
    return deployHookAndLauncher(owner, { poolManager: POOL_MANAGER, owner: owner.address, platform: platform.address, monshi, startTick: START_TICK, creationFee: E(100) });
  }

  async function launch(l, tax = 0, value = E(100), who = creator) {
    const tx = await l.connect(who).launch("Test Coin", "TST", nextSalt(), tax, { value });
    const rc = await tx.wait();
    const ev = rc.logs.map((x) => { try { return l.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Launched");
    return { token: ev.args.token, poolId: ev.args.poolId, gas: rc.gasUsed, devBuyTokens: ev.args.devBuyTokens };
  }

  before(async function () {
    [owner, platform, creator, other, keeper] = await ethers.getSigners();
    for (const a of [owner, creator, other, keeper]) await setBalance(a.address, E(10_000_000));
    ({ launcher, hook } = await setup());
    trader = await (await ethers.getContractFactory("TestV4Trader")).deploy(POOL_MANAGER);
    await setBalance(await trader.getAddress(), E(5_000_000));
    sv = new ethers.Contract(STATE_VIEW, stateViewAbi, ethers.provider);
  });

  // keyOf needs the hook address; fix up after setup
  async function L1(tax = 0, value = E(100)) {
    const r = await launch(launcher, tax, value);
    r.key = keyOf(r.token, await hook.getAddress());
    return r;
  }

  it("hook lives at a mined address with exactly the before-initialize and before-swap flags", async function () {
    const a = BigInt(await hook.getAddress());
    expect(a & ((1n << 14n) - 1n)).to.equal(0x2080n);
    expect((await launcher.hook()).toLowerCase()).to.equal((await hook.getAddress()).toLowerCase());
    expect((await hook.launcher()).toLowerCase()).to.equal((await launcher.getAddress()).toLowerCase());
  });

  it("launch: real V4 pool, native-MON pair, whole supply single-sided, nothing left over", async function () {
    const r = await L1(0);
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const [, tick] = await sv.getSlot0(r.poolId);
    expect(tick).to.equal(BigInt(START_TICK));
    expect(await sv.getLiquidity(r.poolId)).to.equal(0n); // price sits on the top tick: all token, none "active" yet
    expect(await token.balanceOf(await launcher.getAddress())).to.equal(0n);
    const inPm = await token.balanceOf(POOL_MANAGER);
    const dust = await token.balanceOf(DEAD);
    expect(inPm + dust).to.equal(SUPPLY);
    expect(dust).to.be.lt(SUPPLY / 1_000_000n);
    console.log("      launch gas:", r.gas.toString());
  });

  it("an outsider cannot create a pool that uses our hook", async function () {
    const r = await L1(0);
    const pm = new ethers.Contract(POOL_MANAGER, ["function initialize((address,address,uint24,int24,address),uint160) returns (int24)"], other);
    const bad = [ethers.ZeroAddress, other.address, DYNAMIC, 60, await hook.getAddress()];
    await expect(pm.initialize(bad, 79228162514264337593543950336n)).to.be.reverted;
  });

  it("the swap fee is enforced in the pool: 1% base, harvested and split 70/10/10/10", async function () {
    const r = await L1(0);
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    await trader.buy(r.key, E(1000));
    const held = await token.balanceOf(await trader.getAddress());
    expect(held).to.be.gt(0n);
    await trader.sell(r.key, held / 4n);

    const deadBefore = await token.balanceOf(DEAD);
    const cBefore = await launcher.claimable(creator.address, ethers.ZeroAddress);
    const pBefore = await launcher.claimable(platform.address, ethers.ZeroAddress);
    const mBefore = await launcher.monshiReserve();
    const rc = await (await launcher.harvest(r.token)).wait();
    const ev = rc.logs.map((x) => { try { return launcher.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Harvested");
    const nativeFees = ev.args.nativeFees;
    const tokenFees = ev.args.tokenFees;
    // 1% of a 1000 MON buy
    expect(nativeFees).to.be.gt(E("9.99"));
    expect(nativeFees).to.be.lte(E(10));
    expect(tokenFees).to.be.gt(0n);

    // native side: 70 creator / 10 platform / 10 MONSHI reserve / remainder to the token buyback reserve
    expect((await launcher.claimable(creator.address, ethers.ZeroAddress)) - cBefore).to.equal((nativeFees * 7000n) / 10000n);
    expect((await launcher.claimable(platform.address, ethers.ZeroAddress)) - pBefore).to.equal((nativeFees * 1000n) / 10000n);
    expect((await launcher.monshiReserve()) - mBefore).to.equal((nativeFees * 1000n) / 10000n);
    const nc = (nativeFees * 7000n) / 10000n, np = (nativeFees * 1000n) / 10000n, nm = (nativeFees * 1000n) / 10000n;
    expect(await launcher.tokenReserve(r.token)).to.equal(nativeFees - nc - np - nm); // remainder, so no wei is lost
    // token side: 70 creator / 10 platform / 20 burned in the token itself
    expect(await launcher.claimable(creator.address, r.token)).to.equal((tokenFees * 7000n) / 10000n);
    expect(await launcher.claimable(platform.address, r.token)).to.equal((tokenFees * 1000n) / 10000n);
    const tc = (tokenFees * 7000n) / 10000n, tp = (tokenFees * 1000n) / 10000n;
    expect((await token.balanceOf(DEAD)) - deadBefore).to.equal(tokenFees - tc - tp);
  });

  it("creator tax: pool charges 1% + tax; the extra goes to buy-and-burn, never to the creator", async function () {
    const r = await L1(500); // +5% => 6% total
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const before = await launcher.claimable(creator.address, ethers.ZeroAddress);
    await trader.buy(r.key, E(1000));
    const held = await token.balanceOf(await trader.getAddress());
    await trader.sell(r.key, held / 5n);

    const rc = await (await launcher.harvest(r.token)).wait();
    const ev = rc.logs.map((x) => { try { return launcher.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Harvested");
    const f = ev.args.nativeFees;
    expect(f).to.be.gt(E("59.9")); // 6% of 1000 MON
    expect(f).to.be.lte(E(60));

    const extra = (f * 500n) / 600n;
    const base = f - extra;
    expect((await launcher.claimable(creator.address, ethers.ZeroAddress)) - before).to.equal((base * 7000n) / 10000n);
    const toCreator = (base * 7000n) / 10000n;
    const toPlatform = (base * 1000n) / 10000n;
    const toMonshi = (base * 1000n) / 10000n;
    expect(await launcher.tokenReserve(r.token)).to.equal(base - toCreator - toPlatform - toMonshi + extra);
    // the creator's share is the 70% of the 1% base only, far below 70% of the 6%
    expect((await launcher.claimable(creator.address, ethers.ZeroAddress)) - before).to.be.lt((f * 7000n) / 10000n / 2n);
  });

  it("rejects a creator tax above 5%", async function () {
    await expect(launcher.connect(creator).launch("T", "T", nextSalt(), 501, { value: E(100) })).to.be.revertedWith("tax too high");
  });

  it("native and token claims pay out and nothing is created or lost", async function () {
    const r = await L1(0);
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    await trader.buy(r.key, E(2000));
    const held = await token.balanceOf(await trader.getAddress());
    await trader.sell(r.key, held / 3n);
    await launcher.harvest(r.token);

    const owedNative = await launcher.claimable(creator.address, ethers.ZeroAddress);
    const owedToken = await launcher.claimable(creator.address, r.token);
    expect(owedNative).to.be.gt(0n);
    expect(owedToken).to.be.gt(0n);
    await launcher.connect(creator).claim(ethers.ZeroAddress);
    await launcher.connect(creator).claim(r.token);
    expect(await token.balanceOf(creator.address)).to.equal(owedToken);

    // contract's native balance covers every claim and reserve
    const total =
      (await launcher.claimable(platform.address, ethers.ZeroAddress)) +
      (await launcher.claimable(creator.address, ethers.ZeroAddress)) +
      (await launcher.monshiReserve()) +
      (await launcher.tokenReserve(r.token));
    expect(await ethers.provider.getBalance(await launcher.getAddress())).to.be.gte(total);
  });

  it("token buyback is refused when spot is far from the reference, then works once the reference has caught up", async function () {
    const r = await L1(0);
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    await trader.buy(r.key, E(8000)); // moves price well away from the launch-time reference
    const held = await token.balanceOf(await trader.getAddress());
    await trader.sell(r.key, held / 20n);
    await launcher.harvest(r.token);
    const reserve = await launcher.tokenReserve(r.token);
    expect(reserve).to.be.gte(E(1));

    await expect(launcher.buybackToken(r.token, reserve)).to.be.revertedWith("spot far from reference");

    await time.increase(700);
    await trader.buy(r.key, E(1)); // a small swap re-samples the reference at the current price
    const deadBefore = await token.balanceOf(DEAD);
    await launcher.buybackToken(r.token, reserve);
    expect((await token.balanceOf(DEAD)) - deadBefore).to.be.gt(0n);
    expect(await launcher.tokenReserve(r.token)).to.be.lt(reserve);
    await expect(launcher.buybackToken(r.token, E(1))).to.be.revertedWith("cooldown");
  });

  it("buyback is refused right after a big price move (manipulation guard)", async function () {
    const r = await L1(0);
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    await trader.buy(r.key, E(1000));
    const held = await token.balanceOf(await trader.getAddress());
    await trader.sell(r.key, held / 5n);
    await launcher.harvest(r.token);
    await time.increase(700);
    await trader.buy(r.key, E(1)); // refresh reference
    await trader.buy(r.key, E(8000)); // big move right before the call
    await expect(launcher.buybackToken(r.token, E(1))).to.be.revertedWith("spot far from reference");
  });

  it("dev buy: creator gets tokens in the launch tx, capped at 5% of supply", async function () {
    const r = await L1(0, E(100) + E(500));
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const got = await token.balanceOf(creator.address);
    expect(got).to.equal(r.devBuyTokens);
    expect(got).to.be.gt(0n);
    expect(got).to.be.lte((SUPPLY * 500n) / 10000n);
    await expect(launcher.connect(creator).launch("Big", "BIG", nextSalt(), 0, { value: E(100) + E(40000) })).to.be.revertedWith("dev buy over cap");
  });

  it("MONSHI buyback: keeper-only, needs a configured pool, burns real tokens with a min-out (stand-in token)", async function () {
    // launcher #1 makes a token T1 that stands in for MONSHI; we seed a hookless native/T1 pool for the buyback
    const t1 = await L1(0);
    const T1 = new ethers.Contract(t1.token, erc20, ethers.provider);
    await trader.buy(t1.key, E(3000));
    const plain = { currency0: ethers.ZeroAddress, currency1: t1.token, fee: 10000, tickSpacing: 200, hooks: ethers.ZeroAddress };
    await trader.seed(plain, 80000, 78000, 82000, 10n ** 24n);

    const { launcher: l2, hook: h2 } = await setup(t1.token);
    await l2.connect(owner).setKeeper(keeper.address);
    await expect(l2.connect(keeper).buybackMonshi(E(1), 0)).to.be.revertedWith("no MONSHI pool");
    await l2.connect(owner).proposeMonshiPool(10000, 200);
    await expect(l2.connect(owner).executeMonshiPool()).to.be.revertedWith("too early");
    await time.increase(48 * 3600 + 5);
    await l2.connect(owner).executeMonshiPool();

    // make a MONSHI reserve on launcher #2
    const tx = await l2.connect(creator).launch("Other", "OTH", nextSalt(), 0, { value: E(100) });
    const rc = await tx.wait();
    const ev = rc.logs.map((x) => { try { return l2.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Launched");
    const key2 = keyOf(ev.args.token, await h2.getAddress());
    const T2 = new ethers.Contract(ev.args.token, erc20, ethers.provider);
    await trader.buy(key2, E(2000));
    await trader.sell(key2, (await T2.balanceOf(await trader.getAddress())) / 4n);
    await l2.harvest(ev.args.token);
    const reserve = await l2.monshiReserve();
    expect(reserve).to.be.gte(E(1));

    await expect(l2.connect(other).buybackMonshi(reserve, 0)).to.be.revertedWith("not keeper");
    const deadBefore = await T1.balanceOf(DEAD);
    await expect(l2.connect(keeper).buybackMonshi(reserve, ethers.MaxUint256 / 2n)).to.be.revertedWith("too little out");
    await l2.connect(keeper).buybackMonshi(reserve, 1n);
    expect((await T1.balanceOf(DEAD)) - deadBefore).to.be.gt(0n);
    expect(await l2.monshiReserve()).to.be.lt(reserve);
  });

  it("the real native-MON/MONSHI V4 pool exists but has no active liquidity, so a MONSHI buyback could not fill today", async function () {
    const plain = [ethers.ZeroAddress, MONSHI, 10000, 200, ethers.ZeroAddress];
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], plain));
    const [sqrtP] = await sv.getSlot0(id);
    expect(sqrtP).to.be.gt(0n); // the pool shell exists and is initialised
    expect(await sv.getLiquidity(id)).to.equal(0n); // but nothing is tradeable at its current price
    await launcher.connect(owner).proposeMonshiPool(10000, 200); // proposing it is allowed
  });

  it("the owner has no function that can remove liquidity or take user funds", async function () {
    const names = launcher.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["withdraw", "sweep", "rescue", "removeLiquidity", "decreaseLiquidity", "burn", "setCreatorBps", "setFeeBps", "recoverERC20", "setTax"]) {
      expect(names).to.not.include(bad);
    }
    await expect(launcher.connect(owner).renounceOwnership()).to.be.revertedWith("disabled");
    await expect(launcher.connect(other).setCreationFee(0)).to.be.reverted;
    await expect(launcher.connect(other).setKeeper(other.address)).to.be.reverted;
    // the unlock callback only answers the pool manager
    await expect(launcher.connect(other).unlockCallback("0x")).to.be.revertedWith("bad caller");
  });

  it("pausing launches does not stop harvest or claims; creator can hand over fee rights", async function () {
    const r = await L1(0);
    await trader.buy(r.key, E(500));
    await launcher.connect(owner).setLaunchPaused(true);
    await expect(launcher.connect(creator).launch("P", "P", nextSalt(), 0, { value: E(100) })).to.be.revertedWith("launches paused");
    await launcher.harvest(r.token);
    await launcher.connect(owner).setLaunchPaused(false);
    await expect(launcher.connect(other).setCreator(r.token, other.address)).to.be.revertedWith("not creator");
    await launcher.connect(creator).setCreator(r.token, other.address);
    expect((await launcher.launches(r.token)).creator).to.equal(other.address);
  });

  it("rejects bad names and a short creation fee", async function () {
    await expect(launcher.connect(creator).launch("", "X", nextSalt(), 0, { value: E(100) })).to.be.revertedWith("bad name");
    await expect(launcher.connect(creator).launch("N", "WAYTOOLONGSYMBOL", nextSalt(), 0, { value: E(100) })).to.be.revertedWith("bad symbol");
    await expect(launcher.connect(creator).launch("N", "S", nextSalt(), 0, { value: E(1) })).to.be.revertedWith("fee");
  });
});
