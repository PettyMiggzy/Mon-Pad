// MonpadV4Router on a fork of Monad mainnet (real V4 PoolManager).
// Run:  FORK_RPC=https://rpc.monad.xyz npx hardhat test test/uv4-router.fork.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const { uv4StartTick } = require("../scripts/v4-params");
const { deployHookAndLauncher } = require("../scripts/mine-hook");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const STATE_VIEW = "0x77395f3b2e73ae90843717371294fa97cc419d64";
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const DYNAMIC = 0x800000;
const E = (n) => ethers.parseEther(String(n));

const stateViewAbi = [
  "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
];

(process.env.FORK_RPC ? describe : describe.skip)("MonpadV4Router (fork of Monad mainnet)", function () {
  this.timeout(900000);
  const START_TICK = uv4StartTick(250000);
  let creator, launcher, hook, router, sv;
  let salt = 0;
  const nextSalt = () => ethers.zeroPadValue(ethers.toBeHex(++salt), 32);
  const deadline = () => Math.floor(Date.now() / 1000) + 3600;

  const keyOf = (token, hooks) => ({
    currency0: ethers.ZeroAddress,
    currency1: token,
    fee: DYNAMIC,
    tickSpacing: 200,
    hooks,
  });

  before(async function () {
    [creator] = await ethers.getSigners();
    await setBalance(creator.address, E(10_000_000));
    ({ launcher, hook } = await deployHookAndLauncher(creator, {
      poolManager: POOL_MANAGER,
      owner: creator.address,
      platform: creator.address,
      monshi: MONSHI,
      startTick: START_TICK,
      creationFee: E(100),
    }));
    router = await (await ethers.getContractFactory("MonpadV4Router")).deploy(POOL_MANAGER, await launcher.getAddress(), await hook.getAddress());
    await router.waitForDeployment();
    sv = new ethers.Contract(STATE_VIEW, stateViewAbi, ethers.provider);
  });

  async function launch() {
    const tx = await launcher.connect(creator).launch("Router", "RTR", nextSalt(), 0, { value: E(100) });
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
    const token = ev.args.token;
    const poolId = ev.args.poolId;
    return { token, poolId, key: keyOf(token, await hook.getAddress()) };
  }

  it("refunds unspent MON on a partial-fill buy (tight price limit)", async function () {
    const r = await launch();
    const monBefore = await ethers.provider.getBalance(creator.address);
    const huge = E(50_000);
    const [sqrtP] = await sv.getSlot0(r.poolId);
    // zeroForOne buy: price moves down; limit slightly below spot stops the swap early
    const limit = (sqrtP * 9990n) / 10000n;

    const tx = await router.connect(creator).buyExactIn(r.key, 1n, deadline(), limit, { value: huge });
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const monAfter = await ethers.provider.getBalance(creator.address);

    expect(monAfter + gas).to.be.lt(monBefore);
    expect(monBefore - monAfter - gas).to.be.lt(huge);
    expect(monBefore - monAfter - gas).to.be.gt(0n);
  });

  it("reverts on a crafted malicious PoolKey (wrong hook)", async function () {
    const r = await launch();
    const bad = keyOf(r.token, creator.address);
    await expect(
      router.connect(creator).buyExactIn(bad, 0n, deadline(), 0, { value: E(1) }),
    ).to.be.revertedWithCustomError(router, "BadKey");
  });

  it("reverts on unknown token (not in launcher.launches)", async function () {
    const r = await launch();
    const fakeToken = ethers.Wallet.createRandom().address;
    const bad = keyOf(fakeToken, await hook.getAddress());
    await expect(
      router.connect(creator).buyExactIn(bad, 0n, deadline(), 0, { value: E(1) }),
    ).to.be.revertedWithCustomError(router, "UnknownToken");
  });

  it("reverts when minTokensOut slippage is not met", async function () {
    const r = await launch();
    await expect(
      router.connect(creator).buyExactIn(r.key, E(1_000_000), deadline(), 0, { value: E(10) }),
    ).to.be.revertedWithCustomError(router, "Slippage");
  });
});
