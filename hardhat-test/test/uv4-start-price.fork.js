// Regression: a launch must start at the intended USDC market cap in BOTH currency orderings.
// Run: FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-start-price.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTickUsdc } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");
const { routes, POOL_MANAGER, STATE_VIEW } = require("./helpers/fork-routes");

const USDC = routes.quoteToken;
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const U = (n) => BigInt(n) * 10n ** 6n;
const TARGET_MCAP = 250000;

(process.env.FORK_RPC ? describe : describe.skip)("Monpad UV4 start price (fork)", function () {
  this.timeout(600000);
  it("starts at the intended market cap whether the token sorts above or below USDC", async function () {
    await mine(1);
    const [owner, platform, creator] = await ethers.getSigners();
    await setBalance(creator.address, ethers.parseEther("1000"));
    const { launcher } = await deployHookAndLauncher(owner, {
      poolManager: POOL_MANAGER,
      owner: owner.address,
      platform: platform.address,
      quoteAsset: USDC,
      monshi: MONSHI,
      startTick: uv4StartTickUsdc(TARGET_MCAP),
      creationFee: U(100),
    });
    // test-only funding: FiatToken v2 keeps balances in slot 9
    const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [creator.address, 9]));
    await ethers.provider.send("hardhat_setStorageAt", [USDC, slot, ethers.toBeHex(U(1_000_000), 32)]);
    await new ethers.Contract(USDC, ["function approve(address,uint256)"], creator).approve(launcher.target, U(1_000_000));
    const sv = new ethers.Contract(STATE_VIEW, ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"], ethers.provider);

    const seen = new Set();
    for (let i = 1; i <= 40 && seen.size < 2; i++) {
      await (await launcher.connect(creator).launch("P" + i, "P" + i, ethers.zeroPadValue(ethers.toBeHex(i), 32), 0, 0)).wait();
      const token = await launcher.allTokens(BigInt(i - 1));
      const quoteIs0 = BigInt(USDC) < BigInt(token);
      if (seen.has(quoteIs0)) continue;
      seen.add(quoteIs0);
      const [, , , poolId] = await launcher.launches(token);
      const [sqrt] = await sv.getSlot0(poolId);
      const raw = Number(sqrt) ** 2 / 2 ** 192; // currency1 per currency0, base units
      const usdcPerToken = quoteIs0 ? 1 / ((raw * 1e6) / 1e18) : (raw * 1e18) / 1e6;
      const mcap = usdcPerToken * 1e9;
      expect(mcap, quoteIs0 ? "token=currency1" : "token=currency0").to.be.within(TARGET_MCAP * 0.95, TARGET_MCAP * 1.05);
    }
    expect(seen.size, "needs a launch in each ordering").to.equal(2);
  });
});
