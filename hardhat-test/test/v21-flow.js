// MonPad V2.1 audit-fix invariant tests.
//
// Run:
//   cd hardhat-test
//   npm install
//   npx hardhat test
//
// What this covers:
//   - V2.1-1   Curve auto-authorized in Hub at createLaunch (sells succeed)
//   - V2.1-2   MonPadGraduator.onGraduate rejects non-curve callers
//   - V2.1-3   Dev-buy slider works at sub-2% supply (was reverting in V2)
//   - V2.1-5   Buy/sell creator fees use pull pattern via creatorPending + claimCreatorRewards
//   - V2.1-6   Curve._graduate sends address(this).balance - creatorPending (not hardcoded 400k)
//   - V2.1-10  Pool reads treasuryWallet live from factory (rotation propagates)
//   - V2.1-14  _graduate fails upfront with "insufficient for grad" instead of mid-flow
//   - V2.1-16  Hub binds curve→token at setCurveAuthorized; ignores curve-supplied arg
//
// What's NOT covered (out of scope for these tests):
//   - Real Uniswap V3 LP minting (MockGraduator stands in; real Graduator's V3 path
//     is exercised only by deploying against a Monad fork, not in this suite)
//   - Holders-list scanning (server-side feature)
//   - Frontend UI

const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO = "0x0000000000000000000000000000000000000000";
const ONE_BILLION = 1_000_000_000n * 10n ** 18n;
const E18 = 10n ** 18n;

async function deployAll() {
  const [owner, alice, bob, attacker, platform, treasury, buyback, newTreasury] =
    await ethers.getSigners();

  // MONSHI mock
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const monshi = await MockERC20.deploy("Monshi", "MONSHI");
  await monshi.waitForDeployment();

  // V3 + WMON mocks (only needed so MonPadGraduator constructor can read NPM.factory())
  const MockUniV3Factory = await ethers.getContractFactory("MockUniV3Factory");
  const v3Factory = await MockUniV3Factory.deploy();
  await v3Factory.waitForDeployment();

  const MockNPM = await ethers.getContractFactory("MockNPM");
  const npm = await MockNPM.deploy(await v3Factory.getAddress());
  await npm.waitForDeployment();

  const MockWMON = await ethers.getContractFactory("MockWMON");
  const wmon = await MockWMON.deploy();
  await wmon.waitForDeployment();

  // Real factory + hub + pool factory
  const Factory = await ethers.getContractFactory("MonPadFactoryV2");
  const factory = await Factory.deploy(platform.address, treasury.address, buyback.address);
  await factory.waitForDeployment();

  const Hub = await ethers.getContractFactory("MonPadStakingHub");
  const hub = await Hub.deploy(await factory.getAddress(), 3600, ethers.parseEther("0.5"));
  await hub.waitForDeployment();

  const PoolFactory = await ethers.getContractFactory("MonPadPoolFactory");
  const poolFactory = await PoolFactory.deploy(
    await hub.getAddress(),
    await factory.getAddress(),
    await monshi.getAddress()
  );
  await poolFactory.waitForDeployment();

  // Mock graduator first — the real one does V3 mint, which would need a live fork.
  const MockGraduator = await ethers.getContractFactory("MockGraduator");
  const mockGraduator = await MockGraduator.deploy();
  await mockGraduator.waitForDeployment();

  // bootstrapInit wires graduator + rewardRouter (= hub) + poolFactory atomically
  await factory.bootstrapInit(
    await mockGraduator.getAddress(),
    await hub.getAddress(),
    await poolFactory.getAddress()
  );

  // Pin MONSHI on the hub so notifyReward routes correctly
  await hub.bootstrapMonshi(await monshi.getAddress());

  return {
    owner, alice, bob, attacker, platform, treasury, buyback, newTreasury,
    monshi, v3Factory, npm, wmon, factory, hub, poolFactory, mockGraduator,
  };
}

async function launchToken(ctx, creator, name = "TestTok", symbol = "TT") {
  const tx = await ctx.factory.connect(creator).createLaunch(name, symbol, ZERO, {
    value: ethers.parseEther("100"), // creationFee, no dev buy
  });
  const receipt = await tx.wait();
  // Parse Launched event
  const log = receipt.logs.find(l => {
    try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
  });
  const parsed = ctx.factory.interface.parseLog(log);
  return { tokenAddr: parsed.args.token, curveAddr: parsed.args.curve };
}

describe("MonPad V2.1 — audit invariants", function () {

  // ─────────────────────────────────────────────────────────────
  it("V2.1-1: launch auto-authorizes curve in hub; sell succeeds", async function () {
    const ctx = await deployAll();
    const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice);

    // Hub should have isCurve[curve] = true after createLaunch
    expect(await ctx.hub.isCurve(curveAddr)).to.equal(true);

    // V2.1-16: Hub also pinned curveToken[curve] = token
    expect((await ctx.hub.curveToken(curveAddr)).toLowerCase()).to.equal(tokenAddr.toLowerCase());

    // Buy then sell — sell triggers curve.notifyReward(token) on hub
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("1") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    expect(bobBal).to.be.gt(0);

    await token.connect(ctx.bob).approve(curveAddr, bobBal);
    // Sell would revert if hub auth was missing (fallback empty-data send hits hub.receive
    // which reverts PlainMonRejected, then curve's require(ok, "staking fee fail") fires)
    await expect(curve.connect(ctx.bob).sell(bobBal / 2n, 0)).to.not.be.reverted;
  });

  // ─────────────────────────────────────────────────────────────
  it("V2.1-2: MonPadGraduator.onGraduate reverts for non-curve callers", async function () {
    const ctx = await deployAll();

    // Deploy the REAL Graduator alongside (not the mock one in factory.graduator).
    const Graduator = await ethers.getContractFactory("MonPadGraduator");
    const graduator = await Graduator.deploy(
      await ctx.factory.getAddress(),
      await ctx.npm.getAddress(),
      await ctx.wmon.getAddress()
    );
    await graduator.waitForDeployment();

    // Launch a token, then have an attacker try to call onGraduate directly
    const { tokenAddr } = await launchToken(ctx, ctx.alice);

    await expect(
      graduator.connect(ctx.attacker).onGraduate(tokenAddr, { value: ethers.parseEther("400000") })
    ).to.be.revertedWithCustomError(graduator, "NotCurve");
  });

  // ─────────────────────────────────────────────────────────────
  it("V2.1-3: dev buy at 1% supply succeeds (was reverting on minDevBuyMon=100)", async function () {
    const ctx = await deployAll();

    // Ask the curve math: how much MON for ~1% of supply?
    // tokensOut = currentTokens - (currentMon * currentTokens) / (currentMon + monForBuy)
    // At launch: currentMon = 30, currentTokens = 1.073e9. Want 10M tokens.
    //   monForBuy ≈ 0.283 MON; gross monIn ≈ 0.283 MON (no fees on dev buy).
    // But we also need monIn >= minDevBuyMon, which V2.1-3 set to 0.
    // Send 0.3 MON above creationFee:
    const devBuyMon = ethers.parseEther("0.3");
    const total = ethers.parseEther("100") + devBuyMon;

    // V2 would have reverted: minDevBuyMon was 100 ether and 0.3 < 100.
    await expect(
      ctx.factory.connect(ctx.alice).createLaunch("DevBuyTok", "DBT", ZERO, { value: total })
    ).to.not.be.reverted;
  });

  // ─────────────────────────────────────────────────────────────
  it("V2.1-5: creator fees accrue to creatorPending; claimCreatorRewards drains", async function () {
    const ctx = await deployAll();
    const { curveAddr } = await launchToken(ctx, ctx.alice);
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);

    // Bob buys 10 MON. Creator (alice) should get 1% = 0.1 MON pending.
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10") });
    const pending = await curve.creatorPending();
    expect(pending).to.equal(ethers.parseEther("0.1"));

    // alice's wallet balance should NOT have changed yet (pull pattern)
    // Drain
    const before = await ethers.provider.getBalance(ctx.alice.address);
    const tx = await curve.connect(ctx.alice).claimCreatorRewards();
    const r = await tx.wait();
    const gasCost = r.gasUsed * r.gasPrice;
    const after = await ethers.provider.getBalance(ctx.alice.address);

    // Net delta = pending - gasCost
    expect(after - before + gasCost).to.equal(pending);
    expect(await curve.creatorPending()).to.equal(0n);
  });

  // ─────────────────────────────────────────────────────────────
  it("V2.1-6 + V2.1-14: graduation sends balance-creatorPending; reverts if insufficient", async function () {
    const ctx = await deployAll();
    const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice);
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);

    // Lower graduationTarget so we can hit it in one buy without burning all signer balance.
    // setGraduationTarget is timelocked. Skip via a fresh factory? Simpler: keep default 425k
    // but use a big buy. Hardhat default signer has 10000 ETH, so 425k MON in a single tx
    // exceeds that. Instead: lower the target via a hack — directly modify storage? Use
    // hardhat_setStorageAt? Cleaner: have multiple signers contribute via multiple buys.
    //
    // Actually simplest: deal alice extra ETH via hardhat setBalance.
    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0x" + (500_000n * 10n ** 18n).toString(16),
    ]);

    // Bob buys ~430k MON in one shot to push past graduationTarget=425k
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("430000") });

    // After graduation:
    //   curve.graduated() == true
    //   MockGraduator.lastMonReceived[token] == address(this).balance - creatorPending
    //     where address(this).balance was monRaisedNet - creatorReward (after creator + buffer pushes)
    expect(await curve.graduated()).to.equal(true);
    const monRecv = await ctx.mockGraduator.lastMonReceived(tokenAddr);
    expect(monRecv).to.be.gt(ethers.parseEther("400000"));   // overshoot included
    expect(monRecv).to.be.lt(ethers.parseEther("420000"));   // less than 425k - 25k creatorReward bound

    // Curve no longer accepts buys (notGraduated modifier)
    await expect(
      curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("grad");

    // V2.1-14 sub-test: spin up a fresh deployment, raise creatorReward above target, expect
    // _graduate to revert "insufficient for grad" upfront.
    const fresh = await deployAll();
    const ftk = await launchToken(fresh, fresh.alice);
    const fcurve = await ethers.getContractAt("MonPadCurveV2", ftk.curveAddr);
    // Queue + execute setGraduationCreatorReward(500k MON) — exceeds target 425k.
    await fresh.factory.connect(fresh.owner).queueSetGraduationCreatorReward(ethers.parseEther("500000"));
    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await fresh.factory.connect(fresh.owner).executeSetGraduationCreatorReward(ethers.parseEther("500000"));

    await ethers.provider.send("hardhat_setBalance", [
      fresh.bob.address,
      "0x" + (500_000n * 10n ** 18n).toString(16),
    ]);
    // Buy enough to trigger _graduate
    await expect(
      fcurve.connect(fresh.bob).buy(0, { value: ethers.parseEther("430000") })
    ).to.be.revertedWith("insufficient for grad");
  });

  // ─────────────────────────────────────────────────────────────
  it("V2.1-10: Pool reads treasuryWallet live from factory (rotation propagates)", async function () {
    const ctx = await deployAll();

    // adminCreatePool needs MONSHI as the token (burnsToCreator=true gate).
    await ctx.poolFactory.connect(ctx.owner).adminCreatePool(
      await ctx.monshi.getAddress(),
      ctx.buyback.address,
      true
    );
    const monshiPoolAddr = await ctx.poolFactory.tokenToPool(await ctx.monshi.getAddress());
    const pool = await ethers.getContractAt("MonPadStakingPool", monshiPoolAddr);

    // Mint MONSHI to alice and have her stake via the paid path (100 MON fee)
    await ctx.monshi.mint(ctx.alice.address, ethers.parseEther("1000"));
    await ctx.monshi.connect(ctx.alice).approve(monshiPoolAddr, ethers.parseEther("1000"));
    await pool.connect(ctx.alice).stake(0, ethers.parseEther("1000"), true, {
      value: ethers.parseEther("100"),
    });

    // 100 MON in treasuryPending. Original treasury is ctx.treasury.
    expect(await pool.treasuryPending()).to.equal(ethers.parseEther("100"));

    // Old treasury claims successfully
    const before = await ethers.provider.getBalance(ctx.treasury.address);
    const tx = await pool.connect(ctx.treasury).claimTreasury();
    const r = await tx.wait();
    const after = await ethers.provider.getBalance(ctx.treasury.address);
    expect(after - before + r.gasUsed * r.gasPrice).to.equal(ethers.parseEther("100"));

    // Now rotate factory.treasuryWallet → newTreasury (24h timelock)
    await ctx.factory.connect(ctx.owner).queueSetTreasuryWallet(ctx.newTreasury.address);
    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await ctx.factory.connect(ctx.owner).executeSetTreasuryWallet(ctx.newTreasury.address);

    // New stake → 100 MON treasuryPending
    await ctx.monshi.mint(ctx.bob.address, ethers.parseEther("1000"));
    await ctx.monshi.connect(ctx.bob).approve(monshiPoolAddr, ethers.parseEther("1000"));
    await pool.connect(ctx.bob).stake(0, ethers.parseEther("1000"), true, {
      value: ethers.parseEther("100"),
    });

    // OLD treasury MUST now be rejected by the live read
    await expect(pool.connect(ctx.treasury).claimTreasury()).to.be.revertedWithCustomError(
      pool, "NotTreasury"
    );
    // NEW treasury can drain
    const beforeNew = await ethers.provider.getBalance(ctx.newTreasury.address);
    const tx2 = await pool.connect(ctx.newTreasury).claimTreasury();
    const r2 = await tx2.wait();
    const afterNew = await ethers.provider.getBalance(ctx.newTreasury.address);
    expect(afterNew - beforeNew + r2.gasUsed * r2.gasPrice).to.equal(ethers.parseEther("100"));
  });

  // ─────────────────────────────────────────────────────────────
  // POOL→HUB CLAIM END-TO-END
  // Catches the V2.1 blocker where Pool._pullFromHubInternal called Hub with the
  // pool address instead of the token address, making every claim revert and stranding
  // every reward in the Hub forever.
  it("Pool can pull distributed rewards from Hub (end-to-end claim)", async function () {
    const ctx = await deployAll();

    // 1. Launch a token, register a pool for it via PoolFactory.
    const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice);
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    // Public createPool requires either 1M MONSHI or 100 MON. Use the paid path.
    await ctx.poolFactory.connect(ctx.alice).createPool(tokenAddr, {
      value: ethers.parseEther("100"),
    });
    const poolAddr = await ctx.poolFactory.tokenToPool(tokenAddr);
    const pool = await ethers.getContractAt("MonPadStakingPool", poolAddr);

    // Confirm the hub registered it
    expect(await ctx.hub.tokenToPool(tokenAddr)).to.equal(poolAddr);

    // 2. Bob buys, then sells — sell-tax 0.5% routes to Hub.notifyReward via the curve.
    //    (Curve was auto-authorized in Hub at launch via V2.1-1.)
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("100") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(curveAddr, bobBal);
    await curve.connect(ctx.bob).sell(bobBal / 2n, 0);

    // 3. Hub should now have non-zero volumeCache for this token AND non-zero balance.
    expect(await ctx.hub.volumeCache(tokenAddr)).to.be.gt(0);
    const hubAddr = await ctx.hub.getAddress();
    const hubBalanceBefore = await ethers.provider.getBalance(hubAddr);
    expect(hubBalanceBefore).to.be.gt(0);

    // 4. Advance time past distributeInterval and trigger _distribute.
    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);
    await ctx.hub.distribute();

    // 5. Hub should have credited pendingReward[token] (NOT pendingReward[poolAddr]).
    const pendingByToken = await ctx.hub.pendingReward(tokenAddr);
    const pendingByPool = await ctx.hub.pendingReward(poolAddr);
    expect(pendingByToken).to.be.gt(0);
    expect(pendingByPool).to.equal(0);

    // 6. Stake some tokens so the pool has non-zero totalWeightedStaked
    //    (otherwise pullFromHub's _accrue() takes the "hold" branch).
    //    Free path requires 2M MONSHI; use the paid path with 100 MON fee.
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10") });
    const stakeAmt = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(poolAddr, stakeAmt);
    // pool.stake takes (tierId, amount, paidFee) and msg.value is the 100 MON paid-fee
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, {
      value: ethers.parseEther("100"),
    });

    // 7. NOW pull from Hub. Pre-fix this would revert with PoolNotRegistered.
    //    Post-fix it must succeed and move MON from Hub → Pool.
    const poolBalBefore = await ethers.provider.getBalance(poolAddr);
    const hubPendingBefore = await ctx.hub.pendingReward(tokenAddr);
    expect(hubPendingBefore).to.be.gt(0);

    await pool.pullFromHub();

    const poolBalAfter = await ethers.provider.getBalance(poolAddr);
    const hubPendingAfter = await ctx.hub.pendingReward(tokenAddr);

    // Hub credit was zeroed
    expect(hubPendingAfter).to.equal(0);
    // Pool received the MON
    expect(poolBalAfter - poolBalBefore).to.equal(hubPendingBefore);

    // 8. Bob claims his reward share.
    const stakeIdx = 0;
    const earned = await pool.pending(ctx.bob.address, stakeIdx);
    expect(earned).to.be.gt(0);

    const bobBalBefore = await ethers.provider.getBalance(ctx.bob.address);
    const tx = await pool.connect(ctx.bob).claim(stakeIdx);
    const receipt = await tx.wait();
    const bobBalAfter = await ethers.provider.getBalance(ctx.bob.address);
    const gasCost = receipt.gasUsed * receipt.gasPrice;
    expect(bobBalAfter - bobBalBefore + gasCost).to.equal(earned);
  });
});
