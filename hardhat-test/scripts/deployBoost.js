// Deploy MonPadBoost (pay-to-trend) to Monad mainnet.
//   npx hardhat run scripts/deployBoost.js --network monadMainnet
// Env: TREASURY_WALLET (payments go here), BOOST_MIN_MON (min payment, default 1).

const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_WALLET || deployer.address;
  const minMon = process.env.BOOST_MIN_MON || "1";
  const minWei = ethers.parseEther(minMon);

  console.log(`network ${network.name}  deployer ${deployer.address}`);
  console.log(`treasury ${treasury}  minBoost ${minMon} MON`);

  const Boost = await ethers.getContractFactory("MonPadBoost");
  const boost = await Boost.deploy(treasury, minWei);
  await boost.waitForDeployment();
  console.log(`MonPadBoost: ${boost.target}`);
  console.log(`\nSet BOOST_CONTRACT=${boost.target} in bot/.env`);
}

main().catch((e) => { console.error(e); process.exit(1); });
