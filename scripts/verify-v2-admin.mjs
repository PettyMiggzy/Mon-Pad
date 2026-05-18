import { createPublicClient, http, encodeFunctionData, toFunctionSelector } from 'viem';

const RPC = 'https://rpc.monad.xyz';
const FACTORY_V2 = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const client = createPublicClient({ transport: http(RPC) });

// Getters (read-only, will eth_call)
const getters = [
  { name: 'creationFee',            inputs: [], outputs: [{type:'uint256'}] },
  { name: 'graduationTarget',       inputs: [], outputs: [{type:'uint256'}] },
  { name: 'graduationCreatorReward',inputs: [], outputs: [{type:'uint256'}] },
  { name: 'creatorReward',          inputs: [], outputs: [{type:'uint256'}] },
  { name: 'graduationReward',       inputs: [], outputs: [{type:'uint256'}] },
  { name: 'minDevBuy',              inputs: [], outputs: [{type:'uint256'}] },
  { name: 'MIN_DEV_BUY',            inputs: [], outputs: [{type:'uint256'}] },
  { name: 'maxDevBuy',              inputs: [], outputs: [{type:'uint256'}] },
  { name: 'MAX_DEV_BUY',            inputs: [], outputs: [{type:'uint256'}] },
  { name: 'minInitialBuy',          inputs: [], outputs: [{type:'uint256'}] },
  { name: 'maxInitialBuy',          inputs: [], outputs: [{type:'uint256'}] },
];

// Setters / write functions: we only check selector presence in bytecode
const setters = [
  { name: 'setCreationFee',             inputs: [{type:'uint256'}] },
  { name: 'setGraduationTarget',        inputs: [{type:'uint256'}] },
  { name: 'setGraduationCreatorReward', inputs: [{type:'uint256'}] },
  { name: 'setCreatorReward',           inputs: [{type:'uint256'}] },
  { name: 'setGraduationReward',        inputs: [{type:'uint256'}] },
  { name: 'setMinDevBuy',               inputs: [{type:'uint256'}] },
  { name: 'setMaxDevBuy',               inputs: [{type:'uint256'}] },
  { name: 'setMinInitialBuy',           inputs: [{type:'uint256'}] },
  { name: 'setMaxInitialBuy',           inputs: [{type:'uint256'}] },
  { name: 'setFee',                     inputs: [{type:'uint256'}] },
  { name: 'setTarget',                  inputs: [{type:'uint256'}] },
];

// Likely create functions — test selector presence in bytecode
const createCandidates = [
  // (string,string)
  { name: 'createLaunch',  inputs: [{type:'string'},{type:'string'}] },
  { name: 'createToken',   inputs: [{type:'string'},{type:'string'}] },
  // (string,string,string)
  { name: 'createLaunch',  inputs: [{type:'string'},{type:'string'},{type:'string'}] },
  { name: 'createToken',   inputs: [{type:'string'},{type:'string'},{type:'string'}] },
  // (string,string,uint256)
  { name: 'createLaunch',  inputs: [{type:'string'},{type:'string'},{type:'uint256'}] },
  { name: 'createToken',   inputs: [{type:'string'},{type:'string'},{type:'uint256'}] },
  // (string,string,string,uint256)
  { name: 'createLaunch',  inputs: [{type:'string'},{type:'string'},{type:'string'},{type:'uint256'}] },
  { name: 'createToken',   inputs: [{type:'string'},{type:'string'},{type:'string'},{type:'uint256'}] },
  // launch / launchToken
  { name: 'launch',        inputs: [{type:'string'},{type:'string'}] },
  { name: 'launchToken',   inputs: [{type:'string'},{type:'string'}] },
  { name: 'deploy',        inputs: [{type:'string'},{type:'string'}] },
];

function sigOf(f) {
  return `${f.name}(${(f.inputs||[]).map(i=>i.type).join(',')})`;
}
function selectorOf(f) {
  return toFunctionSelector(sigOf(f));
}

async function readGetter(g) {
  const abi = [{ type:'function', stateMutability:'view', name: g.name, inputs: g.inputs, outputs: g.outputs }];
  try {
    const v = await client.readContract({ address: FACTORY_V2, abi, functionName: g.name, args: [] });
    return { ok:true, value: typeof v === 'bigint' ? v.toString() : v };
  } catch (e) {
    return { ok:false, err: (e.shortMessage||e.message||'').split('\n')[0] };
  }
}

async function main() {
  const id = await client.getChainId();
  console.log(`chainId=${id} factory=${FACTORY_V2}`);

  const code = await client.getBytecode({ address: FACTORY_V2 });
  console.log(`bytecode bytes=${(code.length-2)/2}`);

  console.log('\n--- GETTERS (eth_call) ---');
  for (const g of getters) {
    const r = await readGetter(g);
    const sig = sigOf(g);
    const sel = selectorOf(g);
    const inCode = code.toLowerCase().includes(sel.slice(2).toLowerCase());
    if (r.ok) console.log(`  ${sig} [${sel}] selectorInCode=${inCode} -> ${r.value}`);
    else console.log(`  ${sig} [${sel}] selectorInCode=${inCode} -> REVERT (${r.err})`);
  }

  console.log('\n--- SETTERS (selector presence only, NOT called) ---');
  for (const s of setters) {
    const sig = sigOf(s);
    const sel = selectorOf(s);
    const inCode = code.toLowerCase().includes(sel.slice(2).toLowerCase());
    console.log(`  ${sig} [${sel}] selectorInCode=${inCode}`);
  }

  console.log('\n--- CREATE-FUNCTION CANDIDATES (selector presence only) ---');
  for (const c of createCandidates) {
    const sig = sigOf(c);
    const sel = selectorOf(c);
    const inCode = code.toLowerCase().includes(sel.slice(2).toLowerCase());
    if (inCode) console.log(`  ${sig} [${sel}] FOUND`);
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
