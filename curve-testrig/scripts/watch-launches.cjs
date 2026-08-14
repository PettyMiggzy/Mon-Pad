#!/usr/bin/env node
/*
 * watch-launches — observe every token launch on a chain, live, from its first block.
 *
 * WHY THIS EXISTS
 * Reconstructing launches from history always arrives late: you learn a pool existed only after it
 * mattered, and you inherit whatever survivorship the archive imposes. Launching your own token fixes
 * the vantage but costs real capital per observation and gives you n=1 each time.
 *
 * This subscribes ahead of the fact instead. It polls for pool-creation events and, the instant one
 * appears, starts recording that pool — so every launch on the chain is observed from block zero, at
 * the same vantage you would have on your own token, for free and in parallel. At the rates measured
 * on Robinhood Chain (~61 V3 pools/hour) this collects more block-0 observations in an hour than 40
 * self-funded launches would.
 *
 * It is deliberately an OBSERVER, not a participant: it never sends a transaction and holds no key.
 *
 * NO WEBSOCKET REQUIRED. Polling does not degrade the data — every log carries its own blockNumber,
 * so the reconstructed ordering is identical to a push subscription. Poll latency would only matter
 * if we were racing to trade, which we are not.
 *
 * WHAT IT RECORDS, per pool
 *   birth      factory, tokens, fee, tickSpacing, block, tx, creator
 *   seed       amounts from the pool's FIRST Mint (the initial liquidity actually posted)
 *   devbuy     any Swap landing in the same tx as the birth (a pad buying its own token atomically)
 *   flow       every subsequent Swap: buyer, blocks-after-birth, direction, size
 *
 * Those four are what a discriminative test needs: exposure (seed/devbuy), outcome (who showed up and
 * how fast), and the covariates to control on. Bot signals — short hold time, wallet rotation — are
 * derived from `flow` afterwards rather than guessed at here, so the detection rule can be changed
 * without re-collecting.
 *
 * OUTPUT is append-only JSONL, one event per line, so a crash costs at most one poll and the file can
 * be tailed while it runs. Resumes from the last block it wrote.
 *
 *   RPC=<url> node scripts/watch-launches.cjs
 *   RPC=<url> V4_POOL_MANAGER=<addr> OUT=./launches.jsonl POLL_MS=2000 node scripts/watch-launches.cjs
 *
 * Env: RPC (required), OUT, POLL_MS, V4_POOL_MANAGER, V3_FACTORY (omit = all V3 factories chain-wide),
 *      LOOKBACK (blocks to backfill on first start), MAX_TRACKED (LRU cap on live pools).
 */
const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, id: keccakId, AbiCoder, getAddress } = require("ethers");

const RPC = process.env.RPC;
if (!RPC) {
  console.error("RPC is required, e.g. RPC=https://api.robinlab.io/rpc node scripts/watch-launches.cjs");
  process.exit(1);
}
const OUT = process.env.OUT || path.join(process.cwd(), "launches.jsonl");
const POLL_MS = Number(process.env.POLL_MS || 2000);
const LOOKBACK = Number(process.env.LOOKBACK || 2000);
const MAX_TRACKED = Number(process.env.MAX_TRACKED || 20000);
const V4_PM = process.env.V4_POOL_MANAGER ? process.env.V4_POOL_MANAGER.toLowerCase() : null;
const V3_FACTORY = process.env.V3_FACTORY ? process.env.V3_FACTORY.toLowerCase() : null;

// V3 pools emit their own events; V4 routes everything through one singleton PoolManager. Watching
// both means the observer is venue-agnostic — which matters, because the launch we cared about turned
// out to be on V3 after two days of assuming V4.
const T_V3_CREATED = keccakId("PoolCreated(address,address,uint24,int24,address)");
const T_V3_MINT = keccakId("Mint(address,address,int24,int24,uint128,uint256,uint256)");
const T_V3_SWAP = keccakId("Swap(address,address,int256,int256,uint160,uint128,int24)");
const T_V4_INIT = keccakId("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
const T_V4_SWAP = keccakId("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");

const abi = AbiCoder.defaultAbiCoder();
const provider = new JsonRpcProvider(RPC);
const hex = (n) => "0x" + n.toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = fs.createWriteStream(OUT, { flags: "a" });
const emit = (obj) => out.write(JSON.stringify(obj) + "\n");

/** Pools we are actively following. Keyed by pool address (V3) or poolId (V4). */
const tracked = new Map();
const stats = { polls: 0, births: 0, swaps: 0, seeds: 0, devbuys: 0, failedPolls: 0 };

/**
 * A failed range must never look like an empty one. Returning [] on exhaustion silently converts
 * "the RPC refused" into "nothing happened", which is how an earlier pass at this measured a 4x price
 * move on a token that had actually done 22x. Failures are surfaced and counted instead.
 */
async function getLogs(params, from, to, depth = 0) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await provider.send("eth_getLogs", [{ ...params, fromBlock: hex(from), toBlock: hex(to) }]);
    } catch (e) {
      await sleep(200 * (attempt + 1));
    }
  }
  if (depth < 6 && to > from) {
    const mid = Math.floor((from + to) / 2);
    return [...(await getLogs(params, from, mid, depth + 1)), ...(await getLogs(params, mid + 1, to, depth + 1))];
  }
  throw new Error(`getLogs exhausted for ${from}..${to}`);
}

function track(key, rec) {
  tracked.set(key, rec);
  // Bounded memory: a chain producing hundreds of pools an hour would grow unboundedly otherwise.
  // Oldest-first eviction is right here because interest in a pool decays with age.
  if (tracked.size > MAX_TRACKED) {
    const oldest = tracked.keys().next().value;
    tracked.delete(oldest);
  }
}

async function pollRange(from, to) {
  // --- births -------------------------------------------------------------
  const v3Filter = V3_FACTORY ? { address: V3_FACTORY, topics: [T_V3_CREATED] } : { topics: [T_V3_CREATED] };
  const v3Born = await getLogs(v3Filter, from, to);
  for (const l of v3Born) {
    const [tickSpacing, pool] = abi.decode(["int24", "address"], l.data);
    const rec = {
      kind: "birth", venue: "v3", pool: pool.toLowerCase(), factory: l.address.toLowerCase(),
      block: parseInt(l.blockNumber, 16), tx: l.transactionHash.toLowerCase(),
      token0: "0x" + l.topics[1].slice(26), token1: "0x" + l.topics[2].slice(26),
      fee: parseInt(l.topics[3], 16), tickSpacing: Number(tickSpacing),
    };
    track(rec.pool, rec);
    stats.births++;
    emit(rec);
  }

  if (V4_PM) {
    const v4Born = await getLogs({ address: V4_PM, topics: [T_V4_INIT] }, from, to);
    for (const l of v4Born) {
      const [fee, tickSpacing, hooks, , tick] = abi.decode(["uint24", "int24", "address", "uint160", "int24"], l.data);
      const rec = {
        kind: "birth", venue: "v4", pool: l.topics[1].toLowerCase(), factory: V4_PM,
        block: parseInt(l.blockNumber, 16), tx: l.transactionHash.toLowerCase(),
        token0: "0x" + l.topics[2].slice(26), token1: "0x" + l.topics[3].slice(26),
        fee: Number(fee), tickSpacing: Number(tickSpacing),
        hooks: getAddress(hooks), hookFlags: "0x" + (BigInt(hooks) & 0x3fffn).toString(16).padStart(4, "0"),
        openTick: Number(tick),
      };
      track(rec.pool, rec);
      stats.births++;
      emit(rec);
    }
  }

  // --- initial liquidity ---------------------------------------------------
  // The pool's FIRST Mint is the seed. Later mints are ordinary LP adds and are not the exposure
  // variable, so only the first is recorded per pool.
  for (const l of await getLogs({ topics: [T_V3_MINT] }, from, to)) {
    const rec = tracked.get(l.address.toLowerCase());
    if (!rec || rec.seeded) continue;
    try {
      const [, , amount0, amount1] = abi.decode(["address", "uint128", "uint256", "uint256"], l.data);
      rec.seeded = true;
      stats.seeds++;
      emit({
        kind: "seed", venue: "v3", pool: rec.pool, block: parseInt(l.blockNumber, 16),
        amount0: amount0.toString(), amount1: amount1.toString(),
        sameTxAsBirth: l.transactionHash.toLowerCase() === rec.tx,
      });
    } catch (e) { /* non-standard Mint layout; skip rather than poison the record */ }
  }

  // --- flow ----------------------------------------------------------------
  for (const l of await getLogs({ topics: [T_V3_SWAP] }, from, to)) {
    const rec = tracked.get(l.address.toLowerCase());
    if (!rec) continue; // pool predates the watcher; no block-0 vantage, so not our sample
    let a0, a1;
    try { [a0, a1] = abi.decode(["int256", "int256", "uint160", "uint128", "int24"], l.data); }
    catch (e) { continue; }
    const block = parseInt(l.blockNumber, 16);
    const sameTx = l.transactionHash.toLowerCase() === rec.tx;
    if (sameTx) stats.devbuys++;
    stats.swaps++;
    emit({
      kind: sameTx ? "devbuy" : "swap", venue: "v3", pool: rec.pool, block,
      afterBirth: block - rec.block, tx: l.transactionHash.toLowerCase(),
      sender: "0x" + l.topics[1].slice(26),
      buyer: "0x" + l.topics[2].slice(26), // recipient — the trader, NOT the router in topic1
      amount0: a0.toString(), amount1: a1.toString(),
      // token0 in = a buy of token1. Recorded rather than inferred so direction can be re-derived.
      dir: a0 > 0n ? "token0in" : "token1in",
    });
  }

  if (V4_PM) {
    for (const l of await getLogs({ address: V4_PM, topics: [T_V4_SWAP] }, from, to)) {
      const rec = tracked.get(l.topics[1].toLowerCase());
      if (!rec) continue;
      const block = parseInt(l.blockNumber, 16);
      const sameTx = l.transactionHash.toLowerCase() === rec.tx;
      stats.swaps++;
      if (sameTx) stats.devbuys++;
      emit({
        kind: sameTx ? "devbuy" : "swap", venue: "v4", pool: rec.pool, block,
        afterBirth: block - rec.block, tx: l.transactionHash.toLowerCase(),
        buyer: "0x" + l.topics[2].slice(26),
      });
    }
  }
}

/** Resume from the last block already written so a restart neither gaps nor duplicates. */
function lastBlockWritten() {
  try {
    const lines = fs.readFileSync(OUT, "utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const b = JSON.parse(lines[i]).block;
      if (typeof b === "number") return b;
    }
  } catch (e) { /* no prior file */ }
  return null;
}

(async () => {
  const head = await provider.getBlockNumber();
  const resume = lastBlockWritten();
  let cursor = resume !== null ? resume + 1 : head - LOOKBACK;
  console.log(`watch-launches -> ${OUT}`);
  console.log(`  rpc ${RPC}`);
  console.log(`  ${resume !== null ? `resuming from ${cursor}` : `starting at ${cursor} (head ${head}, lookback ${LOOKBACK})`}`);
  console.log(`  v3 factories: ${V3_FACTORY || "ALL chain-wide"}   v4: ${V4_PM || "(off)"}\n`);

  process.on("SIGINT", () => {
    console.log(`\nstopping. ${stats.births} births, ${stats.seeds} seeds, ${stats.devbuys} devbuys, ` +
      `${stats.swaps} swaps, ${stats.failedPolls} failed polls. data -> ${OUT}`);
    out.end(() => process.exit(0));
  });

  for (;;) {
    try {
      const now = await provider.getBlockNumber();
      if (now >= cursor) {
        // Cap the span so a long stall cannot produce one enormous unservable range.
        const to = Math.min(now, cursor + 4999);
        await pollRange(cursor, to);
        cursor = to + 1;
        stats.polls++;
        if (stats.polls % 15 === 0) {
          process.stdout.write(`\r  blk ${cursor}  births ${stats.births}  seeds ${stats.seeds}  ` +
            `devbuys ${stats.devbuys}  swaps ${stats.swaps}  tracking ${tracked.size}  failed ${stats.failedPolls}   `);
        }
      }
    } catch (e) {
      // Surfaced, counted, and retried from the SAME cursor — never skipped, or the sample silently
      // acquires holes exactly where the chain was busiest.
      stats.failedPolls++;
      console.error(`\n  poll failed at ${cursor}: ${String(e.message).slice(0, 100)} (retrying)`);
      await sleep(2000);
    }
    await sleep(POLL_MS);
  }
})();
