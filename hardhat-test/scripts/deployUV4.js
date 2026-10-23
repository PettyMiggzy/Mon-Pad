// Deploy MonpadHook + MonpadHookLauncher (Uniswap V4). NOT AUDITED: do not deploy to mainnet with real value before an audit.
//
//   MAINNET_RPC=...  DEPLOYER_KEY=0x...  npx hardhat run scripts/deployUV4.js --network monadMainnet
//
// Env:
//   OWNER_ADDRESS      owner (use a multisig; Ownable2Step: the owner must accept after a transfer)
//   PLATFORM_ADDRESS   receives the platform 10% and the creation fees
//   START_MCAP_MON     starting market cap in MON (default 250000)
//   CREATION_FEE_MON   creation fee in MON (default 100, max 10000)
//   KEEPER_ADDRESS     optional: bot allowed to run MONSHI buybacks (can be set later with setKeeper)
//   CONFIRM_MAINNET    must equal I_UNDERSTAND_UNAUDITED to deploy on chain 143
const hre = require("hardhat");
const { uv4StartTick, params } = require("./v4-params");
const { deployHookAndLauncher } = require("./mine-hook");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e"; // Uniswap V4 PoolManager on Monad
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
  if (net.chainId === 143n && owner.toLowerCase() === deployer.address.toLowerCase()) console.warn("WARNING: owner is the deployer. Use a multisig for OWNER_ADDRESS.");
  const mcap = process.env.START_MCAP_MON || 250000;
  const startTick = uv4StartTick(mcap);
  const fee = ethers.parseEther(process.env.CREATION_FEE_MON || "100");

  console.log("chain", net.chainId.toString(), "| deployer", deployer.address);
  console.log("start mcap ~", params(mcap).effectiveMcapMon.toFixed(0), "MON | startTick", startTick, "| creation fee", ethers.formatEther(fee), "MON");

  const { launcher, hook } = await deployHookAndLauncher(deployer, { poolManager: POOL_MANAGER, owner, platform, monshi: MONSHI, startTick, creationFee: fee });
  const launcherAddr = await launcher.getAddress();
  const hookAddr = await hook.getAddress();
  if (process.env.KEEPER_ADDRESS && owner.toLowerCase() === deployer.address.toLowerCase()) {
    await (await launcher.setKeeper(process.env.KEEPER_ADDRESS)).wait();
    console.log("keeper set:", process.env.KEEPER_ADDRESS);
  }
  console.log("\nMonpadHook:", hookAddr, "(address flags 0x2080 mined)");
  console.log("MonpadHookLauncher:", launcherAddr);
  console.log("\nVercel env:\n  NEXT_PUBLIC_LAUNCHER_UV4=" + launcherAddr + "\n  NEXT_PUBLIC_HOOK_UV4=" + hookAddr);
  console.log("\nVerify:\n  npx hardhat verify --network monadMainnet", hookAddr, POOL_MANAGER, launcherAddr);
  console.log("  npx hardhat verify --network monadMainnet", launcherAddr, owner, platform, POOL_MANAGER, hookAddr, MONSHI, startTick, fee.toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
