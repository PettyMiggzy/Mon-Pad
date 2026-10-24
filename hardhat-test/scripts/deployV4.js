// Deploy MonpadLauncher V4. NOT AUDITED: do not deploy to mainnet with real value before an audit.
//
//   MAINNET_RPC=...  DEPLOYER_KEY=0x...  npx hardhat run scripts/deployV4.js --network monadMainnet
//
// Env:
//   OWNER_ADDRESS         owner (use a multisig; Ownable2Step: the owner must accept after a transfer)
//   PLATFORM_ADDRESS      receives the platform 10% and the creation fees
//   START_MCAP_MON        starting market cap in MON (default 250000)
//   CREATION_FEE_MON      creation fee in MON (default 100, max 10000)
//   MONSHI_FEE_TIER       Uniswap fee tier of the MONSHI/WMON pool to buy-and-burn on (default 10000)
//   CONFIRM_MAINNET       must equal I_UNDERSTAND_UNAUDITED to deploy on chain 143
const hre = require("hardhat");
const { params } = require("./v4-params");

const NPM = "0x7197e214c0b767cfb76fb734ab638e2c192f4e53"; // official Uniswap V3 NonfungiblePositionManager on Monad
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  if (net.chainId === 143n && process.env.CONFIRM_MAINNET !== "I_UNDERSTAND_UNAUDITED") {
    throw new Error("Refusing to deploy to Monad mainnet: set CONFIRM_MAINNET=I_UNDERSTAND_UNAUDITED (contracts are not audited).");
  }
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const platform = process.env.PLATFORM_ADDRESS || deployer.address;
  if (net.chainId === 143n && owner.toLowerCase() === deployer.address.toLowerCase()) {
    console.warn("WARNING: owner is the deployer. Use a multisig for OWNER_ADDRESS.");
  }
  const p = params(process.env.START_MCAP_MON || 250000);
  const fee = ethers.parseEther(process.env.CREATION_FEE_MON || "100");
  const tier = Number(process.env.MONSHI_FEE_TIER || 10000);

  console.log("chain", net.chainId.toString(), "| deployer", deployer.address);
  console.log("start mcap ~", p.effectiveMcapMon.toFixed(0), "MON | startTick", p.startTick, "| creation fee", ethers.formatEther(fee), "MON");

  const F = await ethers.getContractFactory("MonpadLauncher");
  const launcher = await F.deploy(owner, platform, NPM, MONSHI, p.startTick, p.sqrtAtStartTick, p.sqrtAtNegStartTick, fee, tier);
  await launcher.waitForDeployment();
  const addr = await launcher.getAddress();
  const pool = await launcher.monshiPool();

  console.log("\nMonpadLauncher:", addr);
  console.log("MONSHI buyback pool:", pool === ethers.ZeroAddress ? "NONE (MONSHI buybacks disabled until a pool exists)" : pool);
  console.log("\nVercel env:\n  NEXT_PUBLIC_LAUNCHER_V4=" + addr);
  console.log("\nVerify:\n  npx hardhat verify --network monadMainnet", addr, owner, platform, NPM, MONSHI, p.startTick, p.sqrtAtStartTick, p.sqrtAtNegStartTick, fee.toString(), tier);
}

main().catch((e) => { console.error(e); process.exit(1); });
