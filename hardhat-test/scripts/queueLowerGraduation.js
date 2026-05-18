const hre = require("hardhat");
const { parseEther, formatEther } = require("ethers");

async function main() {
  const FACTORY = "0x776af5A5FC3037cAEe3aA02B50443358b68984aE";
  const NEW_TARGET = parseEther("50"); // 50 MON for testing

  const factory = await hre.ethers.getContractAt("MonPadFactoryV2", FACTORY);
  const owner = await factory.owner();
  const [signer] = await hre.ethers.getSigners();

  console.log("Factory owner:", owner);
  console.log("Signer:       ", signer.address);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Signer is not factory owner. Aborting.");
  }

  const current = await factory.graduationTarget();
  console.log("Current graduationTarget:", formatEther(current), "MON");
  console.log("Proposing new target:   ", formatEther(NEW_TARGET), "MON");

  const delay = await factory.timelockDelay();
  console.log("Timelock delay (sec):    ", delay.toString());

  console.log("\nQueueing the change (timelock starts now)...");
  const tx = await factory.queueSetGraduationTarget(NEW_TARGET);
  const receipt = await tx.wait();
  console.log("Queue tx confirmed:", receipt.hash);
  console.log("Block:             ", receipt.blockNumber);

  const queuedAt = new Date();
  const executableAt = new Date(queuedAt.getTime() + Number(delay) * 1000);
  console.log("\n=== TIMELOCK ===");
  console.log("Queued at:    ", queuedAt.toISOString());
  console.log("Executable at:", executableAt.toISOString(), "(" + (Number(delay)/3600) + "h from now)");
  console.log("\nRun executeLowerGraduation.js after that timestamp.");
}

main().catch((e) => { console.error(e); process.exit(1); });
