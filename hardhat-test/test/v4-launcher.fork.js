// MonpadLauncher V4 against a FORK of Monad mainnet (real Uniswap V3 factory + position manager).
// Run:  FORK_RPC=https://rpc.monad.xyz npx hardhat test test/v4-launcher.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { params } = require("../scripts/v4-params");

const NPM = "0x7197e214c0b767cfb76fb734ab638e2c192f4e53";
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const E = (n) => ethers.parseEther(String(n));
const SUPPLY = E(1_000_000_000);
const MAX_SQRT = 1461446703485210103287273052203988822378723970342n;
const MIN_SQRT = 4295128739n;

const erc20 = ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function totalSupply() view returns (uint256)"];
const wmonAbi = [...erc20, "function deposit() payable"];
const poolAbi = [
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
];
const npmAbi = [
  "function ownerOf(uint256) view returns (address)",
  "function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)",
];

(process.env.FORK_RPC ? describe : describe.skip)("MonpadLauncher V4 (fork of Monad mainnet)", function () {
  this.timeout(900000);
  const P = params(250000);
  let owner, platform, creator, other, launcher, trader, wmon;
  let salt = 0;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);

  async function deployLauncher(fee = E(100), monshi = MONSHI) {
    const F = await ethers.getContractFactory("MonpadLauncher");
    return F.deploy(owner.address, platform.address, NPM, monshi, P.startTick, P.sqrtAtStartTick, P.sqrtAtNegStartTick, fee, 10000);
  }

  async function doLaunch(value = E(100), who = creator) {
    const tx = await launcher.connect(who).launch("Test Coin", "TST", nextSalt(), { value });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return launcher.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Launched");
    const token = ev.args.token;
    const pool = new ethers.Contract(ev.args.pool, poolAbi, ethers.provider);
    const wmonIs0 = (await pool.token0()).toLowerCase() === WMON.toLowerCase();
    return { token, pool, poolAddr: ev.args.pool, positionId: ev.args.positionId, wmonIs0, devBuyTokens: ev.args.devBuyTokens, gas: rc.gasUsed };
  }

  // WMON -> token using the test trader (it holds WMON)
  async function buy(L, wmonAmount) {
    await wmon.connect(owner).deposit({ value: E(wmonAmount) });
    await wmon.connect(owner).transfer(await trader.getAddress(), E(wmonAmount));
    const limit = L.wmonIs0 ? MIN_SQRT + 1n : MAX_SQRT - 1n;
    await trader.swap(L.poolAddr, L.wmonIs0, E(wmonAmount), limit, await trader.getAddress());
  }
  // token -> WMON using the test trader's tokens
  async function sell(L, tokenAmount) {
    const limit = L.wmonIs0 ? MAX_SQRT - 1n : MIN_SQRT + 1n;
    await trader.swap(L.poolAddr, !L.wmonIs0, tokenAmount, limit, await trader.getAddress());
  }

  before(async function () {
    [owner, platform, creator, other] = await ethers.getSigners();
    wmon = new ethers.Contract(WMON, wmonAbi, ethers.provider);
    for (const a of [owner, creator, other]) await setBalance(a.address, E(10_000_000));
    launcher = await deployLauncher();
    trader = await (await ethers.getContractFactory("TestTrader")).deploy();
  });

  it("is wired to the official Uniswap V3 on Monad", async function () {
    expect((await launcher.wmon()).toLowerCase()).to.equal(WMON.toLowerCase());
    expect((await launcher.npm()).toLowerCase()).to.equal(NPM.toLowerCase());
    expect(await launcher.startTick()).to.equal(BigInt(P.startTick));
    expect(await launcher.monshiPool()).to.not.equal(ethers.ZeroAddress); // the real MONSHI/WMON 1% pool
  });

  it("launch: single-sided real pool, whole supply in an LP the launcher owns, nothing left over", async function () {
    const L = await doLaunch();
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    const npm = new ethers.Contract(NPM, npmAbi, ethers.provider);

    expect((await npm.ownerOf(L.positionId)).toLowerCase()).to.equal((await launcher.getAddress()).toLowerCase());
    expect(await token.balanceOf(await launcher.getAddress())).to.equal(0n);
    const inPool = await token.balanceOf(L.poolAddr);
    const dust = await token.balanceOf(DEAD);
    expect(inPool + dust).to.equal(SUPPLY);
    expect(dust).to.be.lt(SUPPLY / 1_000_000n);
    expect(await wmon.balanceOf(L.poolAddr)).to.equal(0n); // single-sided: no WMON in the pool yet

    const [, tick] = await L.pool.slot0();
    expect(tick).to.equal(L.wmonIs0 ? BigInt(-P.startTick) : BigInt(P.startTick));
    console.log("      launch gas:", L.gas.toString(), "| token is token", L.wmonIs0 ? "1" : "0");
  });

  it("creation fee is owed to the platform and can be claimed", async function () {
    const before = await launcher.claimable(platform.address, ethers.ZeroAddress);
    await doLaunch(E(100));
    expect(await launcher.claimable(platform.address, ethers.ZeroAddress)).to.equal(before + E(100));
    const balBefore = await ethers.provider.getBalance(platform.address);
    const tx = await launcher.connect(platform).claim(ethers.ZeroAddress);
    const rc = await tx.wait();
    const got = (await ethers.provider.getBalance(platform.address)) - balBefore + rc.gasUsed * rc.gasPrice;
    expect(got).to.be.gt(0n);
    expect(await launcher.claimable(platform.address, ethers.ZeroAddress)).to.equal(0n);
  });

  it("buys move the price up; harvest splits fees 70/10/10/10 and burns the token share", async function () {
    const L = await doLaunch();
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    const [, tickBefore] = await L.pool.slot0();

    await buy(L, 1000);
    const [, tickAfter] = await L.pool.slot0();
    // WMON-is-token0 pools quote token per WMON, so "price up" is a falling tick there
    expect(L.wmonIs0 ? tickAfter < tickBefore : tickAfter > tickBefore).to.equal(true);

    // sell some back so fees accrue in BOTH assets
    const held = await token.balanceOf(await trader.getAddress());
    await sell(L, held / 4n);

    const deadBefore = await token.balanceOf(DEAD);
    const tx = await launcher.harvest(L.token);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return launcher.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Harvested");
    const wmonFees = ev.args.wmonFees;
    const tokenFees = ev.args.tokenFees;
    expect(wmonFees).to.be.gt(0n);
    expect(tokenFees).to.be.gt(0n);

    // WMON side
    const cWmon = await launcher.claimable(creator.address, ethers.ZeroAddress);
    expect(cWmon).to.equal((wmonFees * 7000n) / 10000n);
    expect(await launcher.tokenReserve(L.token)).to.be.gt(0n);
    expect(await launcher.monshiReserve()).to.be.gte((wmonFees * 1000n) / 10000n);
    // token side: 70% creator, 10% platform, 20% burned
    expect(await launcher.claimable(creator.address, L.token)).to.equal((tokenFees * 7000n) / 10000n);
    expect(await launcher.claimable(platform.address, L.token)).to.equal((tokenFees * 1000n) / 10000n);
    const burned = (await token.balanceOf(DEAD)) - deadBefore;
    expect(burned).to.equal(tokenFees - (tokenFees * 7000n) / 10000n - (tokenFees * 1000n) / 10000n);

    // conservation: nothing created or lost
    const ownedWmon = await wmon.balanceOf(await launcher.getAddress());
    expect(ownedWmon).to.be.gte((await launcher.monshiReserve()) + (await launcher.tokenReserve(L.token)));
    console.log("      WMON fees:", ethers.formatEther(wmonFees), "| token fees:", ethers.formatEther(tokenFees));

    // creator can claim both assets
    await launcher.connect(creator).claim(ethers.ZeroAddress);
    await launcher.connect(creator).claim(L.token);
    expect(await token.balanceOf(creator.address)).to.equal((tokenFees * 7000n) / 10000n);
  });

  it("buyback: reverts with no oracle history, then burns the token once the TWAP has matured", async function () {
    const L = await doLaunch();
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    await buy(L, 1000);
    const held = await token.balanceOf(await trader.getAddress());
    await sell(L, held / 5n);
    await launcher.harvest(L.token);
    const reserve = await launcher.tokenReserve(L.token);
    expect(reserve).to.be.gte(E(1));

    await expect(launcher.buybackToken(L.token, reserve)).to.be.reverted; // fail closed: window not covered yet

    await time.increase(700);
    const deadBefore = await token.balanceOf(DEAD);
    await launcher.buybackToken(L.token, reserve);
    expect((await token.balanceOf(DEAD)) - deadBefore).to.be.gt(0n);
    expect(await launcher.tokenReserve(L.token)).to.be.lt(reserve);

    await expect(launcher.buybackToken(L.token, E(1))).to.be.revertedWith("cooldown");
  });

  it("buyback is refused when spot is far from the TWAP (manipulation guard)", async function () {
    const L = await doLaunch();
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    await buy(L, 1000);
    const held = await token.balanceOf(await trader.getAddress());
    await sell(L, held / 5n);
    await launcher.harvest(L.token);
    await time.increase(700);
    await buy(L, 8000); // big move right before the call
    await expect(launcher.buybackToken(L.token, E(1))).to.be.revertedWith("spot far from twap");
  });

  it("the real MONSHI/WMON pool has no liquidity today, so a MONSHI buyback is refused and spends nothing", async function () {
    const L = await doLaunch();
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    await buy(L, 2000);
    const held = await token.balanceOf(await trader.getAddress());
    await sell(L, held / 4n);
    await launcher.harvest(L.token);
    const reserve = await launcher.monshiReserve();
    expect(reserve).to.be.gte(E(1));
    await time.increase(700);
    await expect(launcher.buybackMonshi(reserve)).to.be.revertedWith("no fill");
    expect(await launcher.monshiReserve()).to.equal(reserve); // untouched
  });

  it("MONSHI buyback works when its pool has liquidity (a launched token stands in for MONSHI)", async function () {
    // launcher #1 makes a token with a real, liquid pool; launcher #2 treats that token as "MONSHI"
    const stand = await doLaunch();
    const standToken = new ethers.Contract(stand.token, erc20, ethers.provider);
    await buy(stand, 3000);
    const l2 = await deployLauncher(E(100), stand.token);
    expect(await l2.monshiPool()).to.equal(stand.poolAddr);

    const tx = await l2.connect(creator).launch("Other", "OTH", nextSalt(), { value: E(100) });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return l2.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Launched");
    const L = { token: ev.args.token, poolAddr: ev.args.pool, pool: new ethers.Contract(ev.args.pool, poolAbi, ethers.provider) };
    L.wmonIs0 = (await L.pool.token0()).toLowerCase() === WMON.toLowerCase();
    await buy(L, 2000);
    const held = await new ethers.Contract(L.token, erc20, ethers.provider).balanceOf(await trader.getAddress());
    await sell(L, held / 4n);
    await l2.harvest(L.token);
    const reserve = await l2.monshiReserve();
    expect(reserve).to.be.gte(E(1));

    await time.increase(700);
    const deadBefore = await standToken.balanceOf(DEAD);
    await l2.buybackMonshi(reserve);
    expect((await standToken.balanceOf(DEAD)) - deadBefore).to.be.gt(0n);
    expect(await l2.monshiReserve()).to.be.lt(reserve);
  });

  it("dev buy: creator gets tokens in the launch tx, capped at 5% of supply", async function () {
    const L = await doLaunch(E(100) + E(500));
    const token = new ethers.Contract(L.token, erc20, ethers.provider);
    const got = await token.balanceOf(creator.address);
    expect(got).to.equal(L.devBuyTokens);
    expect(got).to.be.gt(0n);
    expect(got).to.be.lte((SUPPLY * 500n) / 10000n);

    await expect(launcher.connect(creator).launch("Big", "BIG", nextSalt(), { value: E(100) + E(40000) })).to.be.revertedWith("dev buy over cap");
  });

  it("a pre-initialised pool at the wrong price makes the launch revert (funds stay safe)", async function () {
    const s = nextSalt();
    const predicted = await launcher.predictToken(creator.address, s, "Evil", "EVL");
    const npm = new ethers.Contract(NPM, npmAbi, other);
    const [t0, t1] = predicted.toLowerCase() < WMON.toLowerCase() ? [predicted, WMON] : [WMON, predicted];
    await npm.createAndInitializePoolIfNecessary(t0, t1, 10000, 79228162514264337593543950336n); // price 1.0
    const before = await ethers.provider.getBalance(creator.address);
    await expect(launcher.connect(creator).launch("Evil", "EVL", s, { value: E(100) })).to.be.revertedWith("pool pre-initialised");
    expect(before - (await ethers.provider.getBalance(creator.address))).to.be.lt(E(1)); // only gas lost
  });

  it("the owner has no function that can remove liquidity or take user funds", async function () {
    const names = launcher.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const bad of ["withdraw", "sweep", "rescue", "decreaseLiquidity", "burn", "transferPosition", "setCreatorBps", "setFeeBps", "recoverERC20"]) {
      expect(names).to.not.include(bad);
    }
    await expect(launcher.connect(owner).renounceOwnership()).to.be.revertedWith("disabled");
    await expect(launcher.connect(other).setCreationFee(0)).to.be.reverted;
  });

  it("pausing launches does not stop harvest, claims or buybacks; creator can hand over fee rights", async function () {
    const L = await doLaunch();
    await buy(L, 500);
    await launcher.connect(owner).setLaunchPaused(true);
    await expect(launcher.connect(creator).launch("P", "P", nextSalt(), { value: E(100) })).to.be.revertedWith("launches paused");
    await launcher.harvest(L.token); // still works
    await launcher.connect(owner).setLaunchPaused(false);

    await expect(launcher.connect(other).setCreator(L.token, other.address)).to.be.revertedWith("not creator");
    await launcher.connect(creator).setCreator(L.token, other.address);
    expect((await launcher.launches(L.token)).creator).to.equal(other.address);
  });

  it("rejects bad names, short fee, and an invalid MONSHI pool proposal", async function () {
    await expect(launcher.connect(creator).launch("", "X", nextSalt(), { value: E(100) })).to.be.revertedWith("bad name");
    await expect(launcher.connect(creator).launch("N", "WAYTOOLONGSYMBOL", nextSalt(), { value: E(100) })).to.be.revertedWith("bad symbol");
    await expect(launcher.connect(creator).launch("N", "S", nextSalt(), { value: E(1) })).to.be.revertedWith("fee");
    await expect(launcher.connect(owner).proposeMonshiPool(100)).to.be.revertedWith("no such pool");
  });
});
