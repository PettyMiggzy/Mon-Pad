// Deploy MonPadBoostMonshi (MONSHI-paid, 70% burn / 30% treasury, tiered).
//   MAINNET_RPC=https://rpc.monad.xyz npx hardhat run scripts/deployBoostMonshi.js --network monadMainnet
// Env: MONSHI_ADDRESS, BOOST_TREASURY (defaults below).

const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const MONSHI = process.env.MONSHI_ADDRESS || "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
  const TREASURY = process.env.BOOST_TREASURY || "0xece5d15e567c801c835029a49b2e4067b0eb63aa";

  console.log(`network ${network.name}  deployer ${deployer.address}`);
  console.log(`balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MON`);
  console.log(`MONSHI ${MONSHI}  treasury ${TREASURY}  (70% burn / 30% treasury)`);

  const B = await ethers.getContractFactory("MonPadBoostMonshi");
  const b = await B.deploy(MONSHI, TREASURY);
  await b.waitForDeployment();
  console.log(`MonPadBoostMonshi: ${b.target}`);
  console.log(`tiers: ${await b.tierCount()} (0=5M/48h, 1=10M/5d)`);
  console.log(`\nSet BOOST_MONSHI_CONTRACT=${b.target} in bot/.env`);
}

main().catch((e) => { console.error(e); process.exit(1); });
