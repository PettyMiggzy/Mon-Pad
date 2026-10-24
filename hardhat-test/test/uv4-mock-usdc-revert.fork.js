// Router atomicity when USDC transfer to PoolManager is blocked mid-swap (mock quote asset on fork).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTickUsdc } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");
const { routes, POOL_MANAGER, monUsdcPoolKey } = require("./helpers/fork-routes");
const USDC = routes.quoteToken;

const DYNAMIC = 0x800000;
const U = (n) => BigInt(n) * 10n ** 6n;
const E = (n) => ethers.parseEther(String(n));

(process.env.FORK_RPC ? describe : describe.skip)("Monpad router — blocked USDC mid-swap (fork + mock quote)", function () {
  this.timeout(600000);

  it("buyWithUsdc reverts atomically: full USDC refund, no stuck router balance", async function () {
    await mine(1);
    const [owner, platform, creator] = await ethers.getSigners();
    await setBalance(creator.address, E(10_000));

    const mock = await (await ethers.getContractFactory("MockBlockableUsdc")).deploy();
    const quote = await mock.getAddress();
    await mock.transfer(creator.address, U(1_000_000));

    const START_TICK = uv4StartTickUsdc(250000);
    const { launcher, hook } = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: quote,
      monshi: quote,
      startTick: START_TICK,
      creationFee: U(100),
      monUsdcKey: { currency0: ethers.ZeroAddress, currency1: quote, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress }, // unused here; the launcher only checks its shape
    });

    const monKey = monUsdcPoolKey(ethers);
    const router = await (
      await ethers.getContractFactory("MonpadV4Router")
    ).deploy(POOL_MANAGER, launcher.target, hook.target, quote, USDC, monKey);

    const salt = ethers.zeroPadValue("0x01", 32);
    await mock.connect(creator).approve(launcher.target, U(100));
    await launcher.connect(creator).launch("M", "M", salt, 0, 0n);
    const token = await launcher.allTokens(0n);
    const quoteIs0 = quote.toLowerCase() < token.toLowerCase();
    const key = {
      currency0: quoteIs0 ? quote : token,
      currency1: quoteIs0 ? token : quote,
      fee: DYNAMIC,
      tickSpacing: 200,
      hooks: hook.target,
    };

    await mock.configureBlock(POOL_MANAGER, true);
    await mock.connect(creator).approve(router.target, U(500));
    const before = await mock.balanceOf(creator.address);
    const dl = Math.floor(Date.now() / 1000) + 600;
    await expect(router.connect(creator).buyWithUsdc(key, U(100), 1n, dl, 0)).to.be.reverted;
    expect(await mock.balanceOf(creator.address)).to.equal(before);
    expect(await mock.balanceOf(router.target)).to.equal(0n);
  });
});
