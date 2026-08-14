const { ethers } = require("hardhat");
const { expect } = require("chai");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// FORK — the definitive end-to-end proof against Monad's LIVE Uniswap V4 stack: launch a free single-sided
// curve pad, buy it OUT (overshooting the ceiling), then graduate — asserting the ceiling nudge lands spot at
// gradTick, the permanent LOCKED 2-sided LP mints to the LockVault (reserve pairs the raise), the leftover
// reserve is BURNED (no staking pool in the basic pad), and the fee books are claimable.
//
// This is the one leg the local tests cannot cover: they run against a locally-deployed PoolManager, which
// proves the hook/curve logic but not the real PositionManager + Permit2 mint path.
//
//   FORK_RPC=<monad rpc> npx hardhat test test/fork/CurveGraduation.fork.test.js
//
// A public endpoint may not serve archive state; use a dedicated provider (the app already uses QuickNode —
// see ../../.env.example) if forking fails on historical reads.

// Uniswap V4 on Monad mainnet (chain 143) — each verified to carry code on rpc.monad.xyz.
const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const POSITION_MANAGER = "0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// [MONAD] canonical Uniswap StateView — we do NOT deploy our own here, unlike the Robinhood original
const STATE_VIEW = "0x77395f3b2e73ae90843717371294fa97cc419d64";

const MIN_SQRT_LIMIT = 4295128739n + 1n;
const FLAG_MASK = 0x3fffn, HOOK_FLAGS = 0xccn;
const ZERO = ethers.ZeroAddress;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const abi = ethers.AbiCoder.defaultAbiCoder();

describe("MonPadFactoryV4 — launch → sellout → graduate on live Monad V4 (0x188d58…)", function () {
  before(function () {
    if (!process.env.FORK_RPC) this.skip();
  });

  it("graduates: nudge to ceiling, locked LP to LockVault, leftover reserve burned, books claimable", async () => {
    const [deployer, platform, creator, trader] = await ethers.getSigners();
    await ethers.provider.send("hardhat_setBalance", [trader.address, "0x" + (10n ** 24n).toString(16)]);

    // ── bootstrap the stack ──
    const dep = await (await ethers.getContractFactory("DeterministicDeployer")).deploy();
    const reg = await (await ethers.getContractFactory("FeeWalletRegistry")).deploy(platform.address, deployer.address);
    const lockVault = await (await ethers.getContractFactory("LockVault")).deploy(POSITION_MANAGER, await reg.getAddress());
    const curveDep = await (await ethers.getContractFactory("CurveV4Deployer")).deploy(await dep.getAddress());
    const stateView = await ethers.getContractAt("IStateView", STATE_VIEW);

    // Toy geometry: this test proves the LIVE V4 integration (real PositionManager mint + Permit2 + the
    // graduation unlock), not the economics — production geometry is measured on-chain against a local
    // PoolManager in test/sim/curve.calibration.sim.test.js. Small numbers keep the fork run fast.
    const START = 6000, GRAD = 3000, SPACING = 60, FEE = 3000;
    // BASIC PAD: no floor vault, no ambush vault, no staking ⇒ every share routing to one is ZERO.
    const feeCfg = await (await ethers.getContractFactory("MonPadV4FeeConfig")).deploy(deployer.address, {
      buyTaxBps: 100, sellTaxBps: 100, sellFloorShareBps: 0, buyLpFloorShareBps: 0, buyBufferShareBps: 2000, referralShareBps: 0,
      platformGradBps: 2000, creatorGradBps: 1500, ambushGradBps: 0,
      lpFee: FEE, startTickMag: START, curveWidth: START - GRAD, minGradWidth: 1800,
    });

    const factory = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
      POOL_MANAGER, POSITION_MANAGER, PERMIT2, STATE_VIEW,
      await dep.getAddress(), await curveDep.getAddress(), await feeCfg.getAddress(),
      await reg.getAddress(), await lockVault.getAddress()
    );
    await lockVault.setFactory(await factory.getAddress());

    const cfg = {
      name: "MonPad Curve", symbol: "mCRV", decimals: 18,
      // NO DEV MINT: supply == curveSupply + reserveSupply exactly (creator gets nothing at launch)
      supply: 300n * 10n ** 18n, curveSupply: 100n * 10n ** 18n, reserveSupply: 200n * 10n ** 18n,
      tickSpacing: SPACING, creator: creator.address,
    };

    // predict token addr → mine hook salt (hook init-code carries the token)
    const TokenF = await ethers.getContractFactory("PadToken");
    const tokenSalt = ethers.id("mcrv-1");
    const tokenInit = ethers.concat([
      TokenF.bytecode,
      abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await factory.getAddress()]),
    ]);
    const predictedToken = ethers.getCreate2Address(await dep.getAddress(), tokenSalt, ethers.keccak256(tokenInit));
    const HookF = await ethers.getContractFactory("MonPadFeeHook");
    const { salt: hookSalt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, POOL_MANAGER, await factory.getAddress(), await reg.getAddress(), predictedToken));
    const curveSalt = ethers.id("mcrv-curve-1");

    // ── launch ──
    const ret = await factory.launch.staticCall(cfg, tokenSalt, hookSalt, curveSalt);
    await (await factory.launch(cfg, tokenSalt, hookSalt, curveSalt)).wait();
    const [token, hook, curveAddr] = ret;
    expect(token).to.equal(predictedToken);
    expect(BigInt(hook) & FLAG_MASK).to.equal(HOOK_FLAGS);

    const curve = await ethers.getContractAt("MonPadCurveV4", curveAddr);
    const tok = await ethers.getContractAt("PadToken", token);
    expect(await curve.seeded()).to.equal(true);
    expect(await tok.balanceOf(curveAddr)).to.equal(cfg.reserveSupply); // reserve held, curve seeded
    expect(await tok.balanceOf(creator.address)).to.equal(0n); // NO premine

    // ── buy the curve OUT (overshoot the ceiling) with native MON ──
    const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: SPACING, hooks: hook };
    const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(POOL_MANAGER);
    await sw.connect(trader).swap(
      key, { zeroForOne: true, amountSpecified: -ethers.parseEther("300"), sqrtPriceLimitX96: MIN_SQRT_LIMIT },
      { takeClaims: false, settleUsingBurn: false }, "0x", { value: ethers.parseEther("300") }
    );
    expect(await curve.ready()).to.equal(true);

    // ── a hostile MON donation before graduation must NOT brick graduate() ──
    // (the raise is measured from the pull delta, not raw balance, so it cannot inflate lpEth)
    await deployer.sendTransaction({ to: curveAddr, value: ethers.parseEther("2") });

    // ── graduate (permissionless; the keeper bounty comes out of the curve's own MON) ──
    const posm = await ethers.getContractAt("IPositionManagerMinimal", POSITION_MANAGER);
    const idBefore = await posm.nextTokenId();
    const deadBefore = await tok.balanceOf(DEAD);
    await (await curve.graduate()).wait();

    expect(await curve.graduated()).to.equal(true);
    // the permanent LP NFT is owned by the LockVault (locked forever) — the real PositionManager minted it
    expect(await posm.ownerOf(idBefore)).to.equal(await lockVault.getAddress());
    // spot was nudged back to the honest ceiling before seeding
    expect((await stateView.getSlot0(await factory.poolOf(token)))[1]).to.equal(GRAD);
    // [MONAD] no staking pool wired ⇒ the leftover reserve is BURNED, not stranded on the curve
    expect((await tok.balanceOf(DEAD)) - deadBefore).to.be.gt(0n);
    expect(await tok.balanceOf(curveAddr)).to.equal(0n);
    // no floor/ambush wired and their shares are 0 ⇒ nothing accrues into an unreachable book
    expect(await curve.floorEthOwed()).to.equal(0n);
    expect(await curve.ambushEthOwed()).to.equal(0n);

    // fee books claimable
    await expect(curve.claimPlatform()).to.not.be.reverted;
    expect(await curve.creatorEthOwed()).to.be.gt(0n);
    const creatorBefore = await ethers.provider.getBalance(creator.address);
    await (await curve.claimCreator()).wait();
    expect(await ethers.provider.getBalance(creator.address)).to.be.gt(creatorBefore);
    expect(await curve.creatorEthOwed()).to.equal(0n);
  });
});
