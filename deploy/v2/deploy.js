// Deploy script for MonPad V2 contracts
// Run with: node deploy/v2/deploy.js
//
// Required env:
//   PRIVATE_KEY - deployer's private key (hex, no 0x prefix)
//   RPC_URL - Monad RPC endpoint
//   PLATFORM_WALLET - platform wallet address (collects 1% sell, 1% buy buffer at grad)
//   TREASURY_WALLET - treasury wallet (collects creation fees)
//   BUYBACK_WALLET - buyback wallet (collects 0.5% sell tax until staking router live)
//   MONSHI_TOKEN - MONSHI token address (for staking system)
//   WMON - Wrapped MON address
//   DEX_ROUTER - existing Uniswap V2-style router (for swap)
//
// Optional env:
//   DEPLOY_STAKING - set to "1" to deploy staking system
//   DEPLOY_SWAP - set to "1" to deploy swap wrapper

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Multi-RPC: PRIMARY_RPC first (paid), FALLBACK_RPC second (public). Backward compat: RPC_URL still works.
const PRIMARY_RPC = process.env.PRIMARY_RPC || process.env.RPC_URL || 'https://rpc.monad.xyz';
const FALLBACK_RPC = process.env.FALLBACK_RPC || 'https://rpc.monad.xyz';
const PK = process.env.PRIVATE_KEY;

if (!PK) {
  console.error('❌ Set PRIVATE_KEY in deploy/v2/.env');
  process.exit(1);
}

const REQUIRED_WALLETS = ['PLATFORM_WALLET', 'TREASURY_WALLET', 'BUYBACK_WALLET'];
for (const k of REQUIRED_WALLETS) {
  if (!process.env[k]) { console.error(`❌ Set ${k} in deploy/v2/.env`); process.exit(1); }
}

function loadContract(name) {
  const p = path.join(__dirname, 'build', name + '.json');
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
  // FallbackProvider: tries primary first, falls back on failure. priority=1 = highest.
  const providers = [
    { provider: new ethers.JsonRpcProvider(PRIMARY_RPC, { chainId: 143, name: 'Monad' }), priority: 1, weight: 1, stallTimeout: 2000 },
  ];
  if (FALLBACK_RPC && FALLBACK_RPC !== PRIMARY_RPC) {
    providers.push({ provider: new ethers.JsonRpcProvider(FALLBACK_RPC, { chainId: 143, name: 'Monad' }), priority: 2, weight: 1, stallTimeout: 2000 });
  }
  const provider = new ethers.FallbackProvider(providers, 143, { quorum: 1 });
  const wallet = new ethers.Wallet(PK, provider);
  
  console.log('🚀 MONPAD V2 DEPLOYMENT');
  console.log('   Network:', RPC);
  console.log('   Deployer:', wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log('   Balance:', ethers.formatEther(bal), 'MON');
  
  if (bal < ethers.parseEther('1')) {
    console.error('❌ Need at least 1 MON for gas');
    process.exit(1);
  }
  
  const PLATFORM = process.env.PLATFORM_WALLET;
  const TREASURY = process.env.TREASURY_WALLET;
  const BUYBACK = process.env.BUYBACK_WALLET;
  
  const deployed = {};
  
  // 1. Factory V2
  const factory = await deploy(wallet, 'MonPadFactoryV2', [PLATFORM, TREASURY, BUYBACK]);
  deployed.factory = factory.addr;
  
  // 2. Vesting (no constructor args needed)
  const vesting = await deploy(wallet, 'MonPadVesting');
  deployed.vesting = vesting.addr;
  
  // 3. Staking system (optional)
  if (process.env.DEPLOY_STAKING === '1') {
    const MONSHI = process.env.MONSHI_TOKEN;
    if (!MONSHI) { console.error('❌ Set MONSHI_TOKEN to deploy staking'); process.exit(1); }
    
    const hub = await deploy(wallet, 'MonPadStakingHub', [factory.addr, MONSHI]);
    deployed.stakingHub = hub.addr;
    
    const poolFactory = await deploy(wallet, 'MonPadPoolFactory', [hub.addr, factory.addr, MONSHI, BUYBACK]);
    deployed.poolFactory = poolFactory.addr;
    
    // Transfer hub ownership to pool factory so it can register pools
    console.log('🔧 Transferring hub ownership to PoolFactory...');
    const tx1 = await hub.contract.transferOwnership(poolFactory.addr);
    await tx1.wait();
    console.log('   ✓ Done');
    
    // Wire up: factory.setRewardRouter(hub) — directs sell-tax 0.5% to hub
    console.log('🔧 Setting factory rewardRouter = hub...');
    const tx2 = await factory.contract.setRewardRouter(hub.addr);
    await tx2.wait();
    console.log('   ✓ Done');
    
    // Create MONSHI staking pool — burnsToCreator=true so vault routes to creator (=deployer=buyback) instead of DEAD
    console.log('🔧 Creating MONSHI staking pool...');
    const tx3 = await poolFactory.contract.adminCreatePool(MONSHI, wallet.address, true);
    const receipt3 = await tx3.wait();
    // Find PoolCreated event for pool address
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
    if (monshiPoolAddr) {
      deployed.monshiPool = monshiPoolAddr;
      console.log('   ✓ MONSHI pool:', monshiPoolAddr);
      // Set on factory
      const tx4 = await factory.contract.setMonshiStakingPool(monshiPoolAddr);
      await tx4.wait();
      console.log('   ✓ Set on factory');
    }
  }
  
  // 4. Swap (optional)
  if (process.env.DEPLOY_SWAP === '1') {
    const ROUTER = process.env.DEX_ROUTER;
    const WMON = process.env.WMON;
    if (!ROUTER || !WMON) { console.error('❌ Set DEX_ROUTER and WMON for swap'); process.exit(1); }
    
    const swap = await deploy(wallet, 'MonPadSwap', [ROUTER, WMON, BUYBACK]);
    deployed.swap = swap.addr;
  }
  
  // Save deployment
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
      router: process.env.DEX_ROUTER || null,
    }
  };
  fs.writeFileSync(path.join(__dirname, 'deployed.json'), JSON.stringify(out, null, 2));
  console.log('\n💾 Saved to deploy/v2/deployed.json');
  console.log('\n✅ DEPLOYMENT COMPLETE');
  console.log(JSON.stringify(deployed, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
