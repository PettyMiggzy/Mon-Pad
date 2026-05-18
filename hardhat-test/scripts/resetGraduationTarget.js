const hre = require("hardhat");
const { parseEther, formatEther } = require("ethers");

async function main() {
  const FACTORY = "0x776af5A5FC3037cAEe3aA02B50443358b68984aE";
  const RESET_TARGET = parseEther("425000");

  const factory = await hre.ethers.getContractAt("MonPadFactoryV2", FACTORY);
  const owner = await factory.owner();
  const [signer] = await hre.ethers.getSigners();

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Signer is not factory owner.");
  }

  const current = await factory.graduationTarget();
  console.log("Current graduationTarget:", formatEther(current), "MON");
  console.log("Queueing reset to:       ", formatEther(RESET_TARGET), "MON");

  const delay = await factory.timelockDelay();
  const tx = await factory.queueSetGraduationTarget(RESET_TARGET);
  const receipt = await tx.wait();
  console.log("Reset queue tx:", receipt.hash);

  const queuedAt = new Date();
  const executableAt = new Date(queuedAt.getTime() + Number(delay) * 1000);
  console.log("\nExecutable at:", executableAt.toISOString());
  console.log("Run: factory.executeSetGraduationTarget(parseEther(\"425000\")) after that.");
}

main().catch((e) => { console.error(e); process.exit(1); });
