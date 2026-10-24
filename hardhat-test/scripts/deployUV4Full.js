// Full UV4 deploy: MonpadHook + MonpadHookLauncher + MonpadV4Router, then hands ownership to OWNER_ADDRESS (Ownable2Step: it must accept).
// NOT AUDITED by a professional. See docs/AUDIT-UV4.md.
//   MAINNET_RPC=... DEPLOYER_KEY=0x... CONFIRM_MAINNET=I_UNDERSTAND_UNAUDITED \
//   OWNER_ADDRESS=0x.. PLATFORM_ADDRESS=0x.. MONSHI_WALLET=0x.. npx hardhat run scripts/deployUV4Full.js --network monadMainnet
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { uv4StartTickUsdc } = require("./v4-params");
const { deployHookAndLauncher } = require("./mine-hook");
const routes = require("../config/uv4-fork.routes.json");

const POOL_MANAGER = "0x188d586ddcf52439676ca21a244753fa19f9ea8e";
const MONSHI = "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const live = net.chainId === 143n;
  if (live && process.env.CONFIRM_MAINNET !== "I_UNDERSTAND_UNAUDITED") throw new Error("set CONFIRM_MAINNET=I_UNDERSTAND_UNAUDITED");
  for (const k of ["OWNER_ADDRESS", "PLATFORM_ADDRESS", "MONSHI_WALLET"]) if (!ethers.isAddress(process.env[k] || "")) throw new Error(`${k} missing or invalid`);
  const { OWNER_ADDRESS: ownerTo, PLATFORM_ADDRESS: platform, MONSHI_WALLET: monshiWallet } = process.env;
  const mcap = Number(process.env.START_MCAP_USDC || 3000);
  const fee = BigInt(process.env.CREATION_FEE_USDC || 0) * 10n ** 6n;
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "balance", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");
  console.log("owner(after accept)", ownerTo, "| platform", platform, "| monshiWallet", monshiWallet, "| start mcap", mcap, "| creation fee USDC", fee / 10n ** 6n);

  // deployer owns the launcher during setup, then proposes the real owner
  const { launcher, hook } = await deployHookAndLauncher(deployer, {
    poolManager: POOL_MANAGER, owner: deployer.address, platform, quoteAsset: routes.quoteToken, monshi: MONSHI,
    startTick: uv4StartTickUsdc(mcap), creationFee: fee,
  });
  const key = routes.monUsdcPool;
  const router = await (await ethers.getContractFactory("MonpadV4Router", deployer)).deploy(
    POOL_MANAGER, launcher.target, hook.target, routes.quoteToken, routes.quoteToken,
    { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks },
  );
  await router.waitForDeployment();
  await (await launcher.setMonshiWallet(monshiWallet)).wait();
  await (await launcher.transferOwnership(ownerTo)).wait();

  const out = {
    chainId: Number(net.chainId), deployer: deployer.address, launcher: launcher.target, hook: hook.target, router: router.target,
    quote: routes.quoteToken, platform, monshiWallet, pendingOwner: ownerTo, startMcapUsdc: mcap, creationFeeUsdc: Number(fee / 10n ** 6n),
    deployedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
  if (hre.network.name !== "hardhat") fs.writeFileSync(path.join(__dirname, "..", "deployments", `uv4-${net.chainId}.json`), JSON.stringify(out, null, 2));
  console.log("owner now:", await launcher.owner(), "| pendingOwner:", await launcher.pendingOwner(), "| monshiWallet:", await launcher.monshiWallet());
}
main().catch((e) => { console.error(e); process.exit(1); });
