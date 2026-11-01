// Run: npx tsx scripts/pet-receipt.mts   (needs network)
// Checks the MONSHI payment matcher against a REAL on-chain MONSHI transfer, not invented logs.
import { createPublicClient, decodeEventLog, http, parseAbi } from 'viem';
import { findTransfer } from '../lib/pet/server';

const abi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const MONSHI = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777'.toLowerCase();
const TX = '0xf4dabbcde306d9804c73e3b883f2d0b5f8ebfb22ddb6789cb63d56c5e496c06f'; // a real MONSHI buy on Monad
const client = createPublicClient({ transport: http('https://rpc.monad.xyz') });
const receipt = await client.getTransactionReceipt({ hash: TX });
const log = receipt.logs.find((l) => l.address.toLowerCase() === MONSHI)!;
const ev: any = decodeEventLog({ abi, data: log.data, topics: log.topics as any });
const { from, to, value } = ev.args as { from: string; to: string; value: bigint };
const ok = (n: string, c: boolean) => { console.log(c ? 'PASS' : 'FAIL', n); if (!c) process.exitCode = 1; };
console.log(`real transfer: ${value / 10n ** 18n} MONSHI  ${from.slice(0, 8)} -> ${to.slice(0, 8)}`);
ok('real receipt: exact payment matches', findTransfer(receipt.logs as any, from, to, value) === value);
ok('real receipt: asking for 1 wei more is rejected', findTransfer(receipt.logs as any, from, to, value + 1n) === null);
ok('real receipt: wrong sender rejected', findTransfer(receipt.logs as any, to, to, 1n) === null);
