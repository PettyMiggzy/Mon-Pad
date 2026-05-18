import { createPublicClient, http, getContract, isAddressEqual } from 'viem';

const RPC_PRIMARY = 'https://rpc.monad.xyz';
const RPC_FALLBACK = 'https://rpc2.monad.xyz';
const CHAIN_ID = 143;

const FACTORY_V2   = '0x0ec606736125499D7daFaf0B286cC1375592569C';
const POOL_FACTORY = '0x009435C220C157ceeE2EcD2d8dcE907D7697daa6';
const EXPECTED_OWNER = '0xB9d4B73bE18914c6d64Bee65a806648370be467f';

const monad = { id: CHAIN_ID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [RPC_PRIMARY] } } };

async function makeClient() {
  for (const url of [RPC_PRIMARY, RPC_FALLBACK]) {
    try {
      const c = createPublicClient({ chain: { ...monad, rpcUrls: { default: { http: [url] } } }, transport: http(url) });
      const id = await c.getChainId();
      if (id !== CHAIN_ID) throw new Error(`chainId mismatch: got ${id} expected ${CHAIN_ID} from ${url}`);
      console.log(`[ok] RPC ${url} chainId=${id}`);
      return c;
    } catch (e) {
      console.log(`[warn] RPC ${url} failed: ${e.message}`);
    }
  }
  throw new Error('Both RPCs failed');
}

async function tryRead(client, address, name, args = []) {
  // build minimal abi entries for each name
  const abiMap = {
    owner:           { name: 'owner', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
    paused:          { name: 'paused', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'bool'}] },
    treasury:        { name: 'treasury', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
    platform:        { name: 'platform', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
    creationFee:     { name: 'creationFee', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
    graduationTarget:{ name: 'graduationTarget', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
    allTokens:       { name: 'allTokens', type:'function', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'address'}] },
    monshiPool:      { name: 'monshiPool', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
    getPool:         { name: 'getPool', type:'function', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'address'}] },
  };
  const abi = [abiMap[name]];
  try {
    const out = await client.readContract({ address, abi, functionName: name, args });
    return { ok: true, value: out };
  } catch (e) {
    return { ok: false, error: (e.shortMessage || e.message || '').split('\n')[0] };
  }
}

function fmt(v) { return typeof v === 'bigint' ? v.toString() : v; }

async function main() {
  const client = await makeClient();
  for (const [label, addr] of [['FACTORY_V2', FACTORY_V2], ['POOL_FACTORY', POOL_FACTORY]]) {
    console.log(`\n=== ${label} (${addr}) ===`);
    const code = await client.getBytecode({ address: addr });
    const hasCode = !!code && code !== '0x';
    console.log(`bytecode: ${hasCode ? 'YES' : 'NO'} (${hasCode ? (code.length-2)/2 : 0} bytes)`);
    if (!hasCode) continue;

    const probes = label === 'FACTORY_V2'
      ? [['owner',[]],['paused',[]],['treasury',[]],['platform',[]],['creationFee',[]],['graduationTarget',[]],['allTokens',[0n]]]
      : [['owner',[]],['monshiPool',[]],['getPool',['0x0000000000000000000000000000000000000000']]];

    for (const [fn, args] of probes) {
      const r = await tryRead(client, addr, fn, args);
      if (r.ok) {
        console.log(`  ${fn}(${args.map(fmt).join(',')}) -> ${fmt(r.value)}`);
        if (fn === 'owner') {
          const match = isAddressEqual(r.value, EXPECTED_OWNER);
          console.log(`    owner match expected (${EXPECTED_OWNER})? ${match ? 'YES' : 'NO'}`);
        }
      } else {
        console.log(`  ${fn}(${args.map(fmt).join(',')}) -> REVERT/ERROR: ${r.error}`);
      }
    }
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
