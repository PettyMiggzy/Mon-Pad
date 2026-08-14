const { ethers } = require("hardhat");
const { expect } = require("chai");
const { mineHookSalt, hookInitCode } = require("../../scripts/mine");

// SIM — GRADUATION of the BASIC MonPad pad (no floor vault, no ambush vault, no staking pool).
//
// Runs the production geometry all the way through: launch → buy the curve out → graduate(), and proves the
// three things the basic configuration changes relative to the audited Robin suite:
//
//   1. CONSERVATION HOLDS WITH THE SINKS ABSENT. Every share that would route to a floor/ambush vault is set to
//      zero, so no MON accrues into a book that only flushFloor()/flushAmbush() could release. Nothing strands.
//   2. THE LEFTOVER RESERVE IS BURNED. The factory's [HIGH-2] check sizes reserveSupply as if the WHOLE raise
//      seeds the LP, but the waterfall routes only the LP share, so the LP mint cannot consume the reserve. With
//      no staking sink wired that residue would sit on the curve forever; it is sent to 0x…dEaD instead.
//   3. THE KEEPER BOUNTY IS SOLVENT ON MONAD. Re-denominated to a 100 MON cap — the ported 0.02 ETH cap would
//      have been ~0.02 MON (≈$0.0004) against a gas cost of ~0.5 MON, since Monad charges on the tx GAS LIMIT.

const ZERO = ethers.ZeroAddress;
const DEAD = "0x000000000000000000000000000000000000dEaD";
const abi = ethers.AbiCoder.defaultAbiCoder();
const E = (x) => ethers.parseEther(String(x));
const ONE = 10n ** 18n;

const START = 90900, WIDTH = 23000, GRAD = START - WIDTH, TS = 100, FEE = 10000, MINGRAD = 22800;
const SUPPLY = 1_000_000_000n * ONE;
const CURVE = 730_000_000n * ONE;
const RESERVE = 270_000_000n * ONE;

function poolIdOf(k) {
  return ethers.keccak256(
    abi.encode(["tuple(address,address,uint24,int24,address)"], [[k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]])
  );
}

describe("SIM — basic-pad graduation (burn the leftover reserve, no floor/ambush/staking)", () => {
  it("graduates at production geometry: locks the LP, burns the residue, strands nothing, pays the keeper", async () => {
    const [deployer, platform, creator, whale, keeper] = await ethers.getSigners();
    await ethers.provider.send("hardhat_setBalance", [whale.address, "0x" + (10n ** 24n).toString(16)]);

    const pm = await (await ethers.getContractFactory("PoolManager")).deploy(deployer.address);
    const stateView = await (await ethers.getContractFactory("MonPadStateView")).deploy(await pm.getAddress());
    const dep = await (await ethers.getContractFactory("DeterministicDeployer")).deploy();
    const reg = await (await ethers.getContractFactory("FeeWalletRegistry")).deploy(platform.address, deployer.address);
    const permit2 = await (await ethers.getContractFactory("MockPermit2")).deploy();
    const posm = await (await ethers.getContractFactory("MockPositionManagerV4")).deploy(await pm.getAddress(), await permit2.getAddress());
    const lockVault = await (await ethers.getContractFactory("LockVault")).deploy(await posm.getAddress(), await reg.getAddress());
    const curveDep = await (await ethers.getContractFactory("CurveV4Deployer")).deploy(await dep.getAddress());
    const feeCfg = await (await ethers.getContractFactory("MonPadV4FeeConfig")).deploy(deployer.address, {
      buyTaxBps: 100, sellTaxBps: 100, sellFloorShareBps: 0, buyLpFloorShareBps: 0, buyBufferShareBps: 2000, referralShareBps: 0,
      platformGradBps: 1000, creatorGradBps: 1000, ambushGradBps: 0,
      lpFee: FEE, startTickMag: START, curveWidth: WIDTH, minGradWidth: MINGRAD,
    });
    const factory = await (await ethers.getContractFactory("MonPadFactoryV4")).deploy(
      await pm.getAddress(), await posm.getAddress(), await permit2.getAddress(), await stateView.getAddress(),
      await dep.getAddress(), await curveDep.getAddress(), await feeCfg.getAddress(), await reg.getAddress(), await lockVault.getAddress()
    );
    await lockVault.setFactory(await factory.getAddress());

    const cfg = { name: "Grad", symbol: "GRD", decimals: 18, supply: SUPPLY, curveSupply: CURVE, reserveSupply: RESERVE, tickSpacing: TS, creator: creator.address };
    const tokenSalt = ethers.id("grad-tok"), curveSalt = ethers.id("grad-curve");
    const TokenF = await ethers.getContractFactory("PadToken");
    const tokenInit = ethers.concat([TokenF.bytecode, abi.encode(["string", "string", "uint8", "uint256", "address"], [cfg.name, cfg.symbol, cfg.decimals, cfg.supply, await factory.getAddress()])]);
    const predictedToken = ethers.getCreate2Address(await dep.getAddress(), tokenSalt, ethers.keccak256(tokenInit));
    const HookF = await ethers.getContractFactory("MonPadFeeHook");
    const { salt: hookSalt } = mineHookSalt(await dep.getAddress(), hookInitCode(HookF.bytecode, await pm.getAddress(), await factory.getAddress(), await reg.getAddress(), predictedToken));

    const [token, hook, curveAddr] = await factory.launch.staticCall(cfg, tokenSalt, hookSalt, curveSalt);
    await (await factory.launch(cfg, tokenSalt, hookSalt, curveSalt)).wait();
    const key = { currency0: ZERO, currency1: token, fee: FEE, tickSpacing: TS, hooks: hook };
    const poolId = poolIdOf(key);
    const curve = await ethers.getContractAt("MonPadCurveV4", curveAddr);
    const tok = await ethers.getContractAt("PadToken", token);
    const th = await (await ethers.getContractFactory("TickHelper")).deploy();
    const sw = await (await ethers.getContractFactory("PoolSwapTest")).deploy(await pm.getAddress());

    // ── buy the curve out to the ceiling ──
    const gradSqrt = await th.sqrt(GRAD);
    await (await sw.connect(whale).swap(
      key, { zeroForOne: true, amountSpecified: -E(280_000), sqrtPriceLimitX96: gradSqrt },
      { takeClaims: false, settleUsingBurn: false }, "0x", { value: E(280_000) }
    )).wait();
    expect(await curve.ready()).to.equal(true);

    // ── graduate, triggered by an unrelated keeper (permissionless) ──
    const reserveOnCurve = await tok.balanceOf(curveAddr);
    const deadBefore = await tok.balanceOf(DEAD);
    const keeperBefore = await ethers.provider.getBalance(keeper.address);
    const idBefore = await posm.nextTokenId();
    const gr = await (await curve.connect(keeper).graduate()).wait();
    const keeperNet = (await ethers.provider.getBalance(keeper.address)) - keeperBefore + gr.gasUsed * gr.gasPrice;

    await curve.claimPlatform();
    await curve.claimCreator();

    // ── 1. conservation: nothing stranded, and no MON parked in a sink that does not exist ──
    expect(await curve.floorEthOwed()).to.equal(0n);   // sellFloorShareBps/buyLpFloorShareBps = 0 ⇒ never accrues
    expect(await curve.ambushEthOwed()).to.equal(0n);  // ambushGradBps = 0 ⇒ never accrues
    expect(await curve.platformEthOwed()).to.equal(0n);
    expect(await curve.creatorEthOwed()).to.equal(0n);
    expect(await ethers.provider.getBalance(curveAddr)).to.equal(0n); // all MON distributed
    expect(await tok.balanceOf(curveAddr)).to.equal(0n);              // all token → LP + burn

    // ── 2. the leftover reserve was burned, not stranded ──
    const burned = (await tok.balanceOf(DEAD)) - deadBefore;
    expect(burned).to.be.gt(0n);
    expect(burned).to.be.lt(reserveOnCurve);           // the LP consumed the rest of the reserve
    const burnedPct = Number(burned * 10000n / SUPPLY) / 100;
    expect(burnedPct).to.be.within(5, 12);             // ~8.5% of supply at this geometry + waterfall

    // ── 3. the permanent LP is locked and holds real liquidity ──
    expect(await posm.ownerOf(idBefore)).to.equal(await lockVault.getAddress());
    const [posL] = await stateView.getPositionInfo(
      poolId, await posm.getAddress(),
      Number(await th.minUsable(TS)), Number(await th.maxUsable(TS)), ethers.ZeroHash
    );
    expect(posL).to.be.gt(0n);

    // ── 4. the keeper was paid, and paid enough to be worth doing on Monad ──
    expect(keeperNet).to.equal(E(100));                // the 100 MON cap (0.2% of ~260k would be ~525)
    expect(keeperNet).to.be.gt(gr.gasUsed * gr.gasPrice * 10n); // comfortably covers its own gas

    console.log(`      burned ${(Number(burned) / 1e18 / 1e6).toFixed(1)}M token (${burnedPct.toFixed(2)}% of supply) | keeper +${ethers.formatEther(keeperNet)} MON`);
  });
});
