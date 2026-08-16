/* eslint-disable no-console */
// AUTO-GRADUATE keeper — fires graduate() the instant a pad hits its ceiling (the curve is fully sold).
//
// Graduation cannot run inside the crossing buy: it needs its own PoolManager.unlock, and the buy is already
// inside the singleton's lock. So something has to watch the pools and call graduate() when ready() flips.
// This is that something — graduation is automatic from the creator's and traders' point of view.
//
// The keeper does NOT subsidise anything. graduate() carves a bounty off the top of the raise —
// min(0.2%, 100 MON) — and pays it to msg.sender, so the curve's own MON covers the trigger gas and leaves a
// tip. On Monad that margin is the whole reason this works: gas is charged on the transaction's GAS LIMIT
// rather than gas used, so a 5M-limit call at ~100 gwei costs ~0.5 MON against a 100 MON bounty. (The ported
// 0.02 ETH cap would have been ~0.02 MON — 25x less than the cost of claiming it, and no pad would ever
// graduate. See PORT-NOTES.md §1.)
//
//   Run forever:  MONAD_RPC=<rpc> KEEPER_PRIVATE_KEY=<key> node scripts/auto-graduate.cjs
//   One sweep:    ... node scripts/auto-graduate.cjs --once
//
// Config (env):
//   MONAD_RPC / RPC_URL       JSON-RPC endpoint      (default: the public Monad RPC)
//   KEEPER_PRIVATE_KEY        signer for graduate()  (REQUIRED — a hot wallet; it earns the bounty)
//   FACTORY                   MonPadFactoryV4 addr   (else read from deploy.curve.json)
//   START_BLOCK / POLL_MS / CONFIRMATIONS / CHUNK / STATE_FILE   (see defaults below)
//
// Idempotent + crash-safe: progress persisted; an already-graduated curve is skipped; graduate() is
// permissionless so a missed tick self-heals on the next pass. Read-only except the graduate() call itself.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

let manifest = {};
for (const p of [process.env.DEPLOY_JSON, path.resolve(__dirname, "..", "deploy.curve.json")]) {
  if (!p) continue;
  try { manifest = JSON.parse(fs.readFileSync(p, "utf8")); break; } catch { /* try next */ }
}

const RPC_URL = process.env.MONAD_RPC || process.env.RPC_URL || "https://rpc.monad.xyz";
const KEY = process.env.KEEPER_PRIVATE_KEY || "";
const FACTORY = (process.env.FACTORY || (manifest.contracts && manifest.contracts.curveFactory) || "").toLowerCase();
const START_BLOCK = Number(process.env.START_BLOCK || manifest.curveFactoryBlock || 0);
const POLL_MS = Number(process.env.POLL_MS || 15000);
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS || 3);
// [MONAD] The PUBLIC RPC caps eth_getLogs at a 100-BLOCK RANGE (verified: a wider call returns
// -32614 "eth_getLogs is limited to a 100 range"). The Robin original defaulted to 5000 and would fail every
// pass here. 100 is safe on the public endpoint; raise it substantially on a dedicated provider —
// Mon-Pad already uses QuickNode for the app (see ../.env.example) and that lifts the limit.
//
// Sizing note: Monad blocks are ~0.4s, so 100 blocks ≈ 40s of chain and a 15s poll advances ~37 blocks —
// comfortably inside one request. Backfilling a long outage from START_BLOCK is what actually wants a bigger
// CHUNK, since the public cap makes it 100 blocks per round-trip.
const CHUNK = Number(process.env.CHUNK || 100);
const STATE_FILE = process.env.STATE_FILE || path.resolve(__dirname, ".auto-graduate-state.json");

const FACTORY_IFACE = new ethers.Interface([
  "event CurvePadLaunched(uint256 indexed index, address indexed token, address indexed creator, address hook, address curve, bytes32 poolId)",
]);
const LAUNCHED = FACTORY_IFACE.getEvent("CurvePadLaunched").topicHash;
const CURVE_ABI = [
  "function ready() view returns (bool)",
  "function graduated() view returns (bool)",
  "function graduate()",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!s.curves) s.curves = {}; // curve -> "watching" | "graduated"
    return s;
  } catch { return { lastBlock: Math.max(0, START_BLOCK - 1), curves: {} }; }
}
const saveState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 0));

// discover new curves the factory launched in [from,to]
async function discover(provider, from, to, state) {
  const logs = await provider.getLogs({ fromBlock: from, toBlock: to, address: FACTORY, topics: [LAUNCHED] });
  for (const lg of logs) {
    const a = FACTORY_IFACE.parseLog(lg).args;
    const c = a.curve.toLowerCase();
    if (!state.curves[c]) {
      state.curves[c] = "watching";
      console.log(`  + watching ${c} (token ${a.token})`);
    }
  }
}

// try to graduate every watched-and-ready curve
async function tick(provider, wallet, state) {
  const head = await provider.getBlockNumber();
  const safeHead = head - CONFIRMATIONS;
  let from = state.lastBlock + 1;
  for (; from <= safeHead; from += CHUNK) {
    const hi = Math.min(from + CHUNK - 1, safeHead);
    await discover(provider, from, hi, state);
    state.lastBlock = hi;
    saveState(state);
  }
  for (const [addr, status] of Object.entries(state.curves)) {
    if (status === "graduated") continue;
    const curve = new ethers.Contract(addr, CURVE_ABI, wallet);
    try {
      if (await curve.graduated()) { state.curves[addr] = "graduated"; saveState(state); continue; }
      if (!(await curve.ready())) continue; // not at the ceiling yet
      console.log(`[${new Date().toISOString()}] ${addr} is READY → graduating…`);
      // [MONAD] type-2 (EIP-1559) — do NOT force { type: 0 } as the Robinhood Chain original does.
      const rc = await (await curve.graduate()).wait();
      console.log(`  ✅ graduated ${addr} in ${rc.hash} (block ${rc.blockNumber}) — bounty paid to ${wallet.address}`);
      state.curves[addr] = "graduated";
      saveState(state);
    } catch (e) {
      console.log(`  … ${addr}: ${(e.shortMessage || e.message || "").slice(0, 100)} (retry next pass)`);
    }
  }
}

async function main() {
  if (!FACTORY) { console.error("FACTORY env (or deploy.curve.json) required — the MonPadFactoryV4 address"); process.exit(2); }
  if (!KEY) { console.error("KEEPER_PRIVATE_KEY env required — a hot keeper wallet; it earns the graduation bounty"); process.exit(2); }
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(KEY, provider);
  const state = loadState();
  console.log(`auto-graduate: factory ${FACTORY} · keeper ${wallet.address} · from block ${state.lastBlock + 1} · chunk ${CHUNK}`);

  if (process.argv.includes("--once")) { await tick(provider, wallet, state); return; }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await tick(provider, wallet, state); }
    catch (e) { console.error(`[${new Date().toISOString()}] pass error:`, e.shortMessage || e.message); }
    await sleep(POLL_MS);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
