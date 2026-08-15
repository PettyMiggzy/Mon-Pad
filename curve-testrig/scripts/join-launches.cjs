#!/usr/bin/env node
/*
 * Join RektPad launches against the OBSERVATIONAL feed produced by scripts/watch-launches.cjs.
 *
 * This is the falsifiability check for the whole instrument. A pad whose rows do not land in the same schema,
 * same units and same transaction shape as the wild population has failed at its only job — and that failure
 * is silent unless something asserts it. So four reconciliations run on EVERY pad row and the script exits
 * NONZERO on any mismatch:
 *
 *   (1) Launched.seedAmount0/1 == watcher seed.amount0/1 EXACTLY, compared as decimal strings
 *   (2) watcher seed.sameTxAsBirth == true          (atomicity — what makes the join legal at all)
 *   (3) if devBought, a devbuy row exists with afterBirth == 0 and signed amounts matching sign-for-sign
 *   (4) Launched.devBuyRecipient == watcher devbuy.buyer
 *
 * Outcome columns are derived from `flow` records through the SAME code path for pad, reference and wild rows.
 * If the pad's rows went through a different derivation than the population they are compared against, the
 * comparison measures the derivation.
 *
 * BUILD THIS BEFORE THE SECOND LAUNCH, NOT AFTER THE TWENTIETH.
 *
 * The feed is READ-ONLY here — a watcher is appending to it live. Nothing in this file writes to it.
 *
 * Usage:
 *   node scripts/join-launches.cjs                       # wild + reference only, zero RPC
 *   PAD_LOGS=padrows.json node scripts/join-launches.cjs  # + pad rows from a decoded-log dump
 *   OUT=join.csv node scripts/join-launches.cjs           # also write a flat CSV
 *
 * Env:
 *   FEED         path to live-launches.jsonl (default: the cached research copy)
 *   PADFIX       path to padfix.json, used to label the 6 reference-pad pools
 *   BOTS         path to labelled-bots.json, used for the bot-share outcome column
 *   PAD_LOGS     JSON array of {launchId, token, creator, record:{...}} — exactly what
 *                pad.interface.parseLog(...).args gives you, JSON-stringified with BigInts as strings
 *   WINDOW       blocks after birth for the outcome window (default 5000)
 */
const fs = require("fs");
const path = require("path");

const SCRATCH = "/tmp/claude-0/-home-user/6987b08a-376b-575c-b3da-e05b25231d35/scratchpad";
const FEED = process.env.FEED || path.join(SCRATCH, "live-launches.jsonl");
const PADFIX = process.env.PADFIX || path.join(SCRATCH, "padfix.json");
const BOTS = process.env.BOTS || path.join(SCRATCH, "labelled-bots.json");
const PAD_LOGS = process.env.PAD_LOGS || null;
const OUT = process.env.OUT || null;
const WINDOW = Number(process.env.WINDOW || 5000);

const lc = (s) => (typeof s === "string" ? s.toLowerCase() : s);
/** Normalise anything numeric-ish to a decimal string, so 0x0 / 0n / "0" / 0 all compare equal. */
const dec = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.startsWith("0x") ? BigInt(v).toString() : BigInt(v).toString();
  return BigInt(v).toString();
};

function readFeed(file) {
  if (!fs.existsSync(file)) throw new Error(`feed not found: ${file}`);
  // Read-only, streamed by line. A partially-written final line is expected (a watcher is appending) and is
  // skipped rather than treated as corruption.
  const text = fs.readFileSync(file, "utf8");
  const pools = new Map();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const key = lc(r.pool);
    if (!key) continue;
    let p = pools.get(key);
    if (!p) {
      p = { pool: key, birth: null, seed: null, devbuys: [], flow: [] };
      pools.set(key, p);
    }
    if (r.kind === "birth") p.birth = r;
    else if (r.kind === "seed") p.seed = r;
    else if (r.kind === "devbuy") p.devbuys.push(r);
    else if (r.kind === "swap") p.flow.push(r);
  }
  return { pools, skipped };
}

/** One outcome derivation, used identically for pad, reference and wild rows. */
function outcomes(p, bots) {
  const inWindow = p.flow.filter((s) => s.afterBirth != null && s.afterBirth <= WINDOW);
  const buyers = new Set(inWindow.map((s) => lc(s.buyer)).filter(Boolean));
  const botBuyers = [...buyers].filter((b) => bots.has(b));
  const first = p.flow.reduce((m, s) => (m === null || s.afterBirth < m ? s.afterBirth : m), null);
  return {
    swapsInWindow: inWindow.length,
    distinctBuyersInWindow: buyers.size,
    botShare: buyers.size ? +(botBuyers.length / buyers.size).toFixed(4) : null,
    blocksToFirstExternalBuy: first,
    totalSwapsSeen: p.flow.length,
  };
}

function loadPadRows(file) {
  if (!file) return new Map();
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.launches || [];
  const m = new Map();
  for (const r of rows) {
    const rec = r.record || r;
    m.set(lc(rec.pool), { launchId: r.launchId ?? null, token: lc(r.token ?? rec.token), rec });
  }
  return m;
}

function reconcile(pool, padRow, failures) {
  const rec = padRow.rec;
  const where = `pool ${pool.pool} (launchId ${padRow.launchId})`;

  // (1) achieved seed amounts must match the chain observer's numbers EXACTLY
  if (!pool.seed) {
    failures.push(`${where}: the pad emitted a launch but the feed has NO seed record for the pool`);
  } else {
    if (dec(pool.seed.amount0) !== dec(rec.seedAmount0)) {
      failures.push(`${where}: seedAmount0 ${dec(rec.seedAmount0)} != watcher ${dec(pool.seed.amount0)}`);
    }
    if (dec(pool.seed.amount1) !== dec(rec.seedAmount1)) {
      failures.push(`${where}: seedAmount1 ${dec(rec.seedAmount1)} != watcher ${dec(pool.seed.amount1)}`);
    }
    // (2) atomicity — the property the whole design rests on
    if (pool.seed.sameTxAsBirth !== true) {
      failures.push(`${where}: seed.sameTxAsBirth is ${pool.seed.sameTxAsBirth}, so this row cannot be pooled with the wild sample`);
    }
  }

  // (3) + (4) the dev buy
  const devBought = rec.devBought === true || rec.devBought === "true";
  const db = pool.devbuys.find((d) => d.afterBirth === 0);
  if (devBought) {
    if (!db) {
      failures.push(`${where}: record says devBought but the feed has no devbuy at afterBirth == 0`);
    } else {
      const sgn = (v) => (BigInt(v) > 0n ? 1 : BigInt(v) < 0n ? -1 : 0);
      if (dec(db.amount0) !== dec(rec.devBuyAmount0) || dec(db.amount1) !== dec(rec.devBuyAmount1)) {
        failures.push(
          `${where}: devBuy amounts ${dec(rec.devBuyAmount0)}/${dec(rec.devBuyAmount1)} != watcher ${dec(db.amount0)}/${dec(db.amount1)}`,
        );
      }
      if (sgn(db.amount0) !== sgn(rec.devBuyAmount0) || sgn(db.amount1) !== sgn(rec.devBuyAmount1)) {
        failures.push(`${where}: devBuy signs disagree with the Swap log`);
      }
      if (lc(db.buyer) !== lc(rec.devBuyRecipient)) {
        failures.push(`${where}: devBuyRecipient ${lc(rec.devBuyRecipient)} != watcher devbuy.buyer ${lc(db.buyer)}`);
      }
    }
  } else if (db) {
    failures.push(`${where}: record says no dev buy, but the feed has a devbuy in the birth tx`);
  }
}

function main() {
  const { pools, skipped } = readFeed(FEED);
  const bots = new Set(
    fs.existsSync(BOTS) ? JSON.parse(fs.readFileSync(BOTS, "utf8")).map(lc) : [],
  );
  const referencePools = new Set();
  let referencePad = null;
  if (fs.existsSync(PADFIX)) {
    const pf = JSON.parse(fs.readFileSync(PADFIX, "utf8"));
    referencePad = lc(pf.pad);
    for (const l of pf.launches || []) referencePools.add(lc(l.pool));
  }
  const padRows = loadPadRows(PAD_LOGS);

  const failures = [];
  const rows = [];
  for (const p of pools.values()) {
    if (!p.birth) continue; // pool predates the watcher — no block-0 vantage, so not our sample
    const padRow = padRows.get(p.pool);
    const source = padRow ? "pad" : referencePools.has(p.pool) ? "reference" : "wild";
    if (padRow) reconcile(p, padRow, failures);

    const rec = padRow ? padRow.rec : null;
    rows.push({
      source,
      pool: p.pool,
      factory: p.birth.factory,
      venue: p.birth.venue,
      birthBlock: p.birth.block,
      token0: lc(p.birth.token0),
      token1: lc(p.birth.token1),
      fee: p.birth.fee,
      tickSpacing: p.birth.tickSpacing,
      seedAmount0: p.seed ? p.seed.amount0 : null,
      seedAmount1: p.seed ? p.seed.amount1 : null,
      sameTxAsBirth: p.seed ? p.seed.sameTxAsBirth : null,
      devBought: p.devbuys.some((d) => d.afterBirth === 0),
      // pad-only columns — null for wild and reference rows, which is itself the honest answer: these are
      // parameters only a pad launch can report, and imputing them would fabricate the very variation the
      // experiment is meant to supply.
      launchId: padRow ? padRow.launchId : null,
      experimentId: rec ? rec.experimentId : null,
      armId: rec ? rec.armId : null,
      replicate: rec ? rec.replicate : null,
      operator: rec ? lc(rec.operator) : null,
      requestedSeedQuote: rec ? dec(rec.requestedSeedQuote) : null,
      requestedDevBuyQuote: rec ? dec(rec.requestedDevBuyQuote) : null,
      openingTick: rec ? rec.openingTick : null,
      tickLower: rec ? rec.tickLower : null,
      tickUpper: rec ? rec.tickUpper : null,
      totalSupply: rec ? dec(rec.totalSupply) : null,
      decimals: rec ? rec.decimals : null,
      ...outcomes(p, bots),
    });
  }

  rows.sort((a, b) => a.birthBlock - b.birthBlock);
  const counts = rows.reduce((m, r) => ((m[r.source] = (m[r.source] || 0) + 1), m), {});
  console.log(`feed ${FEED}`);
  console.log(`  ${rows.length} pools with a birth record  (${JSON.stringify(counts)})${skipped ? `, ${skipped} unparsable lines skipped` : ""}`);
  if (referencePad) console.log(`  reference pad ${referencePad}: ${referencePools.size} pools labelled`);
  if (!PAD_LOGS) console.log("  (no PAD_LOGS given — reconciliation has nothing to check yet)");

  const mature = rows.filter((r) => r.sameTxAsBirth !== null);
  const atomic = mature.filter((r) => r.sameTxAsBirth === true).length;
  console.log(`  seeded pools: ${mature.length}, of which same-tx-as-birth: ${atomic}`);

  if (OUT) {
    const cols = Object.keys(rows[0] || {});
    const csv = [cols.join(",")]
      .concat(rows.map((r) => cols.map((c) => (r[c] === null || r[c] === undefined ? "" : String(r[c]))).join(",")))
      .join("\n");
    fs.writeFileSync(OUT, csv + "\n");
    console.log(`  wrote ${OUT}`);
  }

  if (failures.length) {
    console.error(`\nRECONCILIATION FAILED — ${failures.length} mismatch(es). The pad is NOT producing rows in`);
    console.error("the population's schema, which is the one failure this whole design exists to prevent.\n");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nreconciliation OK");
}

main();
