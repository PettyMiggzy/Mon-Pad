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

// Load a compiled contract artifact. PREFERS hardhat-test/artifacts/* (which is
// auto-populated by `npx hardhat compile` and guaranteed to match the source on `main`),
// falls back to deploy/v2/build/*.json only if hardhat artifacts are missing.
//
// IMPORTANT: the legacy deploy/v2/build/*.json files in the repo predate the V2.1 audit
// fixes (different ABI, different bytecode). If those are loaded by accident, you deploy
// the OLD vulnerable V2 contracts at the V2.1 wallet's expense. Hardhat-first prevents this.
function loadContract(name) {
  const candidates = [
    path.join(__dirname, '..', '..', 'hardhat-test', 'artifacts', 'contracts', name + '.sol', name + '.json'),
    path.join(__dirname, 'build', name + '.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.abi && j.bytecode) {
        // Sanity check: warn if loading from the legacy build/ dir (likely stale)
        if (p.includes(path.join('deploy', 'v2', 'build'))) {
          console.warn(`⚠  Loaded ${name} from deploy/v2/build/ (legacy). If you didn't intend this, run \`cd hardhat-test && npx hardhat compile\` to refresh artifacts.`);
        }
        return j;
      }
    }
  }
  console.error(`❌ Missing build artifact for ${name}. Run: cd hardhat-test && npm install && npx hardhat compile`);
  process.exit(1);
}

// Sleep helper for the inter-deploy delay (lets the RPC's nonce/mempool catch up
// between back-to-back deploys; the public Monad RPC otherwise rejects bursts with
// "An existing transaction had higher priority").
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Detect transient RPC errors that should retry with bumped gas (vs hard errors that
// should fail immediately). ethers wraps the upstream RPC error multiple levels deep,
// so we check shortMessage + message + nested error.message + JSON-stringified subobjects.
function isTransient(e) {
  if (!e) return false;
  const candidates = [
    e.shortMessage,
    e.message,
    e?.error?.message,
    e?.info?.error?.message,
    typeof e.error === 'object' ? JSON.stringify(e.error) : '',
    typeof e.info === 'object' ? JSON.stringify(e.info) : '',
  ].map(m => (m || '').toString().toLowerCase());

  const transientPhrases = [
    'higher priority',     // Monad mempool message
    'underpriced',
    'replacement',
    'nonce too low',
    'nonce already',
    'already known',
    'timeout',
    'could not coalesce',  // ethers' wrapper around any upstream RPC error
    'connection',
  ];
  if (candidates.some(m => transientPhrases.some(p => m.includes(p)))) return true;

  return (
    e.code === 'NETWORK_ERROR' ||
    e.code === 'TIMEOUT' ||
    e.code === 'SERVER_ERROR' ||
    e.code === 'UNKNOWN_ERROR'   // ethers maps -32603 RPC errors to this; usually retryable
  );
}

async function deploy(wallet, name, args = [], existingAddr = null) {
  // RESUME_* env vars let an operator skip already-deployed contracts after a partial
  // failure, avoiding redundant gas spend on re-deploys.
  if (existingAddr && /^0x[a-fA-F0-9]{40}$/.test(existingAddr)) {
    console.log(`📦 ${name}: using existing deployment ${existingAddr} (skipping deploy)`);
    const c = loadContract(name);
    return { addr: existingAddr, contract: new ethers.Contract(existingAddr, c.abi, wallet) };
  }

  const c = loadContract(name);
  const factory = new ethers.ContractFactory(c.abi, c.bytecode, wallet);
  console.log(`📦 Deploying ${name}...`);

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // On retries, bump gas explicitly to outprice any stuck/conflicting tx in the mempool.
      let overrides = {};
      if (attempt > 1) {
        const feeData = await wallet.provider.getFeeData();
        const mult = BigInt(attempt + 1); // 2x on attempt 2, 3x on attempt 3
        if (feeData.maxFeePerGas) {
          overrides.maxFeePerGas = (feeData.maxFeePerGas * mult * 12n) / 10n; // +20% headroom
          overrides.maxPriorityFeePerGas = ((feeData.maxPriorityFeePerGas || feeData.maxFeePerGas) * mult * 12n) / 10n;
        }
        console.log(`   🔁 Retry ${attempt}/3 with bumped gas (maxFeePerGas=${overrides.maxFeePerGas?.toString() || 'default'})`);
      }
      const contract = overrides.maxFeePerGas
        ? await factory.deploy(...args, overrides)
        : await factory.deploy(...args);
      await contract.waitForDeployment();
      const addr = await contract.getAddress();
      console.log(`   ✓ ${name}: ${addr}`);
      return { addr, contract };
    } catch (e) {
      lastError = e;
      const transient = isTransient(e);
      console.error(`   ⚠ Attempt ${attempt}/3 failed: ${e.shortMessage || e.message}`);
      if (!transient || attempt === 3) throw e;
      console.error(`   ⏳ Transient RPC error — waiting 15s before retry...`);
      await sleep(15000);
    }
  }
  throw lastError;
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

  // RESUME_* env vars let an operator skip already-deployed contracts after a partial
  // failure. Each one expects a 0x-prefixed 40-hex-char address and points at an existing
  // deployment of the matching contract. Resume mode is triggered per-contract.
  const RESUME_FACTORY     = process.env.RESUME_FACTORY     || null;
  const RESUME_HUB         = process.env.RESUME_HUB         || null;
  const RESUME_POOLFACTORY = process.env.RESUME_POOLFACTORY || null;
  const RESUME_GRADUATOR   = process.env.RESUME_GRADUATOR   || null;

  // 5s delay between consecutive deploys to give the public Monad RPC's nonce/mempool
  // a moment to update. Without it, back-to-back deploys can trip "An existing
  // transaction had higher priority" errors.
  const INTER_DEPLOY_DELAY_MS = 5000;

  // ============================================================
  // 1. Factory V2.1
  // ============================================================
  const factory = await deploy(wallet, 'MonPadFactoryV2', [PLATFORM, TREASURY, BUYBACK], RESUME_FACTORY);
  deployed.factory = factory.addr;
  if (!RESUME_FACTORY) await sleep(INTER_DEPLOY_DELAY_MS);

  // ============================================================
  // 2. Vesting (no constructor args) — opt-in only.
  //    The contract is non-binding (beneficiary can self-revoke). Audit V2.1-8.
  //    Default OFF. Set DEPLOY_VESTING=1 to ship anyway.
  // ============================================================
  if (process.env.DEPLOY_VESTING === '1') {
    const vesting = await deploy(wallet, 'MonPadVesting');
    deployed.vesting = vesting.addr;
    await sleep(INTER_DEPLOY_DELAY_MS);
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
    ], RESUME_HUB);
    deployed.stakingHub = hub.addr;
    if (!RESUME_HUB) await sleep(INTER_DEPLOY_DELAY_MS);

    // 3b. PoolFactory: (hub, factory, monshi)  — V2.1 dropped the BUYBACK constructor arg.
    //     PoolFactory now reads buybackWallet live from factory.buybackWallet() at fee time.
    const poolFactory = await deploy(wallet, 'MonPadPoolFactory', [hub.addr, factory.addr, MONSHI], RESUME_POOLFACTORY);
    deployed.poolFactory = poolFactory.addr;
    if (!RESUME_POOLFACTORY) await sleep(INTER_DEPLOY_DELAY_MS);

    // 3c. Graduator (NEW in V2.1): (factory, npm, wmon)
    const graduator = await deploy(wallet, 'MonPadGraduator', [factory.addr, NPM, WMON], RESUME_GRADUATOR);
    deployed.graduator = graduator.addr;
    if (!RESUME_GRADUATOR) await sleep(INTER_DEPLOY_DELAY_MS);

    // sendWithRetry: same retry-with-bumped-gas pattern as deploy(), applied to wiring
    // contract calls. Public Monad RPC's "An existing transaction had higher priority"
    // error happens on these single-tx wiring calls too, not just deploys.
    const sendWithRetry = async (label, makeTx) => {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let overrides;
          if (attempt > 1) {
            const feeData = await provider.getFeeData();
            const mult = BigInt(attempt + 1);
            overrides = {};
            if (feeData.maxFeePerGas) {
              overrides.maxFeePerGas = (feeData.maxFeePerGas * mult * 12n) / 10n;
              overrides.maxPriorityFeePerGas = ((feeData.maxPriorityFeePerGas || feeData.maxFeePerGas) * mult * 12n) / 10n;
            }
            console.log(`   🔁 Retry ${attempt}/3 with bumped gas`);
          }
          const tx = await makeTx(overrides);
          const receipt = await tx.wait();
          return { tx, receipt };
        } catch (e) {
          lastError = e;
          console.error(`   ⚠ ${label} attempt ${attempt}/3: ${e.shortMessage || e.message}`);
          if (!isTransient(e) || attempt === 3) throw e;
          console.error(`   ⏳ Transient RPC error — waiting 15s before retry...`);
          await sleep(15000);
        }
      }
      throw lastError;
    };

    // 3d. Bootstrap factory (one-shot). Skip if already bootstrapped.
    const isBootstrapped = await factory.contract.bootstrapped();
    if (isBootstrapped) {
      console.log('⏭  Factory.bootstrapInit already done, skipping');
    } else {
      console.log('🔧 Factory.bootstrapInit(graduator, hub, poolFactory) ...');
      await sendWithRetry('bootstrapInit', (ov) =>
        ov ? factory.contract.bootstrapInit(graduator.addr, hub.addr, poolFactory.addr, ov)
           : factory.contract.bootstrapInit(graduator.addr, hub.addr, poolFactory.addr)
      );
      console.log('   ✓ Done');
      await sleep(INTER_DEPLOY_DELAY_MS);
    }

    // 3e. Bootstrap hub MONSHI binding (one-shot). Skip if monshiToken already set.
    const currentMonshi = await hub.contract.monshiToken();
    if (currentMonshi !== '0x0000000000000000000000000000000000000000') {
      console.log(`⏭  Hub already has monshiToken=${currentMonshi}, skipping bootstrapMonshi`);
    } else {
      console.log('🔧 Hub.bootstrapMonshi(MONSHI) ...');
      await sendWithRetry('bootstrapMonshi', (ov) =>
        ov ? hub.contract.bootstrapMonshi(MONSHI, ov)
           : hub.contract.bootstrapMonshi(MONSHI)
      );
      console.log('   ✓ Done');
      await sleep(INTER_DEPLOY_DELAY_MS);
    }

    // 3f. Create MONSHI staking pool. Skip if pool already exists for MONSHI in PoolFactory.
    let monshiPoolAddr = await poolFactory.contract.tokenToPool(MONSHI);
    if (monshiPoolAddr !== '0x0000000000000000000000000000000000000000') {
      console.log(`⏭  MONSHI pool already exists at ${monshiPoolAddr}, skipping adminCreatePool`);
    } else {
      console.log('🔧 PoolFactory.adminCreatePool(MONSHI, BUYBACK, true) ...');
      const { receipt: r3 } = await sendWithRetry('adminCreatePool', (ov) =>
        ov ? poolFactory.contract.adminCreatePool(MONSHI, BUYBACK, true, ov)
           : poolFactory.contract.adminCreatePool(MONSHI, BUYBACK, true)
      );
      monshiPoolAddr = null;
      for (const log of r3.logs) {
        try {
          const parsed = poolFactory.contract.interface.parseLog(log);
          if (parsed && parsed.name === 'PoolCreated') { monshiPoolAddr = parsed.args.pool; break; }
        } catch {}
      }
      if (!monshiPoolAddr) {
        console.error('❌ Could not extract MONSHI pool address from PoolCreated event');
        process.exit(1);
      }
      console.log('   ✓ MONSHI pool:', monshiPoolAddr);
      await sleep(INTER_DEPLOY_DELAY_MS);
    }
    deployed.monshiPool = monshiPoolAddr;

    // 3g. Queue setMonshiStakingPool on factory (24h timelock).
    //     Skip if already queued OR if the value is already set on the factory directly.
    const currentFactoryMonshiPool = await factory.contract.monshiStakingPool();
    if (currentFactoryMonshiPool === monshiPoolAddr) {
      console.log(`⏭  Factory.monshiStakingPool already set to ${monshiPoolAddr}, skipping queue`);
    } else {
      console.log('🔧 Factory.queueSetMonshiStakingPool(monshiPool) (24h timelock; execute later) ...');
      await sendWithRetry('queueSetMonshiStakingPool', (ov) =>
        ov ? factory.contract.queueSetMonshiStakingPool(monshiPoolAddr, ov)
           : factory.contract.queueSetMonshiStakingPool(monshiPoolAddr)
      );
      console.log('   ✓ Queued. After 24h, run:');
      console.log(`      cast send ${factory.addr} "executeSetMonshiStakingPool(address)" ${monshiPoolAddr}`);
    }
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
