// Deploy script for MonPad V2.1 contracts.
// Run with: node deploy/v2/deploy.js
//
// V2.1 changes vs V2:
//   * MonPadStakingHub constructor now takes (factory, distributeInterval, minDistributeBalance).
//   * MonPadPoolFactory constructor now takes (hub, factory, monshi). BUYBACK is read live
//     from factory.buybackWallet() at fee time.
//   * MonPadGraduator is a NEW separate contract that creates Uni V3 LP and burns the NFT.
//     Constructor: (factory, npm, wmon).
//   * Factory.setRewardRouter / setMonshiStakingPool are now timelocked. Initial wiring uses
//     Factory.bootstrapInit(graduator, rewardRouter, poolFactory) — one-shot, no timelock.
//   * Hub.setMonshiToken is timelocked + one-shot. Initial wiring uses Hub.bootstrapMonshi(t)
//     (added in this audit pass).
//   * Curves are authorized in Hub via Factory.createLaunch (V2.1-1 patch). For curves that
//     pre-exist any rewardRouter rotation, use Factory.backfillCurveAuthorization([...]).
//
// Required env (deploy/v2/.env):
//   PRIVATE_KEY      - deployer's private key (hex, no 0x prefix)
//   PRIMARY_RPC      - primary Monad RPC (paid, optional). Defaults to public.
//   FALLBACK_RPC     - fallback Monad RPC (optional). Defaults to PRIMARY_RPC.
//   PLATFORM_WALLET  - 1% sell tax + buyBuffer at grad
//   TREASURY_WALLET  - creation fees + paid-staking fees
//   BUYBACK_WALLET   - 0.5% sell-tax (until rewardRouter is set), Pool MONSHI burn-vault destination
//   MONSHI_TOKEN     - MONSHI token address (required if DEPLOY_STAKING=1)
//   WMON             - Wrapped MON address (required if DEPLOY_STAKING=1, used by Graduator)
//   NPM              - Uniswap V3 NonfungiblePositionManager (required if DEPLOY_STAKING=1)
//
// Optional env:
//   DEPLOY_STAKING   - "1" to deploy Hub + PoolFactory + Graduator + MONSHI pool wiring
//   DEPLOY_VESTING   - "1" to deploy MonPadVesting. Default OFF: the contract is non-binding
//                      (beneficiary can self-revoke). See audit V2.1-8. Don't enable unless
//                      you've replaced the revoke logic.
//   DEPLOY_SWAP      - "1" to deploy MonPadSwap wrapper (separate flow)
//   DEX_ROUTER       - existing Uniswap V2-style router (only if DEPLOY_SWAP=1)
//
// SECURITY:
//   * Never paste PRIVATE_KEY into a chat. Run from your own machine.
//   * Per DEPLOY-V2.md: NEVER use 0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd as treasury or
//     buyback. That wallet's keys are lost. The script will refuse to run if any required
//     wallet matches that address.

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PRIMARY_RPC = process.env.PRIMARY_RPC || process.env.RPC_URL || 'https://rpc.monad.xyz';
const FALLBACK_RPC = process.env.FALLBACK_RPC || PRIMARY_RPC;
const PK = process.env.PRIVATE_KEY;

const DEAD_TREASURY = '0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd'.toLowerCase();

if (!PK) {
  console.error('❌ Set PRIVATE_KEY in deploy/v2/.env');
  process.exit(1);
}

const REQUIRED_WALLETS = ['PLATFORM_WALLET', 'TREASURY_WALLET', 'BUYBACK_WALLET'];
for (const k of REQUIRED_WALLETS) {
  const v = process.env[k];
  if (!v) { console.error(`❌ Set ${k} in deploy/v2/.env`); process.exit(1); }
  if (v.toLowerCase() === DEAD_TREASURY) {
    console.error(`❌ ${k} = ${v} is the dead-key wallet from DEPLOY-V2.md. Refusing to deploy.`);
    process.exit(1);
  }
}

if (process.env.DEPLOY_STAKING === '1') {
  for (const k of ['MONSHI_TOKEN', 'WMON', 'NPM']) {
    if (!process.env[k]) {
      console.error(`❌ DEPLOY_STAKING=1 requires ${k} in deploy/v2/.env`);
      process.exit(1);
    }
  }
}

function loadContract(name) {
  const p = path.join(__dirname, 'build', name + '.json');
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing build artifact: ${p}. Compile contracts first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function deploy(wallet, name, args = []) {
  const c = loadContract(name);
  const factory = new ethers.ContractFactory(c.abi, c.bytecode, wallet);
  console.log(`📦 Deploying ${name}...`);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`   ✓ ${name}: ${addr}`);
  return { addr, contract };
}

async function main() {
  const providers = [
    { provider: new ethers.JsonRpcProvider(PRIMARY_RPC, { chainId: 143, name: 'Monad' }), priority: 1, weight: 1, stallTimeout: 2000 },
  ];
  if (FALLBACK_RPC && FALLBACK_RPC !== PRIMARY_RPC) {
    providers.push({ provider: new ethers.JsonRpcProvider(FALLBACK_RPC, { chainId: 143, name: 'Monad' }), priority: 2, weight: 1, stallTimeout: 2000 });
  }
  const provider = new ethers.FallbackProvider(providers, 143, { quorum: 1 });
  const wallet = new ethers.Wallet(PK, provider);

  console.log('🚀 MONPAD V2.1 DEPLOYMENT');
  console.log('   Network:', PRIMARY_RPC);
  console.log('   Deployer:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('   Balance:', ethers.formatEther(bal), 'MON');

  if (bal < ethers.parseEther('1')) {
    console.error('❌ Need at least 1 MON for gas');
    process.exit(1);
  }

  const PLATFORM = process.env.PLATFORM_WALLET;
  const TREASURY = process.env.TREASURY_WALLET;
  const BUYBACK  = process.env.BUYBACK_WALLET;

  const deployed = {};

  // ============================================================
  // 1. Factory V2.1
  // ============================================================
  const factory = await deploy(wallet, 'MonPadFactoryV2', [PLATFORM, TREASURY, BUYBACK]);
  deployed.factory = factory.addr;

  // ============================================================
  // 2. Vesting (no constructor args) — opt-in only.
  //    The contract is non-binding (beneficiary can self-revoke). Audit V2.1-8.
  //    Default OFF. Set DEPLOY_VESTING=1 to ship anyway.
  // ============================================================
  if (process.env.DEPLOY_VESTING === '1') {
    const vesting = await deploy(wallet, 'MonPadVesting');
    deployed.vesting = vesting.addr;
  } else {
    console.log('⏭  Skipping MonPadVesting (DEPLOY_VESTING != "1"). Audit V2.1-8: contract is non-binding.');
  }

  // ============================================================
  // 3. Staking system (Hub + PoolFactory + Graduator + bootstrap + MONSHI pool)
  // ============================================================
  if (process.env.DEPLOY_STAKING === '1') {
    const MONSHI = process.env.MONSHI_TOKEN;
    const WMON   = process.env.WMON;
    const NPM    = process.env.NPM;

    // 3a. Hub: (factory, distInterval=1h, minDistBalance=0.5 MON)
    const hub = await deploy(wallet, 'MonPadStakingHub', [
      factory.addr,
      3600,                                  // distributeInterval = 1 hour
      ethers.parseEther('0.5'),              // minDistributeBalance = 0.5 MON
    ]);
    deployed.stakingHub = hub.addr;

    // 3b. PoolFactory: (hub, factory, monshi)  — V2.1 dropped the BUYBACK constructor arg.
    //     PoolFactory now reads buybackWallet live from factory.buybackWallet() at fee time.
    const poolFactory = await deploy(wallet, 'MonPadPoolFactory', [hub.addr, factory.addr, MONSHI]);
    deployed.poolFactory = poolFactory.addr;

    // 3c. Graduator (NEW in V2.1): (factory, npm, wmon)
    const graduator = await deploy(wallet, 'MonPadGraduator', [factory.addr, NPM, WMON]);
    deployed.graduator = graduator.addr;

    // 3d. Bootstrap factory: one-shot setter for graduator + rewardRouter + poolFactory.
    //     Skips the 24h timelock that gates these post-bootstrap.
    console.log('🔧 Factory.bootstrapInit(graduator, hub, poolFactory) ...');
    const tx1 = await factory.contract.bootstrapInit(graduator.addr, hub.addr, poolFactory.addr);
    await tx1.wait();
    console.log('   ✓ Done');

    // 3e. Bootstrap hub: one-shot MONSHI token registration. After this, monshiToken is
    //     locked forever — proposeSetMonshiToken will revert with MonshiAlreadySet.
    console.log('🔧 Hub.bootstrapMonshi(MONSHI) ...');
    const tx2 = await hub.contract.bootstrapMonshi(MONSHI);
    await tx2.wait();
    console.log('   ✓ Done');

    // 3f. Create the MONSHI staking pool. burnsToCreator=true routes the early-unstake
    //     burn vault to BUYBACK instead of dEaD (per DEPLOY-V2.md). adminCreatePool
    //     enforces token == monshiToken when burnsToCreator=true (V2.1 lockdown).
    //     creator = BUYBACK (NOT deployer — see DEPLOY-V2.md§6 explicit warning).
    console.log('🔧 PoolFactory.adminCreatePool(MONSHI, BUYBACK, true) ...');
    const tx3 = await poolFactory.contract.adminCreatePool(MONSHI, BUYBACK, true);
    const receipt3 = await tx3.wait();
    let monshiPoolAddr = null;
    for (const log of receipt3.logs) {
      try {
        const parsed = poolFactory.contract.interface.parseLog(log);
        if (parsed && parsed.name === 'PoolCreated') {
          monshiPoolAddr = parsed.args.pool;
          break;
        }
      } catch {}
    }
    if (!monshiPoolAddr) {
      console.error('❌ Could not extract MONSHI pool address from PoolCreated event');
      process.exit(1);
    }
    deployed.monshiPool = monshiPoolAddr;
    console.log('   ✓ MONSHI pool:', monshiPoolAddr);

    // 3g. Set monshiStakingPool on factory. This setter is timelocked in V2.1, so we queue
    //     here and the operator must execute after 24h. We log the queue tx so the operator
    //     knows what to execute.
    console.log('🔧 Factory.queueSetMonshiStakingPool(monshiPool) (24h timelock; execute later) ...');
    const tx4 = await factory.contract.queueSetMonshiStakingPool(monshiPoolAddr);
    await tx4.wait();
    console.log('   ✓ Queued. After 24h, run:');
    console.log(`      cast send ${factory.addr} "executeSetMonshiStakingPool(address)" ${monshiPoolAddr}`);
  }

  // ============================================================
  // 4. Swap wrapper (optional, separate from staking)
  // ============================================================
  if (process.env.DEPLOY_SWAP === '1') {
    const ROUTER = process.env.DEX_ROUTER;
    const WMON   = process.env.WMON;
    if (!ROUTER || !WMON) { console.error('❌ DEPLOY_SWAP=1 requires DEX_ROUTER and WMON'); process.exit(1); }

    const swap = await deploy(wallet, 'MonPadSwap', [ROUTER, WMON, BUYBACK]);
    deployed.swap = swap.addr;
  }

  // ============================================================
  // Save deployment
  // ============================================================
  const out = {
    chainId: 143,
    network: 'Monad Mainnet',
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    contracts: deployed,
    config: {
      platform: PLATFORM,
      treasury: TREASURY,
      buyback: BUYBACK,
      monshi: process.env.MONSHI_TOKEN || null,
      wmon: process.env.WMON || null,
      npm: process.env.NPM || null,
      router: process.env.DEX_ROUTER || null,
    },
  };
  fs.writeFileSync(path.join(__dirname, 'deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n💾 Saved to deploy/v2/deployed.json');
  console.log('\n✅ DEPLOYMENT COMPLETE');
  console.log(JSON.stringify(deployed, null, 2));
  console.log('\nPost-deploy checklist:');
  console.log('  1. Update Vercel env: NEXT_PUBLIC_FACTORY_V2, NEXT_PUBLIC_STAKING_HUB,');
  console.log('     NEXT_PUBLIC_POOL_FACTORY, NEXT_PUBLIC_GRADUATOR, NEXT_PUBLIC_VESTING.');
  console.log('  2. Update backend env: FACTORY_ADDRESS=<factory>, redeploy api.monpad.net.');
  console.log('  3. After 24h: executeSetMonshiStakingPool on factory (see queue tx above).');
  console.log('  4. Transfer ownership of all contracts from the deployer key to your hardware');
  console.log('     wallet via transferOwnership/acceptOwnership (2-step).');
}

main().catch(e => { console.error(e); process.exit(1); });
