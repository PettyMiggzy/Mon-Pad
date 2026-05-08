// Run ~24 hours after the deploy.js timelock queue tx.
// Executes Factory.executeSetMonshiStakingPool(monshiPool) — the only timelock-gated
// step the deploy script left as a manual follow-up.
//
// Usage:
//   cd deploy/v2
//   node execute-monshi-pool.js
//
// Reads addresses from deployed.json. Same .env as deploy.js (PRIVATE_KEY, RPC).

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const PK = process.env.PRIVATE_KEY;
const PRIMARY_RPC = process.env.PRIMARY_RPC || 'https://rpc.monad.xyz';
const FALLBACK_RPC = process.env.FALLBACK_RPC || PRIMARY_RPC;

if (!PK) { console.error('❌ Set PRIVATE_KEY in deploy/v2/.env'); process.exit(1); }

async function main() {
  const deployed = JSON.parse(fs.readFileSync(path.join(__dirname, 'deployed.json'), 'utf8'));
  const FACTORY = deployed.contracts.factory;
  const MONSHI_POOL = deployed.contracts.monshiPool;
  if (!FACTORY || !MONSHI_POOL) {
    console.error('❌ deployed.json missing factory or monshiPool. Run deploy.js first.');
    process.exit(1);
  }

  const providers = [
    { provider: new ethers.JsonRpcProvider(PRIMARY_RPC, { chainId: 143, name: 'Monad' }), priority: 1, weight: 1, stallTimeout: 2000 },
  ];
  if (FALLBACK_RPC && FALLBACK_RPC !== PRIMARY_RPC) {
    providers.push({ provider: new ethers.JsonRpcProvider(FALLBACK_RPC, { chainId: 143, name: 'Monad' }), priority: 2, weight: 1, stallTimeout: 2000 });
  }
  const provider = new ethers.FallbackProvider(providers, 143, { quorum: 1 });
  const wallet = new ethers.Wallet(PK, provider);

  const factoryAbi = [
    'function executeSetMonshiStakingPool(address v) external',
    'function monshiStakingPool() view returns (address)',
    'function pendingOps(bytes32) view returns (uint64 readyAt, bytes encodedValue)',
    'function OP_MONSHI_STAKING_POOL() view returns (bytes32)',
  ];
  const factory = new ethers.Contract(FACTORY, factoryAbi, wallet);

  const current = await factory.monshiStakingPool();
  if (current.toLowerCase() === MONSHI_POOL.toLowerCase()) {
    console.log(`✅ Factory.monshiStakingPool already set to ${current}. Nothing to do.`);
    return;
  }

  // Read pending op to confirm it's ready
  const opKey = await factory.OP_MONSHI_STAKING_POOL();
  const pending = await factory.pendingOps(opKey);
  if (pending.readyAt === 0n) {
    console.error('❌ No pending queueSetMonshiStakingPool op. Did you run deploy.js?');
    process.exit(1);
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(pending.readyAt) > now) {
    const waitS = Number(pending.readyAt) - now;
    const hours = Math.floor(waitS / 3600);
    const minutes = Math.floor((waitS % 3600) / 60);
    console.error(`❌ Timelock not yet expired. Wait ${hours}h ${minutes}m more (ready at ${new Date(Number(pending.readyAt) * 1000).toISOString()})`);
    process.exit(1);
  }

  console.log(`🔧 Factory.executeSetMonshiStakingPool(${MONSHI_POOL}) ...`);
  const tx = await factory.executeSetMonshiStakingPool(MONSHI_POOL);
  console.log(`   tx: ${tx.hash}`);
  await tx.wait();
  const finalAddr = await factory.monshiStakingPool();
  console.log(`✅ Done. Factory.monshiStakingPool() = ${finalAddr}`);
}

main().catch(e => { console.error(e); process.exit(1); });
