const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ENV = process.env;
const REQUIRED = ["DEPLOYER_KEY", "PLATFORM_WALLET", "TREASURY_WALLET", "BUYBACK_WALLET",
                  "WMON_ADDRESS", "NPM_ADDRESS", "MONSHI_ADDRESS"];

async function main() {
  // ── Pre-flight ──
  const missing = REQUIRED.filter(k => !ENV[k]);
  if (missing.length) {
    console.error("Missing required env vars:", missing.join(", "));
    process.exit(1);
  }

  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("══════════════════════════════════════════════════");
  console.log(`  MonPad V2.1 Deploy`);
  console.log("══════════════════════════════════════════════════");
  console.log(`  Network:    ${network} (chainId ${chainId})`);
  console.log(`  Deployer:   ${deployer.address}`);
  console.log(`  Balance:    ${hre.ethers.formatEther(balance)} MON`);
  console.log(`  Platform:   ${ENV.PLATFORM_WALLET}`);
  console.log(`  Treasury:   ${ENV.TREASURY_WALLET}`);
  console.log(`  Buyback:    ${ENV.BUYBACK_WALLET}`);
  console.log(`  WMON:       ${ENV.WMON_ADDRESS}`);
  console.log(`  NPM:        ${ENV.NPM_ADDRESS}`);
  console.log(`  MONSHI:     ${ENV.MONSHI_ADDRESS}`);
  console.log("══════════════════════════════════════════════════\n");

  if (balance < hre.ethers.parseEther("1")) {
    console.error("Deployer balance is under 1 MON. Aborting.");
    process.exit(1);
  }

  const deployed = {};

  // ── 1. Factory ──
  console.log("→ Deploying MonPadFactoryV2...");
  const Factory = await hre.ethers.getContractFactory("MonPadFactoryV2");
  const factory = await Factory.deploy(ENV.PLATFORM_WALLET, ENV.TREASURY_WALLET, ENV.BUYBACK_WALLET);
  await factory.waitForDeployment();
  deployed.factory = await factory.getAddress();
  deployed.factoryTx = factory.deploymentTransaction().hash;
  console.log(`  ✓ Factory: ${deployed.factory}\n`);

  // ── 2. Staking Hub ──
  console.log("→ Deploying MonPadStakingHub...");
  const Hub = await hre.ethers.getContractFactory("MonPadStakingHub");
  const hub = await Hub.deploy(deployed.factory, 3600, hre.ethers.parseEther("0.5"));
  await hub.waitForDeployment();
  deployed.stakingHub = await hub.getAddress();
  deployed.hubTx = hub.deploymentTransaction().hash;
  console.log(`  ✓ Hub: ${deployed.stakingHub}\n`);

  // ── 3. Pool Factory ──
  console.log("→ Deploying MonPadPoolFactory...");
  const PoolFactory = await hre.ethers.getContractFactory("MonPadPoolFactory");
  const poolFactory = await PoolFactory.deploy(deployed.stakingHub, deployed.factory, ENV.MONSHI_ADDRESS);
  await poolFactory.waitForDeployment();
  deployed.poolFactory = await poolFactory.getAddress();
  deployed.poolFactoryTx = poolFactory.deploymentTransaction().hash;
  console.log(`  ✓ PoolFactory: ${deployed.poolFactory}\n`);

  // ── 4. Graduator ──
  console.log("→ Deploying MonPadGraduator...");
  const Graduator = await hre.ethers.getContractFactory("MonPadGraduator");
  const graduator = await Graduator.deploy(deployed.factory, ENV.NPM_ADDRESS, ENV.WMON_ADDRESS);
  await graduator.waitForDeployment();
  deployed.graduator = await graduator.getAddress();
  deployed.graduatorTx = graduator.deploymentTransaction().hash;
  console.log(`  ✓ Graduator: ${deployed.graduator}\n`);

  // ── 5. Bootstrap wiring ──
  console.log("→ Wiring: factory.bootstrapInit(graduator, hub, poolFactory)...");
  const tx1 = await factory.bootstrapInit(deployed.graduator, deployed.stakingHub, deployed.poolFactory);
  await tx1.wait();
  console.log(`  ✓ Bootstrap tx: ${tx1.hash}\n`);

  console.log("→ Wiring: hub.bootstrapMonshi(MONSHI)...");
  const tx2 = await hub.bootstrapMonshi(ENV.MONSHI_ADDRESS);
  await tx2.wait();
  console.log(`  ✓ MONSHI pin tx: ${tx2.hash}\n`);

  // ── 6. Read back impl addresses ──
  deployed.curveImpl = await factory.curveImpl();
  deployed.tokenImpl = await factory.tokenImpl();
  deployed.poolImpl = await poolFactory.poolImpl();

  // ── 7. Write output ──
  const currentBlock = await hre.ethers.provider.getBlockNumber();
  const output = {
    version: "v2.1",
    network,
    chainId: chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    block: currentBlock,
    addresses: {
      factory: deployed.factory,
      stakingHub: deployed.stakingHub,
      poolFactory: deployed.poolFactory,
      graduator: deployed.graduator,
      swap: null,
      curveImpl: deployed.curveImpl,
      tokenImpl: deployed.tokenImpl,
      poolImpl: deployed.poolImpl,
    },
    config: {
      platform: ENV.PLATFORM_WALLET,
      treasury: ENV.TREASURY_WALLET,
      buyback: ENV.BUYBACK_WALLET,
      wmon: ENV.WMON_ADDRESS,
      npm: ENV.NPM_ADDRESS,
      monshi: ENV.MONSHI_ADDRESS,
    },
    transactions: {
      factory: deployed.factoryTx,
      hub: deployed.hubTx,
      poolFactory: deployed.poolFactoryTx,
      graduator: deployed.graduatorTx,
      bootstrap: tx1.hash,
      monshiPin: tx2.hash,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${network}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  const latestPath = path.join(outDir, `${network}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));

  console.log("══════════════════════════════════════════════════");
  console.log(`  Deploy complete. Output:`);
  console.log(`  ${outPath}`);
  console.log(`  ${latestPath}`);
  console.log("══════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n✗ Deploy failed:");
  console.error(err);
  process.exit(1);
});
