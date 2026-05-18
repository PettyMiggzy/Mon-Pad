import { createPublicClient, http, encodeFunctionData, parseEther } from 'viem';
const RPC = 'https://rpc.monad.xyz';
const client = createPublicClient({ transport: http(RPC) });
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const POOL_FACTORY = '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6';
const NON_OWNER = '0x0000000000000000000000000000000000000001';

const tx1 = '0xb7d8622500000000000000000000000000000000000000000000000056bc75e2d63100000000';
const tx2 = '0x5ae8f06d00000000000000000000000000000000000000000000059ff4bd17d7e97a0000';

function inspect(label, hex) {
  const noPrefix = hex.startsWith('0x') ? hex.slice(2) : hex;
  const chars = noPrefix.length;
  const bytes = chars/2;
  const selector = '0x' + noPrefix.slice(0,8);
  const arg = noPrefix.slice(8);
  const argBytes = arg.length/2;
  const argBigInt = BigInt('0x'+arg);
  console.log(`${label}:`);
  console.log(`  full hex (after 0x): ${chars} chars (${bytes} bytes)`);
  console.log(`  selector: ${selector}`);
  console.log(`  arg hex: 0x${arg} (${argBytes} bytes)`);
  console.log(`  arg decimal: ${argBigInt.toString()}`);
  console.log(`  arg / 1e18: ${Number(argBigInt) / 1e18}`);
  console.log(`  canonical 4+32 = 68 bytes = 136 chars? ${chars === 136 ? 'YES' : 'NO'}`);
}

console.log('=== Calldata sanity ===\n');
inspect('TX1 setCreationFee(100 MON)', tx1);
console.log('');
inspect('TX2 setGraduationTarget(425000 MON)', tx2);

// Re-encode canonically with viem to compare
const abi = [
  { type:'function', name:'setCreationFee', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
  { type:'function', name:'setGraduationTarget', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
];
const c1 = encodeFunctionData({abi, functionName:'setCreationFee', args:[100n*10n**18n]});
const c2 = encodeFunctionData({abi, functionName:'setGraduationTarget', args:[425000n*10n**18n]});
console.log('\n=== Canonical viem re-encoding ===');
console.log(`canonical TX1: ${c1}  (${c1.length-2} chars)`);
console.log(`canonical TX2: ${c2}  (${c2.length-2} chars)`);
console.log(`TX1 matches canonical? ${tx1.toLowerCase() === c1.toLowerCase() ? 'YES' : 'NO'}`);
console.log(`TX2 matches canonical? ${tx2.toLowerCase() === c2.toLowerCase() ? 'YES' : 'NO'}`);

console.log('\n=== createPool(value: 200 MON) from non-owner sim ===');
const poolAbi = [{type:'function', name:'createPool', stateMutability:'payable', inputs:[{type:'address'}], outputs:[{type:'address'}]}];
const poolData = encodeFunctionData({ abi: poolAbi, functionName:'createPool', args:['0x000000000000000000000000000000000000dEaD'] });
try {
  const r = await client.call({ account: NON_OWNER, to: POOL_FACTORY, data: poolData, value: parseEther('200') });
  console.log(`  -> SUCCESS, return=${r.data || '(empty)'}`);
} catch (e) {
  const msg = (e.shortMessage || e.message || '').split('\n').slice(0,4).join(' | ');
  console.log(`  -> REVERT: ${msg}`);
}
