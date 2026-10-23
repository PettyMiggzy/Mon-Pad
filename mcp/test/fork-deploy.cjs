/**
 * Deploy Monpad UV4 stack + MonpadV4Router on a Hardhat fork. Run from hardhat-test:
 *   FORK_RPC=https://rpc.monad.xyz npx hardhat run ../mcp/test/fork-deploy.cjs
 */
const path = require('path');
const hardhatDir = path.resolve(__dirname, '../../hardhat-test');
process.chdir(hardhatDir);
const hre = require(path.join(hardhatDir, 'node_modules/hardhat'));
const { ethers } = hre;
const { uv4StartTick } = require(path.join(hardhatDir, 'scripts/v4-params'));
const { deployHookAndLauncher } = require(path.join(hardhatDir, 'scripts/mine-hook'));

const POOL_MANAGER = '0x188d586ddcf52439676ca21a244753fa19f9ea8e';
const STATE_VIEW = '0x77395f3b2e73ae90843717371294fa97cc419d64';
const MONSHI = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777';

async function main() {
  if (!process.env.FORK_RPC) throw new Error('Set FORK_RPC to a Monad RPC URL');
  const { setBalance } = require(path.join(hardhatDir, 'node_modules/@nomicfoundation/hardhat-network-helpers'));
  const [deployer] = await ethers.getSigners();
  await setBalance(deployer.address, ethers.parseEther('10000000'));
  const { launcher, hook } = await deployHookAndLauncher(deployer, {
    poolManager: POOL_MANAGER,
    owner: deployer.address,
    platform: deployer.address,
    monshi: MONSHI,
    startTick: uv4StartTick(250000),
    creationFee: ethers.parseEther('100'),
  });
  const routerFactory = await ethers.getContractFactory('MonpadV4Router');
  const router = await routerFactory.deploy(POOL_MANAGER);
  await router.waitForDeployment();

  const salt = ethers.zeroPadValue(ethers.toBeHex(1), 32);
  const tx = await launcher.launch('MCP Test', 'MCPT', salt, 0, { value: ethers.parseEther('100') });
  await tx.wait();

  const token = await launcher.allTokens(0n);
  process.stdout.write(
    JSON.stringify({
      launcher: await launcher.getAddress(),
      hook: await hook.getAddress(),
      v4Router: await router.getAddress(),
      poolManager: POOL_MANAGER,
      stateView: STATE_VIEW,
      monshi: MONSHI,
      sampleToken: token,
      deployer: deployer.address,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
