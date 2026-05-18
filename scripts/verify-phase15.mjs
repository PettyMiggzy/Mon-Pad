import { createPublicClient, http, toFunctionSelector, isAddressEqual } from 'viem';
const RPC = 'https://rpc.monad.xyz';
const client = createPublicClient({ transport: http(RPC) });

const FACTORY_V2   = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const POOL_FACTORY = '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6';
const STAKING_HUB  = '0xd634b554860c09a7137aAB482CDF916129ba44aB';
const KING         = '0xB9d4B73bE18914c6d64Bee65a806648370be467f';
const PLATFORM_EXP = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16';

async function callView(addr, name, inputs, outputs) {
  const abi = [{type:'function', stateMutability:'view', name, inputs, outputs}];
  try {
    const v = await client.readContract({ address: addr, abi, functionName: name, args: [] });
    return { ok:true, v: typeof v === 'bigint' ? v.toString() : v };
  } catch (e) {
    return { ok:false };
  }
}
async function callViewArgs(addr, name, inputs, outputs, args) {
  const abi = [{type:'function', stateMutability:'view', name, inputs, outputs}];
  try {
    const v = await client.readContract({ address: addr, abi, functionName: name, args });
    return { ok:true, v: typeof v === 'bigint' ? v.toString() : v };
  } catch (e) {
    return { ok:false };
  }
}

function selPresent(code, sig) {
  const sel = toFunctionSelector(sig);
  return { sel, present: code.toLowerCase().includes(sel.slice(2).toLowerCase()) };
}

async function section1_factoryWallets() {
  console.log('\n===== 1. FACTORY_V2 fee-routing wallets =====');
  const names = ['platformWallet','treasuryWallet','buybackWallet','platform','treasury','feeReceiver','feeRecipient','platformFeeRecipient','creatorFeeRecipient','router','rewardRouter'];
  for (const n of names) {
    const r = await callView(FACTORY_V2, n, [], [{type:'address'}]);
    if (r.ok) console.log(`  ${n}() -> ${r.v}`);
  }
  const code = (await client.getBytecode({address: FACTORY_V2})).toLowerCase();
  console.log('\n  selector presence (any *Wallet/*Recipient setters or getters):');
  const probes = [
    'platformWallet()','treasuryWallet()','buybackWallet()','feeReceiver()','feeRecipient()',
    'setPlatformWallet(address)','setTreasuryWallet(address)','setBuybackWallet(address)','setFeeReceiver(address)',
  ];
  for (const sig of probes) {
    const { sel, present } = selPresent(code, sig);
    console.log(`    ${sig} [${sel}] -> ${present?'PRESENT':'missing'}`);
  }
}

async function section2_feeBps() {
  console.log('\n===== 2. Fee split BPS on FACTORY_V2 =====');
  const names = [
    'buyFeeBps','sellFeeBps','buyFeeTotalBps','sellFeeTotalBps','tradeFeeBps',
    'platformFeeBps','creatorFeeBps','stakingFeeBps','treasuryFeeBps',
    'buyPlatformFeeBps','buyCreatorFeeBps','sellPlatformFeeBps','sellCreatorFeeBps','sellStakingFeeBps',
    'feeBps','protocolFeeBps','swapFeeBps'
  ];
  for (const n of names) {
    const r = await callView(FACTORY_V2, n, [], [{type:'uint256'}]);
    if (r.ok) console.log(`  ${n}() -> ${r.v}`);
  }
  const code = (await client.getBytecode({address: FACTORY_V2})).toLowerCase();
  console.log('\n  *FeeBps* selectors searched in bytecode:');
  for (const n of names) {
    const { sel, present } = selPresent(code, `${n}()`);
    if (present) console.log(`    ${n}() [${sel}] PRESENT`);
  }
}

async function section3_stakingHub() {
  console.log('\n===== 3. STAKING_HUB =====');
  const code = await client.getBytecode({address: STAKING_HUB});
  if (!code || code === '0x') { console.log('  bytecode: NO'); return; }
  console.log(`  bytecode: YES (${(code.length-2)/2} bytes)`);
  const owner = await callView(STAKING_HUB, 'owner', [], [{type:'address'}]);
  if (owner.ok) {
    console.log(`  owner() -> ${owner.v} (matches King? ${isAddressEqual(owner.v, KING)?'YES':'NO'})`);
  } else console.log('  owner() -> REVERT');
  const addrViews = ['monshiPool','rewardToken','stakingToken','feeToken','treasury','factory'];
  for (const n of addrViews) {
    const r = await callView(STAKING_HUB, n, [], [{type:'address'}]);
    if (r.ok) console.log(`  ${n}() -> ${r.v}`);
  }
  const uintViews = ['totalStaked','totalShares','poolCount','epochLength','rewardPerSecond'];
  for (const n of uintViews) {
    const r = await callView(STAKING_HUB, n, [], [{type:'uint256'}]);
    if (r.ok) console.log(`  ${n}() -> ${r.v}`);
  }
  const r2 = await callViewArgs(STAKING_HUB, 'pools', [{type:'uint256'}], [{type:'address'}], [0n]);
  if (r2.ok) console.log(`  pools(0) -> ${r2.v}`);
  const lc = code.toLowerCase();
  console.log('\n  function selector presence:');
  const sigs = ['stake(uint256)','unstake(uint256)','claimRewards()','claim()','stake(uint256,uint8)','unstake(uint256)','exit()','getReward()','notifyReward(uint256)','route(address,uint256)'];
  for (const sig of sigs) {
    const { sel, present } = selPresent(lc, sig);
    console.log(`    ${sig} [${sel}] -> ${present?'PRESENT':'missing'}`);
  }
}

async function section4_poolFactory() {
  console.log('\n===== 4. POOL_FACTORY interface =====');
  const code = (await client.getBytecode({address: POOL_FACTORY})).toLowerCase();
  const owner = await callView(POOL_FACTORY, 'owner', [], [{type:'address'}]);
  if (owner.ok) console.log(`  owner() -> ${owner.v}`);

  const addrViews = ['monshiStakingPool','monshiPool','treasury','rewardToken','factory','implementation','staking'];
  for (const n of addrViews) {
    const r = await callView(POOL_FACTORY, n, [], [{type:'address'}]);
    if (r.ok) console.log(`  ${n}() -> ${r.v}`);
  }
  const r1 = await callViewArgs(POOL_FACTORY, 'pools', [{type:'uint256'}], [{type:'address'}], [0n]);
  if (r1.ok) console.log(`  pools(0) -> ${r1.v}`);
  const r2 = await callViewArgs(POOL_FACTORY, 'allPools', [{type:'uint256'}], [{type:'address'}], [0n]);
  if (r2.ok) console.log(`  allPools(0) -> ${r2.v}`);
  const r3 = await callViewArgs(POOL_FACTORY, 'tokenToPool', [{type:'address'}], [{type:'address'}], ['0x0000000000000000000000000000000000000000']);
  if (r3.ok) console.log(`  tokenToPool(0x0) -> ${r3.v}`);
  const r4 = await callViewArgs(POOL_FACTORY, 'getPoolForToken', [{type:'address'}], [{type:'address'}], ['0x0000000000000000000000000000000000000000']);
  if (r4.ok) console.log(`  getPoolForToken(0x0) -> ${r4.v}`);
  const r5 = await callView(POOL_FACTORY, 'allPoolsLength', [], [{type:'uint256'}]);
  if (r5.ok) console.log(`  allPoolsLength() -> ${r5.v}`);

  console.log('\n  selector presence in bytecode:');
  const sigs = [
    'createPool(address)','createPool(address,address)','createPool(address,uint256)',
    'getPool(address)','getPool(address,address)','getPoolForToken(address)',
    'pools(uint256)','allPools()','allPoolsLength()','tokenToPool(address)',
    'monshiPool()','monshiStakingPool()','setImplementation(address)','setMonshiPool(address)','setStaking(address)'
  ];
  for (const sig of sigs) {
    const { sel, present } = selPresent(code, sig);
    if (present) console.log(`    ${sig} [${sel}] PRESENT`);
  }
}

await section1_factoryWallets();
await section2_feeBps();
await section3_stakingHub();
await section4_poolFactory();
