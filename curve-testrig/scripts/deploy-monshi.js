/*
 * Deploy the MONSHI buy-pressure leg: MonPadLockStaking (over MONSHI) + MonshiBuyback + PlatformFeeSplitter.
 *
 * Wiring: FeeWalletRegistry.platformFeeWallet -> PlatformFeeSplitter -> { MonshiBuyback, treasury }
 *
 * Every platform payout in the suite (hook buy tax, curve LP fees, the graduation platform cut) lands on the
 * splitter. `distribute()` forwards BUYBACK_BPS to MonshiBuyback and the rest to the treasury; a keeper then
 * calls `buyback(minOut)` to convert that MON into MONSHI, split 40% treasury / 30% stakers / 30% burned.
 *
 * NOTE: pointing the registry at the splitter is a SEPARATE, deliberate step — FeeWalletRegistry enforces a
 * 2-day timelock on the platform fee wallet, so run it when you actually intend to switch the revenue path.
 * Until then the splitter simply sits unused and the platform is paid directly, as before.
 *
 * Usage: MONAD_RPC=<rpc> PRIVATE_KEY=<key> TREASURY=<addr> OWNER=<multisig> \
 *        npx hardhat run scripts/deploy-monshi.js --network monad
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// MONSHI, and the venue it actually trades on. MONSHI has GRADUATED off the nad.fun bonding curve and now trades
// in a Uniswap-V3-style pool (WMON/MONSHI, fee 1%, tickSpacing 200) whose factory is nad.fun's V3_FACTORY
// 0x6B5F564339DbAD6b780249827f2198a841FEB7F3 — so the DEX router is correct here and the BONDING_CURVE_ROUTER
// is not. Verified live: router.buy{value: 1 MON} returns ~1,870 MONSHI with `to` set to the burn address.
//
// Do NOT substitute the "V2_NAD_FUN_ROUTER" listed in docs/REFERENCES/nad-fun-v2-api.md
// (0x75588668999cA0557b78046b8a5E86b47b9234ec) — that address has NO CODE on Monad mainnet.
const MONSHI = process.env.MONSHI || "0xB744F5CDb792d8187640214C4A1c9aCE29af7777";
const NAD_DEX_ROUTER = process.env.NAD_DEX_ROUTER || "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137";

// How much of PLATFORM revenue is diverted to MONSHI buybacks. Contract-capped at 50%.
const BUYBACK_BPS = Number(process.env.BUYBACK_BPS || 2000); // 20%
// Of the MONSHI actually bought, split three ways: treasury / MONSHI stakers / burn (the remainder).
// Treasury+staking are jointly capped at MAX_DIVERTED_BPS (70%), so at least 30% of every buy always burns
// and "platform fees buy and burn MONSHI" stays true no matter who holds the owner key.
const MONSHI_TREASURY_BPS = Number(process.env.MONSHI_TREASURY_BPS || 4000); // 40% -> treasury
const MONSHI_STAKING_BPS = Number(process.env.MONSHI_STAKING_BPS || 3000); // 30% -> MONSHI stakers
// MONSHI staking terms. Stake MONSHI, earn MONSHI, dripped from the buyback's staking share.
const STAKE_LOCK = Number(process.env.STAKE_LOCK || 30 * 24 * 3600);
const STAKE_DRIP = Number(process.env.STAKE_DRIP || 30 * 24 * 3600);
// Bound on a single buyback. Measured against the live pool: 1,000 MON moves MONSHI ~2.0% (1% of which is the
// pool's own fee), 2,500 MON ~2.6%. 1,000 keeps each buy comfortably inside normal slippage.
const MAX_SPEND_PER_CALL = ethers.parseEther(process.env.MAX_SPEND_PER_CALL || "1000");
const COOLDOWN = Number(process.env.COOLDOWN || 3600); // 1h between buys

async function deploy(name, args = []) {
  const c = await (await ethers.getContractFactory(name)).deploy(...args);
  await c.waitForDeployment();
  console.log(`  ${name.padEnd(22)} ${await c.getAddress()}`);
  return c;
}

// Research rig — see scripts/deploy-curve.js. Chain 143 is refused unless explicitly overridden.
async function assertNotMainnet() {
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) === 143 && process.env.ALLOW_MAINNET_DEPLOY !== "1") {
    throw new Error(
      "Refusing to deploy curve-testrig to Monad mainnet (chain 143). This is a research rig, not a " +
        "production launchpad. Point it at a testnet or a fork, or set ALLOW_MAINNET_DEPLOY=1 if you " +
        "genuinely mean to do this.",
    );
  }
}

async function main() {
  await assertNotMainnet();
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY;
  const owner = process.env.OWNER || deployer.address;
  if (!treasury) throw new Error("TREASURY must be set (where the non-buyback share of platform revenue goes)");

  console.log(`Deploying MONSHI buy-pressure leg as ${deployer.address}`);
  console.log(`  monshi ${MONSHI}\n  router ${NAD_DEX_ROUTER}`);
  console.log(`  revenue split ${BUYBACK_BPS / 100}% -> MONSHI buyback / ${(10000 - BUYBACK_BPS) / 100}% -> treasury (MON)`);
  console.log(`  bought MONSHI ${MONSHI_TREASURY_BPS / 100}% -> treasury / ${MONSHI_STAKING_BPS / 100}% -> stakers / ${(10000 - MONSHI_TREASURY_BPS - MONSHI_STAKING_BPS) / 100}% -> burned\n`);

  const staking = await deploy("MonPadLockStaking", [MONSHI, STAKE_LOCK, STAKE_DRIP]);
  const buyback = await deploy("MonshiBuyback", [MONSHI, NAD_DEX_ROUTER, owner, treasury, MONSHI_TREASURY_BPS, MONSHI_STAKING_BPS, MAX_SPEND_PER_CALL, COOLDOWN]);
  const splitter = await deploy("PlatformFeeSplitter", [await buyback.getAddress(), treasury, owner, BUYBACK_BPS]);

  // wire the staking sink (checks the pool's stake asset is MONSHI); must run from the OWNER account
  await (await buyback.setStaking(await staking.getAddress(), MONSHI_STAKING_BPS)).wait();
  console.log(`  buyback.setStaking -> ${await staking.getAddress()} @ ${MONSHI_STAKING_BPS / 100}%`);

  const out = {
    chainId: Number(network.config.chainId || 143),
    monshi: MONSHI,
    nadDexRouter: NAD_DEX_ROUTER,
    buybackBps: BUYBACK_BPS,
    monshiTreasuryBps: MONSHI_TREASURY_BPS,
    monshiStakingBps: MONSHI_STAKING_BPS,
    stakeLock: STAKE_LOCK,
    stakeDrip: STAKE_DRIP,
    maxSpendPerCall: MAX_SPEND_PER_CALL.toString(),
    cooldown: COOLDOWN,
    owner,
    treasury,
    contracts: {
      monshiStaking: await staking.getAddress(),
      monshiBuyback: await buyback.getAddress(),
      platformFeeSplitter: await splitter.getAddress(),
    },
  };
  const file = path.join(__dirname, "..", "deploy.monshi.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${file}`);
  console.log("\nNext:");
  console.log("  1. buyback.setKeeper(<keeper EOA>) — the address that computes minOut off-chain and fires buys");
  console.log(`  2. when ready to switch the revenue path: FeeWalletRegistry -> propose platformFeeWallet = ${out.contracts.platformFeeSplitter}`);
  console.log("     then commit after the 2-day timelock");
  console.log("  3. anyone may call splitter.distribute(); only the keeper/owner may call buyback.buyback(minOut)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
