// Adversarial checks for the USDC-quoted V4 launcher, hook and router (fork of Monad mainnet).
// Run: FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-audit.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, setBalance, time } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTickUsdc } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");
const { routes, POOL_MANAGER, STATE_VIEW, monUsdcPoolKey, fundUsdcViaMonSwap } = require("./helpers/fork-routes");

const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const USDC = routes.quoteToken;
const DYNAMIC = 0x800000;
const U = (n) => BigInt(n) * 10n ** 6n;
const E = (n) => ethers.parseEther(String(n));
const erc20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];
const pmAbi = ["function initialize((address,address,uint24,int24,address) key, uint160 sqrtPriceX96) returns (int24)"];

(process.env.FORK_RPC ? describe : describe.skip)("Monpad UV4 audit checks (fork)", function () {
  this.timeout(900000);
  let owner, platform, creator, attacker, launcher, hook, router, trader;
  let salt = 100;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);
  const dl = async () => (await ethers.provider.getBlock("latest")).timestamp + 3600;
  const sorted = (token) => {
    const q0 = USDC.toLowerCase() < token.toLowerCase();
    return { quoteIs0: q0, key: { currency0: q0 ? USDC : token, currency1: q0 ? token : USDC, fee: DYNAMIC, tickSpacing: 200, hooks: hook.target } };
  };
  async function ensureUsdc(acct, amount) {
    const usdc = new ethers.Contract(USDC, erc20, ethers.provider);
    let mon = E(10_000);
    for (let i = 0; i < 8 && (await usdc.balanceOf(acct)) < amount; i++) {
      await setBalance(trader.target, E(3_000_000));
      await fundUsdcViaMonSwap(require("hardhat"), { trader, recipient: acct, monAmount: mon });
      mon *= 2n;
    }
  }
  async function launch(tax = 0, dev = 0n, who = creator) {
    const total = (await launcher.creationFee()) + dev;
    await ensureUsdc(who.address, total);
    await new ethers.Contract(USDC, erc20, who).approve(launcher.target, total);
    const rc = await (await launcher.connect(who).launch("Aud", "AUD", nextSalt(), tax, dev)).wait();
    const ev = rc.logs.map((x) => { try { return launcher.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Launched");
    return { token: ev.args.token, ...sorted(ev.args.token) };
  }

  before(async function () {
    await mine(1);
    [owner, platform, creator, attacker] = await ethers.getSigners();
    for (const a of [owner, creator, attacker]) await setBalance(a.address, E(10_000_000));
    ({ launcher, hook } = await deployHookAndLauncher(owner, { poolManager: POOL_MANAGER, owner: owner.address, platform: platform.address, quoteAsset: USDC, monshi: MONSHI, startTick: uv4StartTickUsdc(250000), creationFee: U(100) }));
    trader = await (await ethers.getContractFactory("TestV4Trader")).deploy(POOL_MANAGER);
    router = await (await ethers.getContractFactory("MonpadV4Router")).deploy(POOL_MANAGER, launcher.target, hook.target, USDC, USDC, monUsdcPoolKey(ethers));
  });

  it("A1: USDC and tokens sitting in the router cannot be taken by a later caller", async function () {
    const r = await launch(0, 0n);
    await ensureUsdc(attacker.address, U(6000));
    const usdc = new ethers.Contract(USDC, erc20, attacker);
    await usdc.transfer(router.target, U(3000)); // stray funds
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const before = await usdc.balanceOf(attacker.address);
    await usdc.approve(router.target, U(10));
    await router.connect(attacker).buyWithUsdc(r.key, U(10), 1n, await dl(), 0);
    // attacker paid 10 USDC; their USDC must have dropped by about 10 (never gained the 3000)
    const after = await usdc.balanceOf(attacker.address);
    expect(before - after).to.be.gte(U(9));
    expect(await usdc.balanceOf(router.target)).to.be.gte(U(3000));
    const got = await token.balanceOf(attacker.address);
    await new ethers.Contract(r.token, erc20, attacker).approve(router.target, got);
    const b2 = await usdc.balanceOf(attacker.address);
    await router.connect(attacker).sellToUsdc(r.key, got, 1n, await dl(), 0);
    expect((await usdc.balanceOf(attacker.address)) - b2).to.be.lte(U(10)); // at most what they put in
    expect(await usdc.balanceOf(router.target)).to.be.gte(U(3000));
  });

  it("A2: nobody but the launcher can initialize a pool on the hook, or configure a fee", async function () {
    const r = await launch(0, 0n);
    const fake = { currency0: USDC, currency1: ethers.Wallet.createRandom().address, fee: DYNAMIC, tickSpacing: 200, hooks: hook.target };
    const [c0, c1] = BigInt(fake.currency0) < BigInt(fake.currency1) ? [fake.currency0, fake.currency1] : [fake.currency1, fake.currency0];
    const pm = new ethers.Contract(POOL_MANAGER, pmAbi, attacker);
    await expect(pm.initialize([c0, c1, DYNAMIC, 200, hook.target], 79228162514264337593543950336n)).to.be.reverted;
    await expect(hook.connect(attacker).configure(r.key, 100)).to.be.reverted;
    await expect(hook.connect(attacker).beforeSwap(attacker.address, r.key, { zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 1 }, "0x")).to.be.reverted;
  });

  it("A3: swaps that skip the router still pay the full fee (hook enforces it)", async function () {
    const r = await launch(500, 0n); // 1% + 5% = 6%
    await setBalance(trader.target, E(500_000));
    await trader.swapMonForUsdc(monUsdcPoolKey(ethers), E(120_000));
    await trader.buyWithQuote(r.key, r.quoteIs0, U(1000));
    const rc = await (await launcher.harvest(r.token)).wait();
    const ev = rc.logs.map((x) => { try { return launcher.interface.parseLog(x); } catch { return null; } }).find((e) => e && e.name === "Harvested");
    const fee = ev.args[1];
    console.log("      quote fee harvested on a 1000 USDC buy (6% pool):", fee.toString());
    expect(fee).to.be.gte(U(59)).and.lte(U(61));
  });

  it("A4: harvest with no fees does not revert", async function () {
    const r = await launch(0, 0n);
    await launcher.harvest(r.token);
  });

  it("A5: dev buy over 5% of supply reverts", async function () {
    await ensureUsdc(creator.address, U(60_000));
    await new ethers.Contract(USDC, erc20, creator).approve(launcher.target, U(60_000));
    await expect(launcher.connect(creator).launch("Big", "BIG", nextSalt(), 0, U(20_000))).to.be.revertedWith("dev buy over cap");
  });

  it("A6: buyback guard blocks a manipulated spot, and the reference re-anchors after 10 minutes", async function () {
    const r = await launch(500, 0n);
    const bslot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [trader.target, 9]));
    await ethers.provider.send("hardhat_setStorageAt", [USDC, bslot, ethers.toBeHex(U(500_000), 32)]); // test funding only
    await trader.buyWithQuote(r.key, r.quoteIs0, U(2000)); // first swap samples ref
    await launcher.harvest(r.token);
    expect(await launcher.tokenReserve(r.token)).to.be.gt(0n);
    await trader.buyWithQuote(r.key, r.quoteIs0, U(60_000)); // push spot well past 3% of ref
    await time.increase(11 * 60);
    await expect(launcher.buybackToken(r.token, U(1_000_000))).to.be.revertedWith("spot far from reference");
    await trader.buyWithQuote(r.key, r.quoteIs0, U(10)); // after 10 min a swap re-samples ref at the moved price
    await launcher.harvest(r.token);
    await time.increase(11 * 60);
    console.log("      after re-anchor the buyback is allowed again:");
    await launcher.buybackToken(r.token, U(1_000_000));
  });

  it("A7: creator tax cap and fee ceiling", async function () {
    await expect(launcher.connect(creator).launch("T", "T", nextSalt(), 501, 0)).to.be.revertedWith("tax too high");
    await expect(launcher.connect(owner).setCreationFee(U(10_001))).to.be.revertedWith("fee too high");
    await expect(launcher.connect(owner).renounceOwnership()).to.be.revertedWith("disabled");
  });
});
