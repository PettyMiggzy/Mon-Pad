#!/usr/bin/env node
/*
 * watch-mempool-bsc — observe snipers DECIDING, not just snipers having decided.
 *
 * WHY THIS EXISTS
 * Every sniper measurement in this project so far was made on a chain with no public mempool (Robinhood
 * Chain, FCFS). There, a bot is only observable AFTER it has already bought: you see which pools it ended
 * up in and infer the rule backwards. That inference failed repeatedly — "bots need exit liquidity",
 * "it's one operator's closed loop", "bots won't touch zero-quote pools" were each derived that way and
 * each was wrong.
 *
 * BSC has a real public mempool (measured: ~411 pending tx/sec, streamed as FULL transaction objects
 * including calldata, so no per-tx fetch and no paid RPC). That makes three things observable that were
 * structurally invisible before:
 *
 *   1. THE TRIGGER FIRING. A sniper's buy appears in the mempool before it is mined, so the delay from
 *      pair-creation to first sniper bid is a direct measurement rather than an inference from block
 *      numbers.
 *   2. THE GAS AUCTION. What they bid reveals how hard they are competing and for what. Invisible on an
 *      FCFS chain, where ordering is not purchasable.
 *   3. LAUNCHES THEY SAW AND DECLINED — the real prize. Every control group built so far inferred
 *      non-participation from absence, which cannot distinguish "decided against" from "never saw it".
 *      A bot streaming the same mempool and not bidding is an observed decision.
 *
 * HOW A BUY IS DETECTED, and why not by router ABI
 * Snipers do not all go through the canonical router — many use custom contracts with private selectors,
 * so decoding known router methods would systematically miss the most sophisticated ones and bias the
 * sample toward retail. Instead every pending tx's calldata is split into 32-byte words and the low 20
 * bytes of each are looked up against the set of recently-created tokens. That catches any caller shape,
 * including contracts whose ABI we have never seen, at the cost of occasional false positives (an
 * address appearing in calldata for some other reason) — which is the right trade for a control group.
 *
 * Usage:
 *   node scripts/watch-mempool-bsc.cjs
 *   WS=wss://... OUT=bsc.jsonl TRACK_BLOCKS=1200 node scripts/watch-mempool-bsc.cjs
 */
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { id: keccakId, AbiCoder } = require("ethers");

const WS = process.env.WS || "wss://bsc-rpc.publicnode.com";
const OUT = process.env.OUT || path.join(process.cwd(), "bsc-mempool.jsonl");
// How long a freshly-created token stays "interesting". BSC blocks are ~0.75s, so 1200 blocks ~ 15 min —
// well past the window in which a launch snipe happens.
const TRACK_BLOCKS = Number(process.env.TRACK_BLOCKS || 1200);
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 4000);

// PancakeSwap V2 is where BSC launch volume actually is: measured 50 PairCreated/hr against 1/hr on
// PancakeSwap V3. V2 has no ticks and no position NFTs, so the shape differs from the V3/V4 watcher.
const FACTORY = (process.env.FACTORY || "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73").toLowerCase();
const WBNB = (process.env.WBNB || "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c").toLowerCase();

// Established tokens must never enter the tracked set. A new pair whose non-quote side is USDT (or any
// major token) would otherwise make every pending tx on the chain that mentions USDT a "hit" — measured
// at 1,579 false hits in 100s before this guard existed.
const MAJORS = new Set([
  "0x55d398326f99059ff775485246999027b3197955", // BSC-USD (USDT)
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
  "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8", // ETH
  "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", // BTCB
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB itself
  "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3", // DAI
  "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", // CAKE
]);
// A genuinely fresh launch draws a handful of mempool bids. An established token draws a constant
// stream. Anything past this in its first minute is not a launch and is dropped — the adaptive backstop
// for majors not on the static list.
const MAX_HITS_PER_TOKEN = Number(process.env.MAX_HITS_PER_TOKEN || 200);

const T_PAIR_CREATED = keccakId("PairCreated(address,address,address,uint256)");
const T_V2_SWAP = keccakId("Swap(address,uint256,uint256,uint256,uint256,address)");
const T_V2_MINT = keccakId("Mint(address,uint256,uint256)");

const abi = AbiCoder.defaultAbiCoder();
const out = fs.createWriteStream(OUT, { flags: "a" });
const emit = (o) => out.write(JSON.stringify({ t: Date.now(), ...o }) + "\n");

/** token address -> {token, pair, bornBlock, bornAt} for recently created tokens. */
const tracked = new Map();
/** pending tx hash -> the record we already emitted, so we can close the loop when it mines. */
const pending = new Map();
/** pair address -> Mint log seen BEFORE its PairCreated was processed. A pair is created and seeded in
 *  the SAME transaction, and the two logs arrive on different subscriptions with no ordering guarantee,
 *  so ~79% of seeds were being dropped as "unknown pair" before this buffer existed. */
const orphanMints = new Map();
let head = 0;
const stats = { pairs: 0, pendingSeen: 0, hits: 0, mined: 0, swaps: 0, reconnects: 0 };

function trackToken(token, pair, block, token0) {
  if (MAJORS.has(token)) return;
  // token0 is carried so the seed can be oriented from the pair's real ordering rather than an
  // address comparison — getting this backwards reads the token leg as the quote leg.
  tracked.set(token, { token, pair, bornBlock: block, bornAt: Date.now(), hits: 0, token0 });
  if (tracked.size > MAX_TRACKED) tracked.delete(tracked.keys().next().value);
}

/**
 * Pull every 20-byte address-shaped word out of calldata and test it against the tracked set.
 * Deliberately shape-agnostic — see the header on why router-ABI decoding would bias the sample.
 */
function targetsTrackedToken(input) {
  if (!input || input.length < 74) return null;
  const body = input.slice(10); // drop selector
  for (let i = 0; i + 64 <= body.length; i += 64) {
    const word = body.slice(i, i + 64);
    // an address-shaped word is 12 zero bytes then 20 bytes
    if (word.slice(0, 24) !== "000000000000000000000000") continue;
    const addr = "0x" + word.slice(24);
    if (tracked.has(addr)) return addr;
  }
  return null;
}

function connect() {
  const ws = new WebSocket(WS);
  let alive = true;

  ws.on("open", () => {
    console.log(`connected ${WS}`);
    // full transaction objects, not bare hashes — measured working on publicnode, and it removes the
    // per-tx eth_getTransactionByHash that would otherwise be impossible at ~411 tx/sec on free RPC.
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions", true] }));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_subscribe", params: ["logs", { address: FACTORY, topics: [T_PAIR_CREATED] }] }));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "eth_subscribe", params: ["logs", { topics: [T_V2_SWAP] }] }));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "eth_subscribe", params: ["logs", { topics: [T_V2_MINT] }] }));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "eth_subscribe", params: ["newHeads"] }));
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return; }
    const r = msg?.params?.result;
    if (!r) return;

    // --- new block: advance head and retire stale tokens -------------------
    if (r.number && r.parentHash) {
      head = parseInt(r.number, 16);
      for (const [tok, rec] of tracked) if (head - rec.bornBlock > TRACK_BLOCKS) tracked.delete(tok);
      return;
    }

    // --- a log ------------------------------------------------------------
    if (r.topics) {
      if (r.topics[0] === T_PAIR_CREATED && r.address.toLowerCase() === FACTORY) {
        const t0 = "0x" + r.topics[1].slice(26), t1 = "0x" + r.topics[2].slice(26);
        let pair = null;
        try { pair = abi.decode(["address", "uint256"], r.data)[0].toLowerCase(); } catch (e) { return; }
        const blk = parseInt(r.blockNumber, 16);
        // the launched token is whichever side is not the quote
        const token = t0 === WBNB ? t1 : t0;
        const quoted = t0 === WBNB || t1 === WBNB;
        // Only quote-paired pairs are launches. A token/token pair is a routing hop, not a launch.
        if (quoted) trackToken(token, pair, blk, t0);
        stats.pairs++;
        emit({ kind: "pair", pair, token, token0: t0, token1: t1, quotePaired: quoted, block: blk, tx: r.transactionHash });
        const orphan = orphanMints.get(pair);
        if (orphan && quoted) {
          orphanMints.delete(pair);
          const rec = tracked.get(token);
          if (rec && !rec.seeded) {
            try {
              const [a0, a1] = abi.decode(["uint256", "uint256"], orphan.data);
              rec.seeded = true;
              const wbnbIsToken0 = t0 === WBNB;
              emit({
                kind: "seed", pair, token, block: parseInt(orphan.blockNumber, 16),
                amount0: a0.toString(), amount1: a1.toString(), wbnbIsToken0,
                seedQuoteWei: (wbnbIsToken0 ? a0 : a1).toString(),
                tx: orphan.transactionHash, viaOrphanBuffer: true,
              });
            } catch (e) { /* non-standard Mint */ }
          }
        }
        return;
      }
      if (r.topics[0] === T_V2_MINT) {
        // The pair's FIRST Mint is the seed. This is the exposure variable: what a launch actually cost
        // its creator, and therefore what a test launch has to match to be comparable.
        const addr = r.address.toLowerCase();
        let hit = null;
        for (const rec of tracked.values()) if (rec.pair === addr) { hit = rec; break; }
        if (!hit) {
          // pair not registered yet — hold the Mint until PairCreated arrives
          if (!orphanMints.has(addr)) orphanMints.set(addr, r);
          if (orphanMints.size > 2000) orphanMints.delete(orphanMints.keys().next().value);
          return;
        }
        if (hit.seeded) return;
        try {
          const [a0, a1] = abi.decode(["uint256", "uint256"], r.data);
          hit.seeded = true;
          // orient per pair, never assume WBNB sorted first
          // orientation from the pair's recorded token0, not an address comparison
          const wbnbIsToken0 = hit.token0 !== undefined ? hit.token0 === WBNB : hit.token > WBNB;
          emit({
            kind: "seed", pair: addr, token: hit.token, block: parseInt(r.blockNumber, 16),
            amount0: a0.toString(), amount1: a1.toString(), wbnbIsToken0,
            seedQuoteWei: (wbnbIsToken0 ? a0 : a1).toString(),
            tx: r.transactionHash,
          });
        } catch (e) { /* non-standard Mint */ }
        return;
      }
      if (r.topics[0] === T_V2_SWAP) {
        // only swaps on pairs we are tracking; everything else is chain noise
        const addr = r.address.toLowerCase();
        let hit = null;
        for (const rec of tracked.values()) if (rec.pair === addr) { hit = rec; break; }
        if (!hit) return;
        stats.swaps++;
        // Close the loop: if we saw this exact tx bid in the mempool, we can now price the OTHER half of
        // the latency — bid-to-inclusion. On an FCFS chain that number does not exist; here it is the
        // cost of winning the auction, and pairing it with the bid's gasPrice is what makes the gas
        // auction legible rather than inferred.
        const h = (r.transactionHash || "").toLowerCase();
        const bid = pending.get(h);
        if (bid) {
          pending.delete(h);
          stats.mined++;
          emit({
            kind: "bid_mined", hash: h, token: hit.token, pair: addr,
            block: parseInt(r.blockNumber, 16),
            msBidToMined: Date.now() - bid.t0,
            msBirthToBid: bid.msAfterBirth,
            gasPrice: bid.gasPrice, from: bid.from, to: bid.to,
          });
        }
        emit({
          kind: "swap", pair: addr, token: hit.token, block: parseInt(r.blockNumber, 16),
          afterBirth: parseInt(r.blockNumber, 16) - hit.bornBlock, tx: r.transactionHash,
          sender: "0x" + r.topics[1].slice(26), to: "0x" + r.topics[2].slice(26), data: r.data,
          sawInMempool: !!bid,
        });
        return;
      }
      return;
    }

    // --- a pending transaction -------------------------------------------
    if (r.hash && r.input !== undefined) {
      stats.pendingSeen++;
      const token = targetsTrackedToken(r.input);
      if (!token) return; // the overwhelming majority: unrelated chain traffic
      const rec = tracked.get(token);
      rec.hits++;
      if (rec.hits > MAX_HITS_PER_TOKEN) {
        tracked.delete(token);
        emit({ kind: "untracked", token, reason: "hit_rate_implausible_for_fresh_launch", hits: rec.hits });
        return;
      }
      stats.hits++;
      const ev = {
        kind: "pending_hit", hash: r.hash.toLowerCase(), token, pair: rec.pair,
        // THE measurement this whole script exists for: how long after the pair appeared did a bid
        // for it show up in the mempool. Milliseconds, not blocks.
        msAfterBirth: Date.now() - rec.bornAt,
        blocksAfterBirth: head - rec.bornBlock,
        from: r.from?.toLowerCase(), to: r.to?.toLowerCase(),
        gasPrice: r.gasPrice ?? null, maxFee: r.maxFeePerGas ?? null, maxPriority: r.maxPriorityFeePerGas ?? null,
        gas: r.gas ?? null, nonce: r.nonce ?? null, value: r.value ?? null,
        selector: (r.input || "").slice(0, 10), inputLen: (r.input || "").length,
      };
      pending.set(ev.hash, { ...ev, t0: Date.now() });
      // bound the map: a bid that never mines would otherwise leak forever
      if (pending.size > 20000) pending.delete(pending.keys().next().value);
      emit(ev);
      return;
    }
  });

  const die = (why) => {
    if (!alive) return;
    alive = false;
    stats.reconnects++;
    console.error(`\n  ${why} — reconnecting in 3s (reconnect #${stats.reconnects})`);
    setTimeout(connect, 3000);
  };
  ws.on("close", () => die("socket closed"));
  ws.on("error", (e) => die(`socket error: ${String(e.message).slice(0, 80)}`));
}

setInterval(() => {
  process.stdout.write(
    `\r  head ${head}  pairs ${stats.pairs}  tracking ${tracked.size}  pending seen ${stats.pendingSeen}  ` +
    `HITS ${stats.hits}  swaps ${stats.swaps}  reconnects ${stats.reconnects}   `,
  );
}, 5000);

process.on("SIGINT", () => {
  console.log(`\nstopping. ${stats.pairs} pairs, ${stats.hits} mempool hits, ${stats.swaps} swaps -> ${OUT}`);
  out.end(() => process.exit(0));
});

console.log(`watch-mempool-bsc -> ${OUT}`);
console.log(`  factory ${FACTORY}  quote ${WBNB}  tracking window ${TRACK_BLOCKS} blocks\n`);
connect();
