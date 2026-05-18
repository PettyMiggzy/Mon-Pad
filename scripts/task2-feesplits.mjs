import { createPublicClient, http, toEventSelector, decodeEventLog, encodeFunctionData, parseEther, toFunctionSelector } from 'viem';
const RPC = 'https://rpc.monad.xyz';
const client = createPublicClient({ transport: http(RPC) });
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const POOL_FACTORY = '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6';
const PLATFORM = '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16';
const KING     = '0xB9d4B73bE18914c6d64Bee65a806648370be467f';
const STAKING_HUB = '0xd634b554860c09a7137aAB482CDF916129ba44aB';
const NON_OWNER = '0x0000000000000000000000000000000000000001';

// 1) Try allTokens(uint256) with the exact ABI in lib/constants.js
async function findToken() {
  // a) try allTokens with index 0..3
  const abi = [{type:'function', name:'allTokens', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'address'}]}];
  for (const i of [0n,1n,2n,3n]) {
    try {
      const t = await client.readContract({ address: FACTORY_V2, abi, functionName:'allTokens', args:[i] });
      console.log(`  allTokens(${i}) = ${t}`);
      if (t && t !== '0x0000000000000000000000000000000000000000') return t;
    } catch (e) {
      console.log(`  allTokens(${i}) reverted`);
      break;
    }
  }
  // b) try allLaunches
  for (const name of ['allLaunches','launches','tokens']) {
    const a2 = [{type:'function', name, stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'address'}]}];
    try {
      const t = await client.readContract({ address: FACTORY_V2, abi: a2, functionName: name, args:[0n] });
      console.log(`  ${name}(0) = ${t}`);
      if (t && t !== '0x0000000000000000000000000000000000000000') return t;
    } catch {}
  }
  // c) scan event logs for any event from FACTORY_V2 in last 5000 blocks
  const head = await client.getBlockNumber();
  console.log(`  head block: ${head}`);
  for (const span of [2000n, 5000n, 20000n]) {
    try {
      const logs = await client.getLogs({ address: FACTORY_V2, fromBlock: head - span, toBlock: head });
      console.log(`  logs in last ${span} blocks: ${logs.length}`);
      if (logs.length) {
        // print topic0s observed
        const topics = new Set(logs.map(l=>l.topics[0]));
        console.log(`  unique topic0s: ${[...topics].join(', ')}`);
        // try to extract addresses from data/topics
        for (const l of logs.slice(0,5)) {
          console.log(`    blk=${l.blockNumber} topics=${(l.topics||[]).slice(0,3).join(',')} data=${l.data.slice(0,138)}...`);
        }
        // crude: look for any 20-byte chunk that is a contract
        return null; // we'll print the logs for human inspection
      }
    } catch (e) {
      console.log(`  getLogs span=${span} failed: ${(e.shortMessage||e.message||'').slice(0,200)}`);
    }
  }
  return null;
}

async function tokToCurve(token) {
  const abi = [{type:'function', name:'tokToCurve', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'address'}]}];
  try {
    return await client.readContract({ address: FACTORY_V2, abi, functionName:'tokToCurve', args:[token] });
  } catch { return null; }
}

async function checkCreatePoolAccess() {
  console.log('\n--- POOL_FACTORY.createPool access check ---');
  const abi = [{type:'function', name:'createPool', stateMutability:'nonpayable', inputs:[{type:'address'}], outputs:[{type:'address'}]}];
  const data = encodeFunctionData({ abi, functionName:'createPool', args:['0x000000000000000000000000000000000000dEaD'] });
  // simulate from non-owner
  try {
    const r = await client.call({ account: NON_OWNER, to: POOL_FACTORY, data });
    console.log(`  from non-owner ${NON_OWNER} -> SUCCESS, return=${r.data || '(empty)'}`);
  } catch (e) {
    const msg = (e.shortMessage || e.message || '').split('\n').slice(0,3).join(' | ');
    console.log(`  from non-owner ${NON_OWNER} -> REVERT: ${msg}`);
  }
  // simulate from owner
  try {
    const r = await client.call({ account: KING, to: POOL_FACTORY, data });
    console.log(`  from owner    ${KING} -> SUCCESS, return=${r.data || '(empty)'}`);
  } catch (e) {
    const msg = (e.shortMessage || e.message || '').split('\n').slice(0,3).join(' | ');
    console.log(`  from owner    ${KING} -> REVERT: ${msg}`);
  }
}

async function main() {
  console.log('=== Task 2 ===');
  console.log('\n--- finding a real Mon-Pad token ---');
  const token = await findToken();
  if (!token) {
    console.log('  no token discovered automatically; will need King to paste one.');
  } else {
    console.log(`  using token: ${token}`);
    const curve = await tokToCurve(token);
    console.log(`  tokToCurve(${token}) = ${curve}`);
  }
  await checkCreatePoolAccess();
}
main().catch(e=>{console.error(e); process.exit(1)});
