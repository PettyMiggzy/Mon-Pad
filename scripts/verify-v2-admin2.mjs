import { createPublicClient, http, toFunctionSelector } from 'viem';
const RPC = 'https://rpc.monad.xyz';
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const client = createPublicClient({ transport: http(RPC) });

const getters = [
  ['maxDevBuyBps', []],
  ['devBuyBps', []],
  ['pauseNewLaunches', []],
  ['paused', []],
  ['rewardRouter', []],
  ['feeReceiver', []],
  ['treasury', []],
  ['platform', []],
  ['owner', []],
];
const setters = [
  'setCreationFee(uint256)',
  'setGraduationTarget(uint256)',
  'setGraduationCreatorReward(uint256)',
  'setMaxDevBuyBps(uint256)',
  'setRewardRouter(address)',
  'setPauseNewLaunches(bool)',
  'setBlocked(address,bool)',
];
const createSigs = [
  'createLaunch(string,string,string,address)',
  'createLaunch(string,string)',
  'createLaunch(string,string,string)',
];

async function main() {
  const code = (await client.getBytecode({ address: FACTORY_V2 })).toLowerCase();
  console.log('--- GETTERS ---');
  for (const [name, args] of getters) {
    const out = name === 'paused' || name === 'pauseNewLaunches' ? [{type:'bool'}] : [{type:name.startsWith('owner')||name==='treasury'||name==='platform'||name==='rewardRouter'||name==='feeReceiver'?'address':'uint256'}];
    const abi = [{type:'function', stateMutability:'view', name, inputs: [], outputs: out}];
    try {
      const v = await client.readContract({ address: FACTORY_V2, abi, functionName: name, args });
      console.log(`  ${name}() -> ${typeof v==='bigint'?v.toString():v}`);
    } catch (e) {
      console.log(`  ${name}() -> REVERT`);
    }
  }
  console.log('\n--- SETTERS in bytecode ---');
  for (const sig of setters) {
    const sel = toFunctionSelector(sig);
    const present = code.includes(sel.slice(2));
    console.log(`  ${sig} [${sel}] -> ${present ? 'PRESENT' : 'missing'}`);
  }
  console.log('\n--- CREATE signatures in bytecode ---');
  for (const sig of createSigs) {
    const sel = toFunctionSelector(sig);
    const present = code.includes(sel.slice(2));
    console.log(`  ${sig} [${sel}] -> ${present ? 'PRESENT' : 'missing'}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
