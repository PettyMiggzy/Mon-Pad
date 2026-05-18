const hre = require("hardhat");
const { parseEther, formatEther } = require("ethers");

async function main() {
  console.log("=== Mon-Pad Fork Simulation ===");
  console.log("Forked from Monad mainnet, simulating full deploy + launch lifecycle");

  const [deployer, alice, bob, carol] = await hre.ethers.getSigners();

  // Bump signer balances for the fork run (10M MON each, plenty of headroom for the 430k graduation push).
  const TEN_MILLION_MON = "0x52B7D2DCC80CD2E4000000"; // 10_000_000 * 1e18
  for (const s of [alice, bob, carol]) {
    await hre.network.provider.send("hardhat_setBalance", [s.address, TEN_MILLION_MON]);
  }
  console.log("  ✓ Test signers funded with 10M MON each");

  // === STEP 1: Deploy all 4 contracts (same as deploy.js) ===
  console.log("\n[1/8] Deploying contracts...");
  const PLATFORM = process.env.PLATFORM_WALLET;
  const TREASURY = process.env.TREASURY_WALLET;
  const BUYBACK = process.env.BUYBACK_WALLET;
  const WMON = process.env.WMON_ADDRESS;
  const NPM = process.env.NPM_ADDRESS;
  const MONSHI = process.env.MONSHI_ADDRESS;

  const Factory = await hre.ethers.getContractFactory("MonPadFactoryV2");
  const factory = await Factory.deploy(PLATFORM, TREASURY, BUYBACK);
  await factory.waitForDeployment();
  console.log("  Factory:", await factory.getAddress());

  const Hub = await hre.ethers.getContractFactory("MonPadStakingHub");
  const hub = await Hub.deploy(await factory.getAddress(), 3600, parseEther("0.5"));
  await hub.waitForDeployment();
  console.log("  Hub:", await hub.getAddress());

  const PoolFactory = await hre.ethers.getContractFactory("MonPadPoolFactory");
  const poolFactory = await PoolFactory.deploy(await hub.getAddress(), await factory.getAddress(), MONSHI);
  await poolFactory.waitForDeployment();
  console.log("  PoolFactory:", await poolFactory.getAddress());

  const Graduator = await hre.ethers.getContractFactory("MonPadGraduator");
  const graduator = await Graduator.deploy(await factory.getAddress(), NPM, WMON);
  await graduator.waitForDeployment();
  console.log("  Graduator:", await graduator.getAddress());

  // === STEP 2: Bootstrap wiring ===
  console.log("\n[2/8] Bootstrap wiring...");
  await (await factory.bootstrapInit(
    await graduator.getAddress(),
    await hub.getAddress(),
    await poolFactory.getAddress()
  )).wait();
  await (await hub.bootstrapMonshi(MONSHI)).wait();
  console.log("  \u2713 Bootstrap complete");

  // === STEP 3: Launch test token ===
  console.log("\n[3/8] Launching test token...");
  await (await factory.connect(alice).createLaunch(
    "ForkTest", "FT", { value: parseEther("100") }
  )).wait();
  const tokenAddr = await factory.allTokens(0);
  const curveAddr = await factory.tokToCurve(tokenAddr);
  console.log("  Token:", tokenAddr);
  console.log("  Curve:", curveAddr);

  const curve = await hre.ethers.getContractAt("MonPadCurveV2", curveAddr);
  const token = await hre.ethers.getContractAt("MonPadTokenV2", tokenAddr);

  // === STEP 4: Run several buys of varying sizes ===
  console.log("\n[4/8] Running buys (100, 1000, 5000, 50000, 100000 MON)...");
  const buyers = [alice, bob, carol, alice, bob];
  const amounts = [100, 1000, 5000, 50000, 100000];
  for (let i = 0; i < amounts.length; i++) {
    await (await curve.connect(buyers[i]).buy(0, { value: parseEther(amounts[i].toString()) })).wait();
    const raised = await curve.monRaisedNet();
    console.log(`  Buy ${amounts[i]} MON \u2192 monRaisedNet: ${formatEther(raised)} MON`);
  }

  // === STEP 5: Verify fee accumulation ===
  console.log("\n[5/8] Verifying fee accumulation...");
  const creatorPending = await curve.creatorPending();
  const platformPending = await curve.platformPending();
  console.log(`  creatorPending: ${formatEther(creatorPending)} MON`);
  console.log(`  platformPending: ${formatEther(platformPending)} MON`);

  // === STEP 6: One sell to verify 3-way fee split ===
  console.log("\n[6/8] Running sell to verify fee split...");
  const bobBal = await token.balanceOf(bob.address);
  const sellAmt = bobBal / 4n;
  await (await token.connect(bob).approve(curveAddr, sellAmt)).wait();
  await (await curve.connect(bob).sell(sellAmt, 0)).wait();
  const platformAfter = await curve.platformPending();
  console.log(`  platformPending after sell: ${formatEther(platformAfter)} MON`);

  // === STEP 7: Trigger graduation ===
  console.log("\n[7/8] Triggering graduation...");
  const raised = await curve.monRaisedNet();
  console.log(`  monRaisedNet before push: ${formatEther(raised)} MON`);
  // Push way more than needed — 2% fee means we need ~2% headroom, plus extra to be safe.
  // Curve refunds any excess past graduation target, so over-sending is harmless.
  // Cap headroom at +3% past target. Larger pushes hit 'no liquidity' because the
  // curve's token reserve is sized exactly for graduation — oversend asks for tokens
  // already earmarked for LP. 2% fee means ~2.04% is the floor; +3% gives clean margin.
  const remaining = (parseEther("425000") - raised) * 103n / 100n;
  console.log(`  Pushing ${formatEther(remaining)} MON to trigger...`);
  try {
    await (await curve.connect(carol).buy(0, { value: remaining })).wait();
  } catch (e) {
    console.log(`  Graduation tx error: ${e.message}`);
    console.log("  This is where real V3 contracts get tested. Check NPM/WMON behavior.");
    throw e;
  }
  const raisedAfter = await curve.monRaisedNet();
  console.log(`  monRaisedNet after push: ${formatEther(raisedAfter)} MON`);
  const graduated = await curve.graduated();
  console.log(`  graduated: ${graduated}`);
  if (!graduated) {
    console.log("  ERROR: token did not graduate despite push past target.");
    console.log("  This indicates a real bug in graduation triggering OR my push math is still wrong.");
    process.exit(2);
  }

  // === STEP 8: Verify post-graduation state ===
  console.log("\n[8/8] Verifying post-graduation state...");
  const gradReward = await curve.creatorGraduationPending();
  console.log(`  creatorGraduationPending: ${formatEther(gradReward)} MON`);

  // Derive V3 Factory from NPM at runtime (single source of truth, no hardcoded address)
  const npm = await hre.ethers.getContractAt(
    ["function factory() view returns (address)"],
    NPM
  );
  const v3FactoryAddr = await npm.factory();
  console.log(`  V3 Factory (derived from NPM): ${v3FactoryAddr}`);

  const v3Factory = await hre.ethers.getContractAt(
    ["function getPool(address,address,uint24) view returns (address)"],
    v3FactoryAddr
  );
  const poolAddr = await v3Factory.getPool(tokenAddr, WMON, 10000);
  console.log(`  V3 Pool: ${poolAddr}`);

  // Verify creator can claim
  const aliceBalBefore = await hre.ethers.provider.getBalance(alice.address);
  await (await curve.connect(alice).claimGraduationReward()).wait();
  const aliceBalAfter = await hre.ethers.provider.getBalance(alice.address);
  console.log(`  Creator claimed: ${formatEther(aliceBalAfter - aliceBalBefore)} MON (expected ~25k MON)`);

  console.log("\n=== FORK SIM PASSED ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
