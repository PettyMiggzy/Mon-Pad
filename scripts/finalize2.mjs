import { createPublicClient, http, encodeFunctionData, parseEther, toFunctionSelector } from 'viem';
const RPC = 'https://rpc.monad.xyz';
const client = createPublicClient({ transport: http(RPC) });
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const POOL_FACTORY = '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6';
const NON_OWNER = '0x0000000000000000000000000000000000000001';

function manualEncode(sig, value) {
  const sel = toFunctionSelector(sig); // 0x + 8 hex
  const arg = value.toString(16).padStart(64, '0');
  return (sel + arg).toLowerCase();
}

const abi = [
  { type:'function', name:'setCreationFee', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
  { type:'function', name:'setGraduationTarget', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
];

const v1 = 100n * 10n**18n;          // 100 MON
const v2 = 425000n * 10n**18n;        // 425,000 MON

const manual1 = manualEncode('setCreationFee(uint256)', v1);
const manual2 = manualEncode('setGraduationTarget(uint256)', v2);
const viem1 = encodeFunctionData({abi, functionName:'setCreationFee', args:[v1]}).toLowerCase();
const viem2 = encodeFunctionData({abi, functionName:'setGraduationTarget', args:[v2]}).toLowerCase();

function report(label, manual, viem) {
  const m = manual.startsWith('0x') ? manual.slice(2) : manual;
  const v = viem.startsWith('0x') ? viem.slice(2) : viem;
  console.log(`\n--- ${label} ---`);
  console.log(`manual    : 0x${m}  (${m.length} chars, ${m.length/2} bytes)`);
  console.log(`viem      : 0x${v}  (${v.length} chars, ${v.length/2} bytes)`);
  console.log(`match?    : ${manual === viem ? 'YES' : 'NO'}`);
  console.log(`136 chars?: ${m.length === 136 ? 'YES' : 'NO'}`);
  // decode arg
  const arg = m.slice(8);
  const dec = BigInt('0x'+arg);
  console.log(`arg decimal: ${dec.toString()}`);
  console.log(`arg / 1e18 : ${(Number(dec/10n**15n))/1000}`);
}
report('TX1 setCreationFee(100 MON)', manual1, viem1);
report('TX2 setGraduationTarget(425000 MON)', manual2, viem2);

console.log('\n=== createPool(value: 200 MON) from non-owner WITH state override ===');
const poolAbi = [{type:'function', name:'createPool', stateMutability:'payable', inputs:[{type:'address'}], outputs:[{type:'address'}]}];
const poolData = encodeFunctionData({ abi: poolAbi, functionName:'createPool', args:['0x000000000000000000000000000000000000dEaD'] });
try {
  const r = await client.call({
    account: NON_OWNER,
    to: POOL_FACTORY,
    data: poolData,
    value: parseEther('200'),
    stateOverride: [{ address: NON_OWNER, balance: parseEther('1000') }]
  });
  console.log(`  -> SUCCESS, return=${r.data || '(empty)'}`);
} catch (e) {
  const msg = (e.shortMessage || e.message || '').split('\n').slice(0,5).join(' | ');
  console.log(`  -> REVERT/ERROR: ${msg}`);
}
