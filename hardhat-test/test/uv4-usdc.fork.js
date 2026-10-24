// USDC-quoted Monpad V4 launcher + router on a Monad fork.
// Run: FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-usdc.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, setBalance, time } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTickUsdc } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");
const {
  routes,
  POOL_MANAGER,
  STATE_VIEW,
  monUsdcPoolKey,
  assertMonUsdcConfigMatchesChain,
  fundUsdcViaMonSwap,
  seedUsdcMonshiPool,
  ensureTraderUsdc,
} = require("./helpers/fork-routes");

const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const USDC = routes.quoteToken;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const DYNAMIC = 0x800000;
const U = (n) => BigInt(n) * 10n ** 6n;
const E = (n) => ethers.parseEther(String(n));
const SUPPLY = E(1_000_000_000);
const BPS = 10_000n;

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];

(process.env.FORK_RPC ? describe : describe.skip)("Monpad UV4 USDC quote (fork)", function () {
  this.timeout(900000);
  const START_TICK = uv4StartTickUsdc(250000);
  let owner, platform, creator, keeper, launcher, hook, router, trader, sv;
  let salt = 0;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);
  async function deadline(offsetSec = 3600) {
    const { timestamp } = await ethers.provider.getBlock("latest");
    return timestamp + offsetSec;
  }

  function sortedKey(token) {
    const quoteIs0 = USDC.toLowerCase() < token.toLowerCase();
    return {
      quoteIs0,
      key: {
        currency0: quoteIs0 ? USDC : token,
        currency1: quoteIs0 ? token : USDC,
        fee: DYNAMIC,
        tickSpacing: 200,
        hooks: hook.target,
      },
    };
  }

  async function ensureUsdc(account, amount) {
    const hre = require("hardhat");
    const usdc = new ethers.Contract(USDC, erc20, ethers.provider);
    if ((await usdc.balanceOf(account)) >= amount) return;
    let monAmount = E(10_000);
    for (let i = 0; i < 8; i++) {
      await setBalance(trader.target, E(3_000_000));
      await fundUsdcViaMonSwap(hre, { trader, recipient: account, monAmount });
      if ((await usdc.balanceOf(account)) >= amount) return;
      monAmount *= 2n;
    }
    expect(await usdc.balanceOf(account)).to.be.gte(amount);
  }

  async function launch(tax = 0, devUsdc = 0n) {
    const usdc = new ethers.Contract(USDC, erc20, creator);
    const fee = await launcher.creationFee();
    const total = fee + devUsdc;
    await ensureUsdc(creator.address, total);
    await usdc.connect(creator).approve(launcher.target, total);
    const tx = await launcher.connect(creator).launch("Test", "TST", nextSalt(), tax, devUsdc);
    const rc = await tx.wait();
    const ev = rc.logs
      .map((x) => {
        try {
          return launcher.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "Launched");
    return { token: ev.args.token, poolId: ev.args.poolId, gas: rc.gasUsed, ...sortedKey(ev.args.token) };
  }

  before(async function () {
    await mine(1);
    [owner, platform, creator, keeper] = await ethers.getSigners();
    for (const a of [owner, creator, keeper]) await setBalance(a.address, E(10_000_000));
    sv = new ethers.Contract(STATE_VIEW, [
      "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
      "function getLiquidity(bytes32) view returns (uint128)",
    ], ethers.provider);
    await assertMonUsdcConfigMatchesChain(ethers, sv);
    ({ launcher, hook } = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: USDC,
      monshi: MONSHI,
      startTick: START_TICK,
      creationFee: U(100),
    }));
    await launcher.connect(owner).setKeeper(keeper.address);
    trader = await (await ethers.getContractFactory("TestV4Trader")).deploy(POOL_MANAGER);
    await setBalance(trader.target, E(5_000_000));
    const monKey = monUsdcPoolKey(ethers);
    router = await (
      await ethers.getContractFactory("MonpadV4Router")
    ).deploy(POOL_MANAGER, launcher.target, hook.target, USDC, USDC, monKey);
  });

  it("launch gas + USDC pool sort", async function () {
    const r = await launch(0, 0n);
    expect(r.key.currency0 === USDC || r.key.currency1 === USDC).to.equal(true);
    console.log("      launch gas:", r.gas.toString());
  });

  it("buy with USDC via router", async function () {
    const r = await launch(0, 0n);
    await ensureUsdc(creator.address, U(10_000));
    const usdc = new ethers.Contract(USDC, erc20, creator);
    await usdc.approve(router.target, U(5000));
    const tx = await router.connect(creator).buyWithUsdc(r.key, U(1000), 1n, await deadline(), 0);
    const rc = await tx.wait();
    console.log("      buyWithUsdc gas:", rc.gasUsed.toString());
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    expect(await token.balanceOf(creator.address)).to.be.gt(0n);
  });

  it("buy with MON via router (two-hop)", async function () {
    const r = await launch(0, 0n);
    const tx = await router.connect(creator).buyWithMon(r.key, 1n, 1n, await deadline(), 0, 0, { value: E(50) });
    const rc = await tx.wait();
    console.log("      buyWithMon gas:", rc.gasUsed.toString());
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    expect(await token.balanceOf(creator.address)).to.be.gt(0n);
  });

  it("fee split conserves quoteFees and tokenFees (full accounting)", async function () {
    const r = await launch(500, 0n);
    await setBalance(trader.target, E(500_000));
    await trader.swapMonForUsdc(monUsdcPoolKey(ethers), E(120_000));
    await trader.buyWithQuote(r.key, r.quoteIs0, U(2_000));
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const held = await token.balanceOf(trader.target);
    await trader.sellToQuote(r.key, r.quoteIs0, held / 3n);

    const deadBefore = await token.balanceOf(DEAD);
    const cUsdc0 = await launcher.claimable(creator.address, USDC);
    const pUsdc0 = await launcher.claimable(platform.address, USDC);
    const cTok0 = await launcher.claimable(creator.address, r.token);
    const pTok0 = await launcher.claimable(platform.address, r.token);
    const m0 = await launcher.monshiReserve();
    const tr0 = await launcher.tokenReserve(r.token);

    const htx = await launcher.harvest(r.token);
    const hrc = await htx.wait();
    const ev = hrc.logs
      .map((x) => {
        try {
          return launcher.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "Harvested");
    const quoteFees = ev.args[1];
    const tokenFees = ev.args[2];

    const cUsdc = (await launcher.claimable(creator.address, USDC)) - cUsdc0;
    const pUsdc = (await launcher.claimable(platform.address, USDC)) - pUsdc0;
    const m = (await launcher.monshiReserve()) - m0;
    const tr = (await launcher.tokenReserve(r.token)) - tr0;
    expect(cUsdc + pUsdc + m + tr).to.equal(quoteFees);

    const cTok = (await launcher.claimable(creator.address, r.token)) - cTok0;
    const pTok = (await launcher.claimable(platform.address, r.token)) - pTok0;
    const burned = (await token.balanceOf(DEAD)) - deadBefore;
    expect(cTok + pTok + burned).to.equal(tokenFees);

    const total = BigInt(500) + 100n;
    const extraQ = (quoteFees * 500n) / total;
    const baseQ = quoteFees - extraQ;
    const expCreator = (baseQ * 7000n) / BPS;
    const expPlatform = (baseQ * 1000n) / BPS;
    const expMonshi = (baseQ * 1000n) / BPS;
    expect(cUsdc).to.equal(expCreator);
    expect(pUsdc).to.equal(expPlatform);
    expect(m).to.equal(expMonshi);
    expect(tr).to.equal(baseQ - expCreator - expPlatform - expMonshi + extraQ);
  });

  it("harvest accrues monshiReserve when USDC/MONSHI pool unset (funds not stuck)", async function () {
    const r = await launch(500, 0n);
    await setBalance(trader.target, E(500_000));
    await trader.swapMonForUsdc(monUsdcPoolKey(ethers), E(120_000));
    await trader.buyWithQuote(r.key, r.quoteIs0, U(2_000));
    const before = await launcher.monshiReserve();
    await launcher.harvest(r.token);
    const after = await launcher.monshiReserve();
    expect(after).to.be.gt(before);
    await expect(launcher.connect(keeper).buybackMonshi(after, 0)).to.be.revertedWithCustomError(
      launcher,
      "MonshiPoolNotConfigured",
    );
  });

  it("MONSHI buyback reverts when USDC/MONSHI pool not configured", async function () {
    const fresh = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: USDC,
      monshi: MONSHI,
      startTick: START_TICK,
      creationFee: U(100),
    });
    await fresh.launcher.connect(owner).setKeeper(keeper.address);
    await expect(fresh.launcher.connect(keeper).buybackMonshi(U(1), 0)).to.be.revertedWithCustomError(
      fresh.launcher,
      "MonshiPoolNotConfigured",
    );
  });

  it("MONSHI buyback succeeds after USDC/MONSHI pool is configured (seeded on fork)", async function () {
    const monshiStandIn = await (await ethers.getContractFactory("MockBlockableUsdc")).deploy();
    const { launcher: l2, hook: h2 } = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: USDC,
      monshi: await monshiStandIn.getAddress(),
      startTick: START_TICK,
      creationFee: U(100),
    });
    await l2.connect(owner).setKeeper(keeper.address);
    await ensureUsdc(creator.address, U(200));
    const usdc = new ethers.Contract(USDC, erc20, creator);
    await usdc.approve(l2.target, U(200));
    const ltx = await l2.connect(creator).launch("M2", "M2", nextSalt(), 0, 0n);
    const lrc = await ltx.wait();
    const lev = lrc.logs
      .map((x) => {
        try {
          return l2.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "Launched");
    const token = lev.args.token;
    const quoteIs0 = USDC.toLowerCase() < token.toLowerCase();
    const key = {
      currency0: quoteIs0 ? USDC : token,
      currency1: quoteIs0 ? token : USDC,
      fee: DYNAMIC,
      tickSpacing: 200,
      hooks: h2.target,
    };
    await setBalance(trader.target, E(500_000));
    await trader.swapMonForUsdc(monUsdcPoolKey(ethers), E(120_000));
    await trader.buyWithQuote(key, quoteIs0, U(2_000));
    await l2.harvest(token);
    const reserve = await l2.monshiReserve();
    expect(reserve).to.be.gte(U(1));

    const monshiAddr = await monshiStandIn.getAddress();
    const [deployer] = await ethers.getSigners();
    await monshiStandIn.connect(deployer).transfer(trader.target, U(50_000_000));
    await ensureTraderUsdc(require("hardhat"), trader, U(50_000));
    const monshiKey = await seedUsdcMonshiPool(trader, monshiAddr);
    await l2.connect(owner).proposeMonshiPool(monshiKey.fee, monshiKey.tickSpacing);
    await time.increase(48 * 3600 + 10);
    await l2.connect(owner).executeMonshiPool();

    await expect(l2.connect(keeper).buybackMonshi(reserve, 1n)).to.not.be.reverted;
  });

  it("rejects wrong hook and unlisted token", async function () {
    const r = await launch(0, 0n);
    const bad = { ...r.key, hooks: ethers.ZeroAddress };
    const dl = await deadline();
    await expect(router.connect(creator).buyWithUsdc(bad, U(1), 1n, dl, 0)).to.be.revertedWithCustomError(router, "BadKey");
    const fake = { ...r.key, currency1: creator.address, currency0: USDC };
    await expect(router.connect(creator).buyWithUsdc(fake, U(1), 1n, dl, 0)).to.be.revertedWithCustomError(router, "UnknownToken");
  });

  it("tight minOut reverts", async function () {
    const r = await launch(0, 0n);
    await ensureUsdc(creator.address, U(500));
    await new ethers.Contract(USDC, erc20, creator).approve(router.target, U(500));
    await expect(
      router.connect(creator).buyWithUsdc(r.key, U(10), ethers.MaxUint256 / 2n, await deadline(), 0),
    ).to.be.revertedWithCustomError(router, "Slippage");
  });
});
