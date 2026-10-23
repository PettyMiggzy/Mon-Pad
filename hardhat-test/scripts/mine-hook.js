// Uniswap V4 hooks must have specific bits set in their ADDRESS (the PoolManager reads permissions from it).
// MonpadHook needs BEFORE_INITIALIZE (1<<13) | BEFORE_SWAP (1<<7) = 0x2080 in the low 14 bits.
// We deploy it with CREATE2 through the canonical deployer and mine a salt that produces such an address.
const { ethers } = require("hardhat");

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const FLAGS = 0x2080n;
const MASK = (1n << 14n) - 1n;

async function mineHookSalt(poolManager, launcher) {
  const art = await ethers.getContractFactory("MonpadHook");
  const initCode = ethers.concat([art.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [poolManager, launcher])]);
  const initHash = ethers.keccak256(initCode);
  for (let i = 0n; i < 5_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(CREATE2_DEPLOYER, salt, initHash);
    if ((BigInt(addr) & MASK) === FLAGS) return { salt, addr, initCode };
  }
  throw new Error("no salt found");
}

/// Deploys MonpadHook (CREATE2, mined) then MonpadHookLauncher. The hook needs the launcher's address and the launcher
/// needs the hook's, so the launcher address is predicted from the deployer's next nonces.
async function deployHookAndLauncher(deployer, { poolManager, owner, platform, monshi, startTick, creationFee }) {
  const nonce = await deployer.getNonce();
  const launcherAddr = ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const { salt, addr, initCode } = await mineHookSalt(poolManager, launcherAddr);
  await (await deployer.sendTransaction({ to: CREATE2_DEPLOYER, data: ethers.concat([salt, initCode]) })).wait();
  const F = await ethers.getContractFactory("MonpadHookLauncher", deployer);
  const launcher = await F.deploy(owner, platform, poolManager, addr, monshi, startTick, creationFee);
  await launcher.waitForDeployment();
  if ((await launcher.getAddress()).toLowerCase() !== launcherAddr.toLowerCase()) throw new Error("launcher address prediction failed");
  const hook = await ethers.getContractAt("MonpadHook", addr, deployer);
  return { launcher, hook };
}

module.exports = { mineHookSalt, deployHookAndLauncher, CREATE2_DEPLOYER };
