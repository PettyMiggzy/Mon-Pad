// Deploy the native-MON MonPad V3 set (factory + graduator + bootstrap).
//
//   local smoke : SMOKE=1 npx hardhat run scripts/deployV3.js
//   testnet     : npx hardhat run scripts/deployV3.js --network monadTestnet
//   mainnet     : npx hardhat run scripts/deployV3.js --network monadMainnet
//
// Env (REQUIRED on mainnet — no mocks there):
//   PLATFORM_WALLET, TREASURY_WALLET, BUYBACK_WALLET   (wallets YOU control)
//   WMON_ADDRESS   (mainnet 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A)
//   NPM_ADDRESS    (mainnet 0xa9f6B6656e32F223d778b01642F32D00F5310526)
//   MONSHI_ADDRESS (mainnet 0xB744F5CDb792d8187640214C4A1c9aCE29af7777, optional — discount perk)
// Optional economics overrides (wei): CREATION_FEE, GRAD_TARGET, GRAD_CREATOR_REWARD, GRAD_TREASURY_CUT
// SMOKE=1 runs a create->buy(->graduate on local) sanity pass (test networks only).

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const E18 = 10n ** 18n;
const ZERO_CFG = { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 0, taxLpBps: 0 };

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isMainnet = chainId === 143;

  console.log(`\n=== Deploy MonPad V3 (native MON) ===`);
  console.log(`network ${network.name} (chainId ${chainId})  deployer ${deployer.address}`);
  console.log(`balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MON`);

  if (isMainnet) {
    for (const k of ["PLATFORM_WALLET", "TREASURY_WALLET", "BUYBACK_WALLET", "WMON_ADDRESS", "NPM_ADDRESS"]) {
      if (!process.env[k]) throw new Error(`mainnet requires ${k}`);
    }
  }

  const platform = process.env.PLATFORM_WALLET || deployer.address;
  const treasury = process.env.TREASURY_WALLET || deployer.address;
  const buyback  = process.env.BUYBACK_WALLET  || deployer.address;

  // WMON
  let wmon = process.env.WMON_ADDRESS;
  if (!wmon) {
    const W = await ethers.getContractFactory("MockWMONV3");
    const w = await W.deploy(); await w.waitForDeployment(); wmon = w.target;
    console.log(`WMON (mock):   ${wmon}`);
  } else console.log(`WMON:          ${wmon}`);

  // NPM (Uniswap V3 position manager)
  let npm = process.env.NPM_ADDRESS;
  if (!npm) {
    const V3F = await ethers.getContractFactory("MockV3FactoryM");
    const v3f = await V3F.deploy(); await v3f.waitForDeployment();
    const N = await ethers.getContractFactory("MockNPMM");
    const n = await N.deploy(v3f.target); await n.waitForDeployment(); npm = n.target;
    console.log(`NPM (mock):    ${npm}`);
  } else console.log(`NPM:           ${npm}`);

  // MONSHI (optional discount perk)
  let monshi = process.env.MONSHI_ADDRESS || ethers.ZeroAddress;
  if (monshi === ethers.ZeroAddress && !isMainnet) {
    const M = await ethers.getContractFactory("MockERC20");
    const m = await M.deploy("Monshi", "MONSHI"); await m.waitForDeployment(); monshi = m.target;
    console.log(`MONSHI (mock): ${monshi}`);
  } else console.log(`MONSHI:        ${monshi}`);

  // Factory + graduator
  const Factory = await ethers.getContractFactory("MonPadFactoryV3");
  const factory = await Factory.deploy(platform, treasury, buyback, wmon, monshi);
  await factory.waitForDeployment();
  console.log(`Factory:       ${factory.target}`);

  const Grad = await ethers.getContractFactory("MonPadGraduatorV3");
  const grad = await Grad.deploy(factory.target, npm, wmon);
  await grad.waitForDeployment();
  console.log(`Graduator:     ${grad.target}`);

  // Optional economics overrides require the 24h timelock, so they can't be applied at deploy.
  // The factory ships with $5k-pegged defaults (260k/41.7k/10.4k MON, 500 MON creation fee).
  // To change them post-deploy: queueSet*/executeSet* after the timelock.

  await (await factory.bootstrapInit(grad.target, buyback)).wait();
  console.log(`bootstrapInit: graduator=${grad.target} rewardRouter(buyback)=${buyback}`);

  const out = {
    version: "v3-native-mon",
    network: network.name,
    chainId: String(chainId),
    deployer: deployer.address,
    addresses: { factory: factory.target, graduator: grad.target, curveImpl: await factory.curveImpl(), tokenImpl: await factory.tokenImpl(), wmon, npm, monshi },
    config: {
      platform, treasury, buyback,
      creationFee: (await factory.creationFee()).toString(),
      graduationTarget: (await factory.graduationTarget()).toString(),
      graduationCreatorReward: (await factory.graduationCreatorReward()).toString(),
      graduationTreasuryCut: (await factory.graduationTreasuryCut()).toString(),
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `v3-${chainId}.json`), JSON.stringify(out, null, 2));
  console.log(`\nwrote deployments/v3-${chainId}.json`);

  if (process.env.SMOKE === "1" && !isMainnet) {
    console.log(`\n--- SMOKE ---`);
    const fee = await factory.creationFee();
    const tx = await factory.createLaunch("Smoke", "SMK", ZERO_CFG, { value: fee });
    const rc = await tx.wait();
    let curve;
    for (const log of rc.logs) { try { const p = factory.interface.parseLog({ topics: log.topics, data: log.data }); if (p?.name === "Launch") curve = p.args.curve; } catch (_) {} }
    const c = await ethers.getContractAt("MonPadCurveV3", curve);
    await (await c.buy(0, { value: 100n * E18 })).wait();
    console.log(`launched ${curve}, bought; realMonReserve=${ethers.formatEther(await c.realMonReserve())} MON`);
    console.log(`SMOKE OK`);
  }

  console.log(`\nDONE.`);
  if (isMainnet) {
    console.log(`\n⚠️  Deployer is OWNER. Transfer ownership to a wallet you keep BEFORE discarding the burner:`);
    console.log(`    factory.transferOwnership(<your hw wallet>) then acceptOwnership() from that wallet.`);
    console.log(`    Also verify all 5 contracts on the explorer for the DexScreener parser request.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
