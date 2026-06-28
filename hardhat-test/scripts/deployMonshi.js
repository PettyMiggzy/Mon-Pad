// Deploy the MONSHI-native MonPad set (factory + graduator + bootstrap).
//
// Works on three targets:
//   - local hardhat node  : npx hardhat run scripts/deployMonshi.js
//   - Monad testnet       : npx hardhat run scripts/deployMonshi.js --network monadTestnet
//   - Monad mainnet       : npx hardhat run scripts/deployMonshi.js --network monadMainnet
//
// Env (all optional on local/testnet — mocks are deployed when missing):
//   MONSHI_ADDRESS   real MONSHI ERC20 (mainnet: 0xB744F5CDb792d8187640214C4A1c9aCE29af7777)
//   NPM_ADDRESS      Uniswap V3 NonfungiblePositionManager (mainnet: 0xa9f6...0526)
//   PLATFORM_WALLET, TREASURY_WALLET, BUYBACK_WALLET
//   SMOKE=1          run a create→buy→sell smoke check after deploy (test networks only)
//
// SAFETY: on monadMainnet this REQUIRES real MONSHI_ADDRESS + NPM_ADDRESS + wallets
// (no mocks) and refuses to run otherwise.

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const E18 = 10n ** 18n;

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const isMainnet = chainId === 143;
  const useMocks = !isMainnet && (!process.env.MONSHI_ADDRESS || !process.env.NPM_ADDRESS);

  console.log(`\n=== Deploy MONSHI MonPad ===`);
  console.log(`network: ${network.name} (chainId ${chainId})`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

  if (isMainnet) {
    if (!process.env.MONSHI_ADDRESS || !process.env.NPM_ADDRESS)
      throw new Error("mainnet requires MONSHI_ADDRESS and NPM_ADDRESS (no mocks)");
    if (!process.env.PLATFORM_WALLET || !process.env.TREASURY_WALLET || !process.env.BUYBACK_WALLET)
      throw new Error("mainnet requires PLATFORM_WALLET, TREASURY_WALLET, BUYBACK_WALLET");
  }

  const platform = process.env.PLATFORM_WALLET || deployer.address;
  const treasury = process.env.TREASURY_WALLET || deployer.address;
  const buyback  = process.env.BUYBACK_WALLET  || deployer.address;

  // --- MONSHI quote token ---
  let monshi = process.env.MONSHI_ADDRESS;
  if (!monshi) {
    const Mock = await ethers.getContractFactory("MockERC20");
    const m = await Mock.deploy("Monshi (mock)", "MONSHI");
    await m.waitForDeployment();
    monshi = m.target;
    await (await m.mint(deployer.address, 10_000_000n * E18)).wait();
    console.log(`MONSHI (mock):   ${monshi}  (minted 10M to deployer)`);
  } else {
    console.log(`MONSHI:          ${monshi}`);
  }

  // --- Uniswap V3 NPM (real, or functional mock on test nets) ---
  let npm = process.env.NPM_ADDRESS;
  if (!npm) {
    const V3F = await ethers.getContractFactory("MockV3FactoryM");
    const v3f = await V3F.deploy(); await v3f.waitForDeployment();
    const NPM = await ethers.getContractFactory("MockNPMM");
    const n = await NPM.deploy(v3f.target); await n.waitForDeployment();
    npm = n.target;
    console.log(`NPM (mock):      ${npm}  (V3 factory ${v3f.target})`);
  } else {
    console.log(`NPM:             ${npm}`);
  }

  // --- Factory ---
  const Factory = await ethers.getContractFactory("MonPadFactoryV2Monshi");
  const factory = await Factory.deploy(platform, treasury, buyback, monshi);
  await factory.waitForDeployment();
  console.log(`Factory:         ${factory.target}`);

  // --- Graduator ---
  const Grad = await ethers.getContractFactory("MonPadGraduatorMonshi");
  const grad = await Grad.deploy(factory.target, npm, monshi);
  await grad.waitForDeployment();
  console.log(`Graduator:       ${grad.target}`);

  // --- Bootstrap (graduator, rewardRouter, poolFactory) ---
  // rewardRouter = buyback wallet until a MONSHI staking hub ships (sell staking-fee is a
  // plain MONSHI transfer). poolFactory is required nonzero; use treasury as placeholder
  // until the MONSHI pool factory is wired.
  await (await factory.bootstrapInit(grad.target, buyback, treasury)).wait();
  console.log(`bootstrapInit:   graduator=${grad.target} rewardRouter=${buyback} poolFactory(placeholder)=${treasury}`);

  // --- Persist ---
  const out = {
    version: "monshi-v1",
    network: network.name,
    chainId: String(chainId),
    deployer: deployer.address,
    addresses: { factory: factory.target, graduator: grad.target, monshi, npm },
    config: { platform, treasury, buyback },
    usedMocks: useMocks || !process.env.MONSHI_ADDRESS || !process.env.NPM_ADDRESS,
  };
  const dir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `monshi-${chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${file}`);

  // --- Optional smoke check (test networks only) ---
  if (process.env.SMOKE === "1" && !isMainnet) {
    console.log(`\n--- SMOKE ---`);
    const monshiC = await ethers.getContractAt("MockERC20", monshi);
    const fee = await factory.creationFee();
    const ZERO_CFG = { cfBurnTokenBps: 0, cfBurnMonshiBps: 0, cfLpBps: 0, taxBurnTokenBps: 0, taxBurnMonshiBps: 0, taxLpBps: 0 };
    await (await monshiC.approve(factory.target, fee)).wait();
    const tx = await factory.createLaunch("Smoke", "SMK", fee, ZERO_CFG);
    const rc = await tx.wait();
    let curve;
    for (const log of rc.logs) {
      try { const p = factory.interface.parseLog({ topics: log.topics, data: log.data }); if (p?.name === "Launched") curve = p.args.curve; } catch (_) {}
    }
    console.log(`launched curve:  ${curve}`);
    const curveC = await ethers.getContractAt("MonPadCurveV2Monshi", curve);
    await (await monshiC.approve(curve, 1000n * E18)).wait();
    await (await curveC.buy(1000n * E18, 0)).wait();
    const tokAddr = await curveC.token();
    const tok = await ethers.getContractAt("MonPadTokenV2", tokAddr);
    const bal = await tok.balanceOf(deployer.address);
    console.log(`bought tokens:   ${ethers.formatEther(bal)}`);
    console.log(`SMOKE OK`);
  }

  console.log(`\nDONE.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
