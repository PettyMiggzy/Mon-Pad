/**
 * Deploy the Monpad UV4 stack (USDC quote) + MonpadV4Router on a Hardhat fork. Run from hardhat-test:
 *   FORK_RPC=https://rpc.monad.xyz npx hardhat run ../mcp/test/fork-deploy.cjs
 *
 * Needs the USDC-quote contracts and hardhat-test/config/uv4-fork.routes.json (PR #36).
 * Test-only: the deployer's USDC is written into the live token's balance slot (9, FiatToken v2).
 */
const path = require('path');
const hardhatDir = path.resolve(__dirname, '../../hardhat-test');
process.chdir(hardhatDir);
const hre = require(path.join(hardhatDir, 'node_modules/hardhat'));
const { ethers } = hre;
const { deployHookAndLauncher } = require(path.join(hardhatDir, 'scripts/mine-hook'));
const routes = require(path.join(hardhatDir, 'config/uv4-fork.routes.json'));

const POOL_MANAGER = '0x188d586ddcf52439676ca21a244753fa19f9ea8e';
const STATE_VIEW = '0x77395f3b2e73ae90843717371294fa97cc419d64';
const MONSHI = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777';
const USDC = routes.quoteToken;
const U = (n) => BigInt(n) * 10n ** 6n;

/** Start tick for a target market cap in USDC, correct for 6-decimal USDC vs 18-decimal tokens (token = currency1). */
function startTickForMcap(mcapUsdc) {
  const rawTokensPerRawUsdc = (1e9 / mcapUsdc) * 1e12;
  return Math.round(Math.log(rawTokensPerRawUsdc) / Math.log(1.0001) / 200) * 200;
}

async function setUsdcBalance(account, amount) {
  const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [account, 9]));
  await ethers.provider.send('hardhat_setStorageAt', [USDC, slot, ethers.toBeHex(amount, 32)]);
}

async function main() {
  if (!process.env.FORK_RPC) throw new Error('Set FORK_RPC to a Monad RPC URL');
  const { setBalance } = require(path.join(hardhatDir, 'node_modules/@nomicfoundation/hardhat-network-helpers'));
  const [deployer] = await ethers.getSigners();
  await setBalance(deployer.address, ethers.parseEther('10000000'));
  await setUsdcBalance(deployer.address, U(1_000_000));

  const { launcher, hook } = await deployHookAndLauncher(deployer, {
    poolManager: POOL_MANAGER,
    owner: deployer.address,
    platform: deployer.address,
    quoteAsset: USDC,
    monshi: MONSHI,
    startTick: startTickForMcap(250000),
    creationFee: U(100),
  });
  const router = await (
    await ethers.getContractFactory('MonpadV4Router')
  ).deploy(POOL_MANAGER, await launcher.getAddress(), await hook.getAddress(), USDC, USDC, routes.monUsdcPool);
  await router.waitForDeployment();

  const usdc = await ethers.getContractAt(['function approve(address,uint256) returns (bool)'], USDC);
  await usdc.approve(await launcher.getAddress(), U(1_000_000));

  // The tick above prices the pool correctly only when the token sorts above USDC (token = currency1), so launch
  // until one does. Launcher PRs that make the start tick orientation-aware can drop this loop.
  let token;
  for (let i = 1; i <= 40; i++) {
    await (await launcher.launch('SDK Test', 'SDKT', ethers.zeroPadValue(ethers.toBeHex(i), 32), 0, 0)).wait();
    const t = await launcher.allTokens(BigInt(i - 1));
    if (BigInt(USDC) < BigInt(t)) {
      token = t;
      break;
    }
  }
  if (!token) throw new Error('no launch sorted above USDC in 40 tries');

  process.stdout.write(
    JSON.stringify({
      launcher: await launcher.getAddress(),
      hook: await hook.getAddress(),
      v4Router: await router.getAddress(),
      quoteAsset: USDC,
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
