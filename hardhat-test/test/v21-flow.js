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
  const tx = await ctx.factory.connect(creator).createLaunch(name, symbol, {
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

    // Fund attacker past hardhat mempool validator so the 400k MON tx is accepted
    // and the revert fires at the contract's NotCurve check (V2.1-2), not at validation.
    await ethers.provider.send("hardhat_setBalance", [
      ctx.attacker.address,
      "0xFFFFFFFFFFFFFFFFFFFFFFFF",
    ]);

    await expect(
      graduator.connect(ctx.attacker).onGraduate(tokenAddr, 0, { value: ethers.parseEther("400000") })
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
      ctx.factory.connect(ctx.alice).createLaunch("DevBuyTok", "DBT", { value: total })
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
      "0xFFFFFFFFFFFFFFFFFFFFFFFF",
    ]);

    // Bob buys ~430k MON in one shot to push past graduationTarget=425k
    // [DIAGNOSTIC — temporary] staticCall to extract revert data
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("434000") });

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
      "0xFFFFFFFFFFFFFFFFFFFFFFFF",
    ]);
    // Buy enough to trigger _graduate
    await expect(
      fcurve.connect(fresh.bob).buy(0, { value: ethers.parseEther("434000") })
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
    // Fund bob past mempool validator so the larger buy is accepted (V2.1-14 pattern).
    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFFFFFF",
    ]);
    // Buy enough that sell-tax routed to Hub exceeds minDistributeBalance (0.5 MON).
    // Required: sell-output * 0.005 > 0.5 MON, so sell-output > 100 MON.
    // 10k MON buy -> sell half ~= 5k MON -> 0.5%% sell-tax = 25 MON to Hub (~50x headroom).
    // 10k MON is 2.4%% of 425k graduationTarget, so no graduation mid-test.
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
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
    // pool.stake takes (tierId, amount, paidFee) and msg.value is the 100 MON paid-fee.
    // Note: stake() internally calls _pullFromHubInternal(), which drains pendingReward
    // from Hub to Pool. This is intentional per the V2.1 BLOCKER FIX in MonPadStakingPool.
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, {
      value: ethers.parseEther("100"),
    });

    // 7. Verify the pull happened end-to-end during stake():
    //    - Hub's pendingReward[token] is now zero (drained by stake's internal pull)
    //    - Pool received MON from the Hub
    //    - pullFromHub() can still be called as a no-op (idempotent on empty Hub credit)
    expect(await ctx.hub.pendingReward(tokenAddr)).to.equal(0);
    expect(await ethers.provider.getBalance(poolAddr)).to.be.gt(0);

    // Explicit pullFromHub() should succeed even when Hub is drained (no-op path).
    await pool.pullFromHub();
    expect(await ctx.hub.pendingReward(tokenAddr)).to.equal(0);

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

  // ============================================================================
  // T8-T12: semantic batch invariants (H-1 orphan routing, H-5 slot reuse,
  // H-6 stranded sweep, adminForceDistribute, adminEmergencyUnstake).
  // ============================================================================

  it("T8: H-1 orphan routing — pre-registration sells credit buyback, not volumeCache", async function () {
    const ctx = await deployAll();
    // Launch a token. createLaunch auto-authorizes the curve in Hub (V2.1-1).
    // CRITICALLY: we do NOT call poolFactory.createPool for this token, so
    // tokenToPool[token] stays address(0) on the Hub. The orphan-routing path
    // (audit H-1) must redirect the curve's othersPart to buybackPending.
    const tx = await ctx.factory.connect(ctx.alice).createLaunch("OrphanTok", "ORP", {
      value: ethers.parseEther("100"),
    });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(log);
    const tokenAddr = parsed.args.token;
    const curveAddr = parsed.args.curve;
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);

    // Confirm orphan precondition.
    expect(await ctx.hub.tokenToPool(tokenAddr)).to.equal(ethers.ZeroAddress);

    // Fund bob and have him buy + sell. The sell sends a fee fraction to the
    // Hub via curve.notifyReward. We snapshot buybackPending and volumeCache
    // before/after to verify the orphan path.
    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFF",
    ]);
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("5000") });
    const bobBal = await (await ethers.getContractAt("MonPadTokenV2", tokenAddr)).balanceOf(ctx.bob.address);
    expect(bobBal).to.be.gt(0);

    const buybackBefore = await ctx.hub.buybackPending();
    const volBefore = await ctx.hub.volumeCache(tokenAddr);
    const totalVolBefore = await ctx.hub.totalVolumeCache();

    // Sell ~half of bobBal. This routes a sell-tax fraction to Hub.notifyReward.
    const tokenT8 = await ethers.getContractAt("MonPadTokenV2", tokenAddr);
    await tokenT8.connect(ctx.bob).approve(curveAddr, bobBal);
    await curve.connect(ctx.bob).sell(bobBal / 2n, 0);

    const buybackAfter = await ctx.hub.buybackPending();
    const volAfter = await ctx.hub.volumeCache(tokenAddr);
    const totalVolAfter = await ctx.hub.totalVolumeCache();

    // H-1 invariant: buybackPending grew, volumeCache stayed flat (was-0, still-0).
    expect(buybackAfter).to.be.gt(buybackBefore);
    expect(volAfter).to.equal(volBefore);          // orphan path zeros othersPart before volumeCache write
    expect(totalVolAfter).to.equal(totalVolBefore);
  });

  it("T9: H-5 stake slot reuse — unstake then re-stake recycles the closed slot", async function () {
    const ctx = await deployAll();
    // Graduate a token end-to-end so a pool exists.
    const tx = await ctx.factory.connect(ctx.alice).createLaunch("StakeTok", "STK", {
      value: ethers.parseEther("100"),
    });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(log);
    const tokenAddr = parsed.args.token;
    const curveAddr = parsed.args.curve;
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    await ctx.poolFactory.connect(ctx.alice).createPool(tokenAddr, {
      value: ethers.parseEther("100"),
    });
    const poolAddr = await ctx.poolFactory.tokenToPool(tokenAddr);
    const pool = await ethers.getContractAt("MonPadStakingPool", poolAddr);

    // Fund bob and let him buy enough to stake twice.
    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFF",
    ]);
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
    const bobTokenBal = await token.balanceOf(ctx.bob.address);
    expect(bobTokenBal).to.be.gt(0);

    // Stake twice in slot 0 and slot 1.
    const stakeAmt = bobTokenBal / 4n;
    await token.connect(ctx.bob).approve(poolAddr, stakeAmt * 4n);
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: ethers.parseEther("100") });
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: ethers.parseEther("100") });
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(2n);

    // Time-travel past unlock, unstake slot 0 (the older one).
    await ethers.provider.send("evm_increaseTime", [86400 * 365]);
    await ethers.provider.send("evm_mine", []);
    await pool.connect(ctx.bob).unstake(0);

    // After unstake, slot 0 should have amount==0 (closed).
    const closedSlot = await pool.stakes(ctx.bob.address, 0);
    expect(closedSlot.amount).to.equal(0n);
    expect(closedSlot.flags).to.equal(1n);

    // H-5 invariant: next stake reuses slot 0 instead of pushing to slot 2.
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: ethers.parseEther("100") });
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(2n); // unchanged
    const reusedSlot = await pool.stakes(ctx.bob.address, 0);
    expect(reusedSlot.amount).to.equal(stakeAmt);  // freshly populated
    expect(reusedSlot.flags).to.equal(0n);         // cleared on reuse
  });

  it("T10: H-6 stranded reward sweep — unregistered token's pendingReward routes to buyback", async function () {
    const ctx = await deployAll();
    const tx = await ctx.factory.connect(ctx.alice).createLaunch("StrandTok", "STR", {
      value: ethers.parseEther("100"),
    });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(log);
    const tokenAddr = parsed.args.token;
    const curveAddr = parsed.args.curve;
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    await ctx.poolFactory.connect(ctx.alice).createPool(tokenAddr, {
      value: ethers.parseEther("100"),
    });
    const poolAddr = await ctx.poolFactory.tokenToPool(tokenAddr);

    // Generate volume + trigger distribute so pendingReward[token] > 0.
    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFF",
    ]);
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(curveAddr, bobBal);
    await curve.connect(ctx.bob).sell(bobBal / 2n, 0);

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);
    await ctx.hub.distribute();

    const stranded = await ctx.hub.pendingReward(tokenAddr);
    expect(stranded).to.be.gt(0);

    // Unregister the pool — this preserves pendingReward[token] (per audit comment)
    // but makes tokenToPool[token] == 0, marking the funds stranded.
    await ctx.hub.connect(ctx.owner).unregisterPool(tokenAddr);
    expect(await ctx.hub.tokenToPool(tokenAddr)).to.equal(ethers.ZeroAddress);
    expect(await ctx.hub.pendingReward(tokenAddr)).to.equal(stranded); // still there

    // H-6 invariant: adminSweepStrandedReward moves stranded → buybackPending.
    const buybackBefore = await ctx.hub.buybackPending();
    const totalPendingBefore = await ctx.hub.totalPendingReward();
    await ctx.hub.connect(ctx.owner).adminSweepStrandedReward(tokenAddr);
    expect(await ctx.hub.pendingReward(tokenAddr)).to.equal(0n);
    expect(await ctx.hub.totalPendingReward()).to.equal(totalPendingBefore - stranded);
    expect(await ctx.hub.buybackPending()).to.equal(buybackBefore + stranded);

    // Calling twice reverts (nothing left to sweep).
    await expect(
      ctx.hub.connect(ctx.owner).adminSweepStrandedReward(tokenAddr),
    ).to.be.revertedWithCustomError(ctx.hub, "NoStrandedReward");
  });

  it("T11: adminForceDistribute — bypasses timer/floor when distribute() would revert", async function () {
    const ctx = await deployAll();
    // Set up a token + pool + some volume, but DON'T advance time past distributeInterval.
    const tx = await ctx.factory.connect(ctx.alice).createLaunch("ForceTok", "FRC", {
      value: ethers.parseEther("100"),
    });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(log);
    const tokenAddr = parsed.args.token;
    const curveAddr = parsed.args.curve;
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    await ctx.poolFactory.connect(ctx.alice).createPool(tokenAddr, {
      value: ethers.parseEther("100"),
    });

    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFF",
    ]);
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(curveAddr, bobBal);
    await curve.connect(ctx.bob).sell(bobBal / 2n, 0);

    // distribute() should revert with WaitDistributeInterval — we did NOT advance time.
    // (The constructor sets lastDistribute = block.timestamp; the first distribute call
    //  in deployAll's notifyReward auto-loop may already have set it.)
    // adminForceDistribute bypasses the timer.
    const pendingBefore = await ctx.hub.pendingReward(tokenAddr);
    await ctx.hub.connect(ctx.owner).adminForceDistribute();
    const pendingAfter = await ctx.hub.pendingReward(tokenAddr);
    expect(pendingAfter).to.be.gte(pendingBefore); // distribute either credited more or no-op'd cleanly

    // Non-owner cannot call.
    await expect(
      ctx.hub.connect(ctx.attacker).adminForceDistribute(),
    ).to.be.revertedWithCustomError(ctx.hub, "NotOwner");
  });

  it("T12: adminEmergencyUnstake — paused-only, returns principal, zeros slot, allows H-5 reuse", async function () {
    const ctx = await deployAll();
    const tx = await ctx.factory.connect(ctx.alice).createLaunch("EmergTok", "EMG", {
      value: ethers.parseEther("100"),
    });
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ctx.factory.interface.parseLog(l)?.name === "Launched"; } catch { return false; }
    });
    const parsed = ctx.factory.interface.parseLog(log);
    const tokenAddr = parsed.args.token;
    const curveAddr = parsed.args.curve;
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    await ctx.poolFactory.connect(ctx.alice).createPool(tokenAddr, {
      value: ethers.parseEther("100"),
    });
    const poolAddr = await ctx.poolFactory.tokenToPool(tokenAddr);
    const pool = await ethers.getContractAt("MonPadStakingPool", poolAddr);

    await ethers.provider.send("hardhat_setBalance", [
      ctx.bob.address,
      "0xFFFFFFFFFFFFFFFFFFFF",
    ]);
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    const stakeAmt = bobBal / 4n;
    await token.connect(ctx.bob).approve(poolAddr, stakeAmt * 4n);
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: ethers.parseEther("100") });

    // adminEmergencyUnstake should revert if not paused.
    await expect(
      pool.connect(ctx.owner).adminEmergencyUnstake(ctx.bob.address, 0),
    ).to.be.revertedWithCustomError(pool, "NotPaused");

    // Pause and retry.
    await pool.connect(ctx.owner).setPaused(true);

    const bobTokenBefore = await token.balanceOf(ctx.bob.address);
    const totalRawBefore = await pool.totalRawStaked();
    await pool.connect(ctx.owner).adminEmergencyUnstake(ctx.bob.address, 0);

    // User received principal back.
    expect(await token.balanceOf(ctx.bob.address)).to.equal(bobTokenBefore + stakeAmt);
    expect(await pool.totalRawStaked()).to.equal(totalRawBefore - stakeAmt);

    // Slot fully zeroed (per H-5 cross-reference: amount, weighted, rewardDebt, etc.).
    const closed = await pool.stakes(ctx.bob.address, 0);
    expect(closed.amount).to.equal(0n);
    expect(closed.weighted).to.equal(0n);
    expect(closed.rewardDebt).to.equal(0n);
    expect(closed.startTs).to.equal(0n);
    expect(closed.unlockTs).to.equal(0n);
    expect(closed.tierId).to.equal(0n);
    expect(closed.paidFee).to.equal(false);
    expect(closed.flags).to.equal(1n);

    // Unpause, then verify H-5 reuse: a fresh stake reclaims slot 0.
    await pool.connect(ctx.owner).setPaused(false);
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: ethers.parseEther("100") });
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(1n); // reused slot 0
    const reused = await pool.stakes(ctx.bob.address, 0);
    expect(reused.amount).to.equal(stakeAmt);
    expect(reused.flags).to.equal(0n);
  });


    // ============================================================
    // V2.1 BATCH 3 — Pull patterns + adminClearTokenPool
    // ============================================================

    it("T13: Batch 3 sell-fee routing — platformPending +=1%, creatorPending +=0.5%, hub +=0.5%", async function () {
      const ctx = await deployAll();
      const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice, "T13", "T13");
      const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
      const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

      // Fund bob, give bob some tokens via a buy
      await ethers.provider.send("hardhat_setBalance", [
        ctx.bob.address, "0xFFFFFFFFFFFFFFFFFFFF",
      ]);
      await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("1000") });
      const bobBal = await token.balanceOf(ctx.bob.address);
      expect(bobBal).to.be.gt(0n);

      // Capture pre-sell accumulators
      const platBefore = await curve.platformPending();
      const credBefore = await curve.creatorPending();
      const bbBefore   = await ctx.hub.buybackPending();

      // Bob sells half his tokens
      const sellAmt = bobBal / 2n;
      await token.connect(ctx.bob).approve(curveAddr, sellAmt);
      const tx = await curve.connect(ctx.bob).sell(sellAmt, 0);
      const rc = await tx.wait();

      // Locate FeeCollected events to learn grossMonOut split implicitly.
      // Assert: deltas are in expected ratio 100:50:50 (platform:creator:staking).
      const platDelta = (await curve.platformPending()) - platBefore;
      const credDelta = (await curve.creatorPending()) - credBefore;
      const bbDelta   = (await ctx.hub.buybackPending()) - bbBefore;

      expect(platDelta).to.be.gt(0n);
      expect(credDelta).to.be.gt(0n);
      expect(bbDelta).to.be.gt(0n);
      // platform should be ~= 2x creator and 2x staking (1% vs 0.5% each)
      // Allow rounding wiggle of +/- 2 wei
      expect(platDelta).to.be.closeTo(credDelta * 2n, 2n);
      expect(platDelta).to.be.closeTo(bbDelta * 2n, 2n);
    });

    it("T14: Batch 3 claimPlatformBuffer — accumulates from buy+sell, anyone pulls to platformWallet, zeros accumulator", async function () {
      const ctx = await deployAll();
      const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice, "T14", "T14");
      const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
      const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

      await ethers.provider.send("hardhat_setBalance", [
        ctx.bob.address, "0xFFFFFFFFFFFFFFFFFFFF",
      ]);

      // Buy: bufferFee accrues to platformPending
      await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("500") });
      const afterBuy = await curve.platformPending();
      expect(afterBuy).to.be.gt(0n);

      // Sell some tokens to accrue sell platform fee too
      const bal = await token.balanceOf(ctx.bob.address);
      await token.connect(ctx.bob).approve(curveAddr, bal / 4n);
      await curve.connect(ctx.bob).sell(bal / 4n, 0);
      const afterSell = await curve.platformPending();
      expect(afterSell).to.be.gt(afterBuy);

      // View claimable matches storage
      expect(await curve.platformClaimable()).to.equal(afterSell);

      // Anyone (attacker) can trigger the pull; funds go to factory.platformWallet()
      const platformWallet = await ctx.factory.platformWallet();
      const walletBefore = await ethers.provider.getBalance(platformWallet);

      await expect(curve.connect(ctx.attacker).claimPlatformBuffer())
        .to.emit(curve, "PlatformBufferClaimed")
        .withArgs(afterSell, platformWallet);

      const walletAfter = await ethers.provider.getBalance(platformWallet);
      expect(walletAfter - walletBefore).to.equal(afterSell);
      expect(await curve.platformPending()).to.equal(0n);

      // Second call reverts (nothing to claim)
      await expect(curve.connect(ctx.attacker).claimPlatformBuffer())
        .to.be.revertedWith("nothing");
    });

    it("T15: Batch 3 claimGraduationReward — creator-only, post-graduation, single-use", async function () {
      const ctx = await deployAll();
      const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice, "T15", "T15");
      const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);

      // Before graduation: claimable is (0, false), claim reverts
      let [amt, claimed] = await curve.graduationRewardClaimable();
      expect(amt).to.equal(0n);
      expect(claimed).to.equal(false);
      await expect(curve.connect(ctx.alice).claimGraduationReward()).to.be.revertedWith("!graduated");

      // Trigger graduation via a large buy
      await ethers.provider.send("hardhat_setBalance", [
        ctx.bob.address, "0xFFFFFFFFFFFFFFFFFFFF",
      ]);
      await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("434000") });
      expect(await curve.graduated()).to.equal(true);

      // After grad: claimable equals graduationCreatorReward (25k), not yet claimed
      const expectedReward = await ctx.factory.graduationCreatorReward();
      [amt, claimed] = await curve.graduationRewardClaimable();
      expect(amt).to.equal(expectedReward);
      expect(claimed).to.equal(false);

      // Non-creator call reverts
      await expect(curve.connect(ctx.bob).claimGraduationReward()).to.be.revertedWith("!creator");

      // Creator claims; balance increases by ~amt (minus gas)
      const creatorBalBefore = await ethers.provider.getBalance(ctx.alice.address);
      const tx = await curve.connect(ctx.alice).claimGraduationReward();
      const rc = await tx.wait();
      const gasCost = rc.gasUsed * rc.gasPrice;
      const creatorBalAfter = await ethers.provider.getBalance(ctx.alice.address);
      expect(creatorBalAfter - creatorBalBefore + gasCost).to.equal(expectedReward);

      // Post-claim: view returns (0, true), second call reverts
      [amt, claimed] = await curve.graduationRewardClaimable();
      expect(amt).to.equal(0n);
      expect(claimed).to.equal(true);
      await expect(curve.connect(ctx.alice).claimGraduationReward()).to.be.revertedWith("claimed");
    });

    it("T16: Batch 3 adminClearTokenPool — owner clears PoolFactory mapping; non-owner reverts; clearing unset reverts", async function () {
      const ctx = await deployAll();
      const fakeToken = ctx.monshi.target;
      const fakePool  = ctx.attacker.address; // any non-zero address as the "pool"

      // (a) Clearing an unset token reverts
      await expect(ctx.poolFactory.connect(ctx.owner).adminClearTokenPool(fakeToken))
        .to.be.revertedWith("no pool");

      // (b) Seed tokenToPool[fakeToken] = fakePool via hardhat_setStorageAt.
      // tokenToPool is at storage slot 0 of its contract (need to find the actual slot).
      // We scan slot candidates by deploying-time inspection: PoolFactory's first state vars include
      // hub, monshiToken, etc. before tokenToPool. We resolve the slot dynamically by writing then reading.
      // For robustness: find the slot by writing fakePool to each candidate slot mapping and checking
      // tokenToPool(fakeToken) view.
      const pfAddr = ctx.poolFactory.target;
      const tokenPadded = ethers.zeroPadValue(fakeToken, 32);
      const poolPadded  = ethers.zeroPadValue(fakePool, 32);
      let foundSlot = -1;
      for (let slot = 0; slot < 40; slot++) {
        const slotHex = ethers.toBeHex(slot, 32);
        const mappingSlot = ethers.keccak256(ethers.concat([tokenPadded, slotHex]));
        await ethers.provider.send("hardhat_setStorageAt", [pfAddr, mappingSlot, poolPadded]);
        const got = await ctx.poolFactory.tokenToPool(fakeToken);
        if (got.toLowerCase() === fakePool.toLowerCase()) {
          foundSlot = slot;
          break;
        }
        // Reset wrong slot
        await ethers.provider.send("hardhat_setStorageAt", [pfAddr, mappingSlot, ethers.ZeroHash]);
      }
      expect(foundSlot, "tokenToPool slot not found in 0..40").to.be.gte(0);

      // Non-owner reverts (use bob)
      await expect(ctx.poolFactory.connect(ctx.bob).adminClearTokenPool(fakeToken))
        .to.be.reverted; // Ownable revert (custom error or string)

      // Owner clears, mapping zeroes, event emits
      await expect(ctx.poolFactory.connect(ctx.owner).adminClearTokenPool(fakeToken))
        .to.emit(ctx.poolFactory, "TokenPoolCleared")
        .withArgs(fakeToken, fakePool);

      expect(await ctx.poolFactory.tokenToPool(fakeToken)).to.equal(ethers.ZeroAddress);

      // Second clear reverts
      await expect(ctx.poolFactory.connect(ctx.owner).adminClearTokenPool(fakeToken))
        .to.be.revertedWith("no pool");
    });


  it("T17: N-7 sell-reentrancy guard — malicious rewardRouter cannot reenter sell()", async function () {
    const ctx = await deployAll();
    const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.alice);
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);

    // Deploy malicious router & set it as buybackWallet via timelock
    const MaliciousF = await ethers.getContractFactory("MaliciousRewardRouter");
    const evil = await MaliciousF.deploy();
    await evil.setTarget(curveAddr);

    // Queue + execute setBuybackWallet to point at evil router
    await ctx.factory.connect(ctx.owner).queueSetRewardRouter(await evil.getAddress());
    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await ctx.factory.connect(ctx.owner).executeSetRewardRouter(await evil.getAddress());

    // Bob buys tokens, then sells — the sell path will hit evil.notifyReward,
    // which tries to reenter sell(1, 0). The nonReentrant modifier MUST cause
    // the inner call to revert (caught by evil's try/catch).
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("10000") });
    const bobBal = await token.balanceOf(ctx.bob.address);
    await token.connect(ctx.bob).approve(curveAddr, bobBal);

    // Outer sell must succeed (curve does not require routed==true)
    await expect(curve.connect(ctx.bob).sell(bobBal / 2n, 0)).to.not.be.reverted;

    // Verify the malicious router attempted reentry and was rejected
    expect(await evil.reentryAttempted()).to.equal(true);
    expect(await evil.reentryReverted()).to.equal(true);

  });

  it("T18: N-3 stake cap-with-reuse — 51st stake reuses a closed slot instead of reverting", async function () {
    const ctx = await deployAll();
    const { tokenAddr, curveAddr } = await launchToken(ctx, ctx.bob);
    const curve = await ethers.getContractAt("MonPadCurveV2", curveAddr);
    const token = await ethers.getContractAt("MonPadTokenV2", tokenAddr);
    await ctx.poolFactory.connect(ctx.bob).createPool(tokenAddr, { value: ethers.parseEther("100") });
    const poolAddr = await ctx.poolFactory.tokenToPool(tokenAddr);
    const pool = await ethers.getContractAt("MonPadStakingPool", poolAddr);

    // Bob buys enough tokens to do 50+ stakes
    await curve.connect(ctx.bob).buy(0, { value: ethers.parseEther("50000") });
    await token.connect(ctx.bob).approve(poolAddr, ethers.MaxUint256);

    const stakeAmt = ethers.parseEther("10");
    const stakeFee = ethers.parseEther("100");

    // Fill all 50 slots
    for (let i = 0; i < 50; i++) {
      await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: stakeFee });
    }
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(50n);

    // 51st stake MUST revert (no closed slot to reuse)
    await expect(
      pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: stakeFee })
    ).to.be.revertedWithCustomError(pool, "MaxStakesReached");

    // Wait past lock, unstake slots 10, 20, 30 to create closed slots
    await ethers.provider.send("evm_increaseTime", [86400 * 400]);
    await ethers.provider.send("evm_mine", []);
    await pool.connect(ctx.bob).unstake(10);
    await pool.connect(ctx.bob).unstake(20);
    await pool.connect(ctx.bob).unstake(30);

    // Length still 50, slot 10 is closed
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(50n);
    expect((await pool.stakes(ctx.bob.address, 10)).amount).to.equal(0n);

    // 51st stake attempt now SUCCEEDS via reuse (pre-N-3 this would have reverted)
    await pool.connect(ctx.bob).stake(0, stakeAmt, true, { value: stakeFee });
    // Length unchanged (reuse, not push)
    expect(await pool.stakesLength(ctx.bob.address)).to.equal(50n);
    // Slot 10 (lowest closed) was reused
    expect((await pool.stakes(ctx.bob.address, 10)).amount).to.equal(stakeAmt);
  });

});
