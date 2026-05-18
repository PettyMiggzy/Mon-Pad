import { encodeFunctionData } from 'viem';
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const abi = [
  { type:'function', name:'setCreationFee', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
  { type:'function', name:'setGraduationTarget', stateMutability:'nonpayable', inputs:[{type:'uint256'}], outputs:[] },
];
const tx1 = { to: FACTORY_V2, data: encodeFunctionData({abi, functionName:'setCreationFee', args:[100000000000000000000n]}), value:'0x0', chainId: 143 };
const tx2 = { to: FACTORY_V2, data: encodeFunctionData({abi, functionName:'setGraduationTarget', args:[425000000000000000000000n]}), value:'0x0', chainId: 143 };
console.log('=== TX 1: setCreationFee(100 MON) ===');
console.log(JSON.stringify(tx1, null, 2));
console.log('\n=== TX 2: setGraduationTarget(425,000 MON) ===');
console.log(JSON.stringify(tx2, null, 2));
