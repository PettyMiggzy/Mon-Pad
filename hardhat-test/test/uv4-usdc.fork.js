// USDC-quoted Monpad V4 launcher + router on a Monad fork.
// Run: FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-usdc.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTickUsdc } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");
const { routes, monUsdcPoolKey, fundUsdc } = require("./helpers/fork-routes");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const STATE_VIEW = "0x77395f3b2e73ae90843717371294fa97cc419d64";
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const USDC = routes.quoteToken;
const DYNAMIC = 0x800000;
const U = (n) => BigInt(n) * 10n ** 6n;
const E = (n) => ethers.parseEther(String(n));
const SUPPLY = E(1_000_000_000);

const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

(process.env.FORK_RPC ? describe : describe.skip)("Monpad UV4 USDC quote (fork)", function () {
  this.timeout(900000);
  const START_TICK = uv4StartTickUsdc(250000);
  let owner, platform, creator, launcher, hook, router, trader, sv;
  let salt = 0;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);

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

  async function launch(tax = 0, devUsdc = 0n) {
    const usdc = new ethers.Contract(USDC, erc20, creator);
    const fee = await launcher.creationFee();
    const total = fee + devUsdc;
    await fundUsdc(require("hardhat"), creator.address, total * 2n);
    await usdc.approve(launcher.target, total);
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
    [owner, platform, creator] = await ethers.getSigners();
    for (const a of [owner, creator]) await setBalance(a.address, E(10_000_000));
    ({ launcher, hook } = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: USDC,
      monshi: MONSHI,
      startTick: START_TICK,
      creationFee: U(100),
    }));
    trader = await (await ethers.getContractFactory("TestV4Trader")).deploy(POOL_MANAGER);
    await setBalance(trader.target, E(5_000_000));
    const monKey = monUsdcPoolKey(ethers);
    router = await (
      await ethers.getContractFactory("MonpadV4Router")
    ).deploy(POOL_MANAGER, launcher.target, hook.target, USDC, monKey);
    sv = new ethers.Contract(STATE_VIEW, ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"], ethers.provider);
    await fundUsdc(require("hardhat"), creator.address, U(500_000));
    await fundUsdc(require("hardhat"), trader.target, U(500_000));
    const usdcT = new ethers.Contract(USDC, erc20, creator);
    await usdcT.approve(trader.target, ethers.MaxUint256);
    // Seed MON/USDC if empty
    const monId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [monKey.currency0, monKey.currency1, monKey.fee, monKey.tickSpacing, monKey.hooks],
      ),
    );
    const [sqrtP] = await sv.getSlot0(monId);
    if (sqrtP === 0n) {
      await trader.seed(monKey, 0, -600, 600, 10n ** 22n);
    }
  });

  it("launch gas + USDC pool sort", async function () {
    const r = await launch(0, 0n);
    expect(r.key.currency0 === USDC || r.key.currency1 === USDC).to.equal(true);
    console.log("      launch gas:", r.gas.toString());
  });

  it("buy with USDC via router", async function () {
    const r = await launch(0, 0n);
    const usdc = new ethers.Contract(USDC, erc20, creator);
    await fundUsdc(require("hardhat"), creator.address, U(50_000));
    await usdc.approve(router.target, U(5000));
    const dl = Math.floor(Date.now() / 1000) + 600;
    const tx = await router.connect(creator).buyWithUsdc(r.key, U(1000), 1n, dl, 0);
    const rc = await tx.wait();
    console.log("      buyWithUsdc gas:", rc.gasUsed.toString());
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    expect(await token.balanceOf(creator.address)).to.be.gt(0n);
  });

  it("buy with MON via router (two-hop)", async function () {
    const r = await launch(0, 0n);
    const dl = Math.floor(Date.now() / 1000) + 600;
    const tx = await router.connect(creator).buyWithMon(r.key, 1n, 1n, dl, 0, 0, { value: E(50) });
    const rc = await tx.wait();
    console.log("      buyWithMon gas:", rc.gasUsed.toString());
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    expect(await token.balanceOf(creator.address)).to.be.gt(0n);
  });

  it("sell to USDC and fee split on harvest", async function () {
    const r = await launch(0, 0n);
    await fundUsdc(require("hardhat"), trader.target, U(200_000));
    const usdc = new ethers.Contract(USDC, erc20, ethers.provider);
    expect(await usdc.balanceOf(trader.target)).to.be.gte(U(5000));
    await trader.buyWithQuote(r.key, r.quoteIs0, U(5000));
    const token = new ethers.Contract(r.token, erc20, ethers.provider);
    const held = await token.balanceOf(trader.target);
    expect(held).to.be.gt(0n);
    await trader.sellToQuote(r.key, r.quoteIs0, held / 4n);
    const cBefore = await launcher.claimable(creator.address, USDC);
    await launcher.harvest(r.token);
    const quoteFees = (await launcher.claimable(creator.address, USDC)) - cBefore;
    expect(quoteFees).to.be.gt(0n);
  });

  it("rejects wrong hook and unlisted token", async function () {
    const r = await launch(0, 0n);
    const bad = { ...r.key, hooks: ethers.ZeroAddress };
    const dl = Math.floor(Date.now() / 1000) + 600;
    await expect(router.connect(creator).buyWithUsdc(bad, U(1), 1n, dl, 0)).to.be.revertedWithCustomError(router, "BadKey");
    const fake = { ...r.key, currency1: creator.address, currency0: USDC };
    await expect(router.connect(creator).buyWithUsdc(fake, U(1), 1n, dl, 0)).to.be.revertedWithCustomError(router, "UnknownToken");
  });

  it("tight minOut reverts", async function () {
    const r = await launch(0, 0n);
    const dl = Math.floor(Date.now() / 1000) + 600;
    await expect(
      router.connect(creator).buyWithUsdc(r.key, U(10), ethers.MaxUint256 / 2n, dl, 0),
    ).to.be.revertedWithCustomError(router, "Slippage");
  });

  it("documents USDC transfer failure modes (paused / blacklist)", async function () {
    // On Monad fork, USDC transfers revert with standard ERC20 errors when balance/allowance insufficient.
    // If the token implements pause/blacklist, expect: "Pausable: paused" or "Blacklisted" — verify on-chain when exposed.
    const usdc = new ethers.Contract(USDC, erc20, creator);
    await expect(usdc.transfer(ethers.ZeroAddress, 1n)).to.be.reverted;
  });
});
