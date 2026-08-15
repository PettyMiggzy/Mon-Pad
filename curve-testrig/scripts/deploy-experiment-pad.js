#!/usr/bin/env node
/*
 * Deploy AtomicExperimentPad.
 *
 * EVERY address comes from the environment with NO DEFAULT. A defaulted address on a research rig is how you
 * end up with the hot deploy key as the rescue recipient, or a pad pointed at the wrong one of the four V3
 * factories on this chain — both silent, both only discovered after the data is unusable.
 *
 *   OWNER               root admin. Multisig or hardware. NEVER the key in PRIVATE_KEY.
 *   RESCUE_RECIPIENT    fixed sweep destination. Repointing it costs a 2-day timelock.
 *   LP_VAULT            the Recipient.VAULT level. May be 0x...dEaD, may not be zero.
 *   FACTORY             UniswapV3Factory. Robinhood Chain canonical: 0x1f7d7550b1b028f7571e69a784071f0205fd2efa
 *   POSITION_MANAGER    NonfungiblePositionManager: 0x73991a25c818bf1f1128deaab1492d45638de0d3
 *   WETH                quote token: 0x0bd7d308f8e1639fab988df18a8011f41eacad73
 *   EXPECTED_CHAIN_ID   asserted IN THE CONSTRUCTOR. 4663 for Robinhood Chain.
 *   START_LAUNCH_ID     offsets this pad's ids clear of the reference pad's 3..8. Suggested: 1000.
 *   POOL_INIT_CODE_HASH 0xe34f199b... on the canonical factory; 0x00.. to fall back to factory.getPool.
 *   OPERATORS           optional comma-separated hot keys to allowlist immediately.
 *
 * Usage:
 *   OWNER=0x.. RESCUE_RECIPIENT=0x.. LP_VAULT=0x.. FACTORY=0x.. POSITION_MANAGER=0x.. WETH=0x.. \
 *   EXPECTED_CHAIN_ID=4663 START_LAUNCH_ID=1000 POOL_INIT_CODE_HASH=0xe34f199b... \
 *     npx hardhat run scripts/deploy-experiment-pad.js --network <net>
 */
const { ethers, network } = require("hardhat");

/**
 * Belt-and-braces only. The REAL guard is the constructor's `block.chainid != expectedChainId` revert: a
 * script gate protects one script and is bypassed by any other, and hardhat.config.js wires PRIVATE_KEY
 * straight into a live-mainnet RPC.
 */
async function assertNotMainnet() {
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) === 143 && process.env.ALLOW_MAINNET_DEPLOY !== "1") {
    throw new Error(
      "Refusing to deploy the experiment pad to Monad mainnet (chain 143). This is a research instrument, " +
        "not a production launchpad. Point it at a testnet or a fork, or set ALLOW_MAINNET_DEPLOY=1 if you " +
        "genuinely mean to do this.",
    );
  }
}

function reqAddr(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set explicitly (no default is safe for an address)`);
  if (!ethers.isAddress(v)) throw new Error(`${name} is not an address: ${v}`);
  return ethers.getAddress(v);
}

async function main() {
  await assertNotMainnet();
  const [deployer] = await ethers.getSigners();

  const owner = reqAddr("OWNER");
  const rescue = reqAddr("RESCUE_RECIPIENT");
  const lpVault = reqAddr("LP_VAULT");
  const factory = reqAddr("FACTORY");
  const npm = reqAddr("POSITION_MANAGER");
  const weth = reqAddr("WETH");

  const expectedChainId = BigInt(process.env.EXPECTED_CHAIN_ID || "");
  if (!expectedChainId) throw new Error("EXPECTED_CHAIN_ID must be set (asserted in the constructor)");
  const startLaunchId = BigInt(process.env.START_LAUNCH_ID ?? 1000n);
  const initHash = process.env.POOL_INIT_CODE_HASH || ethers.ZeroHash;
  if (initHash !== ethers.ZeroHash && ethers.dataLength(initHash) !== 32) {
    throw new Error("POOL_INIT_CODE_HASH must be 32 bytes (or omitted for the getPool fallback)");
  }

  const live = (await ethers.provider.getNetwork()).chainId;
  if (live !== expectedChainId) {
    throw new Error(`network is chain ${live} but EXPECTED_CHAIN_ID is ${expectedChainId} — the constructor would revert`);
  }
  if (owner.toLowerCase() === deployer.address.toLowerCase()) {
    console.warn(
      "WARNING: OWNER == the deploy key. The owner key can revoke operators and (after 2 days) repoint the\n" +
        "         rescue destination. Move ownership to a cold key before running any real arm.",
    );
  }

  console.log(`Deploying AtomicExperimentPad from ${deployer.address} on ${network.name} (chain ${live})`);
  console.log(`  owner ${owner}\n  rescue ${rescue}\n  lpVault ${lpVault}`);
  console.log(`  factory ${factory}\n  npm ${npm}\n  weth ${weth}`);
  console.log(`  startLaunchId ${startLaunchId}  poolInitCodeHash ${initHash}`);

  const pad = await (await ethers.getContractFactory("AtomicExperimentPad")).deploy(
    owner, rescue, lpVault, factory, npm, weth, expectedChainId, startLaunchId, initHash,
  );
  await pad.waitForDeployment();
  const padAddr = await pad.getAddress();
  console.log(`\nAtomicExperimentPad ${padAddr}`);

  const ops = (process.env.OPERATORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const op of ops) {
    if (deployer.address.toLowerCase() !== owner.toLowerCase()) {
      console.warn(`  (skipping operator ${op}: the deploy key is not the owner)`);
      break;
    }
    await (await pad.setOperator(ethers.getAddress(op), true)).wait();
    console.log(`  operator + ${op}`);
  }

  // Six eth_calls, ONCE. The pad reads this map at launch time rather than hardcoding it, so print what the
  // venue actually says now — a drift here changes which fee tiers are usable levels of the experiment.
  const f = await ethers.getContractAt("IUniswapV3Factory", factory);
  const map = {};
  for (const fee of [100, 500, 3000, 10000, 2500, 20000]) {
    map[fee] = Number(await f.feeAmountTickSpacing(fee));
  }
  console.log(`\nfee -> tickSpacing on ${factory}:`);
  for (const [fee, s] of Object.entries(map)) {
    console.log(`  ${fee.padStart(5)} -> ${s === 0 ? "DISABLED" : s}`);
  }
  console.log(
    "\nNext: declareExperiment(<id>, <note>) in its OWN transaction BEFORE any launch in that arm.\n" +
      "Block order is the evidence the hypothesis was not retrofitted to the result.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
