const hre = require("hardhat");
const { parseEther, formatEther } = require("ethers");

async function main() {
  const FACTORY = "0x776af5A5FC3037cAEe3aA02B50443358b68984aE";
  const NEW_TARGET = parseEther("50"); // same value as queue step

  const factory = await hre.ethers.getContractAt("MonPadFactoryV2", FACTORY);
  const owner = await factory.owner();
  const [signer] = await hre.ethers.getSigners();

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Signer is not factory owner.");
  }

  const before = await factory.graduationTarget();
  console.log("Current graduationTarget:", formatEther(before), "MON");

  console.log("\nExecuting (will revert if timelock hasnt elapsed or value mismatches queue)...");
  const tx = await factory.executeSetGraduationTarget(NEW_TARGET);
  const receipt = await tx.wait();
  console.log("Execute tx confirmed:", receipt.hash);

  const after = await factory.graduationTarget();
  console.log("New graduationTarget:    ", formatEther(after), "MON");

  if (BigInt(after) !== BigInt(NEW_TARGET)) {
    throw new Error("Value mismatch — execute didnt land");
  }
  console.log("\n✓ Graduation target lowered. Ready to test launch lifecycle.");
}

main().catch((e) => { console.error(e); process.exit(1); });
