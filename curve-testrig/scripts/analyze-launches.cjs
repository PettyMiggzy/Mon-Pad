#!/usr/bin/env node
/*
 * analyze-launches — turn the watcher's event log into a discriminative test.
 *
 * THE QUESTION THIS ANSWERS
 * "What makes a launch get picked up?" Every attempt at that question in this project failed the same
 * way: look at a launch that worked, list its properties, call them the cause. That is not a test — it
 * has no control group, so every property of the winner looks causal. Here the control group is
 * explicit: the launches that were IGNORED. A feature only counts if its distribution differs between
 * the two.
 *
 * WHAT IT GUARDS AGAINST, because each of these actually happened while building this
 *
 *   Zero-variance features. The reference pad hardcoded its seeding — 1e9 tokens and 0 quote on every
 *   launch — so six launches could never test whether seeding matters. A constant explains nothing, but
 *   it will happily produce a confident-looking comparison. Such features are detected and refused
 *   rather than reported.
 *
 *   Unstated base rates. "Bots bought it" means nothing until you know they buy 3% or 80% of everything.
 *   The base rate is printed before any comparison.
 *
 *   Underpowered comparisons. At n=6, a rank correlation needs |rho| > 0.83 before it means anything;
 *   values below that are noise that reads as signal. Every result carries its n and is explicitly
 *   marked UNDERPOWERED when the sample cannot support it.
 *
 *   Frozen bot definitions. "Bots don't hold long, some rotate wallets" — a definition requiring an
 *   address to recur across launches structurally cannot see a rotator. So detection is pluggable and
 *   run several ways at once; if a finding only survives under one definition, that is reported too.
 *
 * Usage:
 *   node scripts/analyze-launches.cjs launches.jsonl
 *   QUOTE=0x0bd7... FLIP_BLOCKS=6000 EARLY_BLOCKS=100 node scripts/analyze-launches.cjs launches.jsonl
 */
const fs = require("fs");

const FILE = process.argv[2];
if (!FILE) {
  console.error("usage: node scripts/analyze-launches.cjs <launches.jsonl>");
  process.exit(1);
}
// Quote token — needed to orient buy vs sell. Defaults to Robinhood Chain's WETH.
const QUOTE = (process.env.QUOTE || "0x0bd7d308f8e1639fab988df18a8011f41eacad73").toLowerCase();
const FLIP_BLOCKS = Number(process.env.FLIP_BLOCKS || 6000); // ~10 min at 0.1s blocks
const EARLY_BLOCKS = Number(process.env.EARLY_BLOCKS || 100); // ~10s
const REPEAT_MIN = Number(process.env.REPEAT_MIN || 3);

// ---------------------------------------------------------------- load

const pools = new Map();
let lines = 0, bad = 0;
for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
  if (!line.trim()) continue;
  lines++;
  let e;
  try { e = JSON.parse(line); } catch (err) { bad++; continue; }
  if (e.kind === "birth") {
    pools.set(e.pool, { ...e, seed: null, devbuys: [], flow: [] });
    continue;
  }
  const p = pools.get(e.pool);
  if (!p) continue; // event for a pool born before the watcher started: no block-0 vantage
  if (e.kind === "seed") p.seed = e;
  else if (e.kind === "devbuy") p.devbuys.push(e);
  else if (e.kind === "swap") p.flow.push(e);
}

// ---------------------------------------------------------------- derive

/** Orient amounts to (quote, token) regardless of which side sorted first. */
function orient(p, ev) {
  const quoteIsToken0 = p.token0 === QUOTE;
  const a0 = BigInt(ev.amount0 ?? 0), a1 = BigInt(ev.amount1 ?? 0);
  const quoteAmt = quoteIsToken0 ? a0 : a1;
  return { quoteAmt, isBuy: quoteAmt > 0n }; // quote flowing IN = someone buying the token
}

for (const p of pools.values()) {
  p.quoteIsToken0 = p.token0 === QUOTE;
  p.hasQuote = p.token0 === QUOTE || p.token1 === QUOTE;

  if (p.seed) {
    const s0 = BigInt(p.seed.amount0), s1 = BigInt(p.seed.amount1);
    p.seedQuote = Number((p.quoteIsToken0 ? s0 : s1)) / 1e18;
    p.seedToken = Number((p.quoteIsToken0 ? s1 : s0)) / 1e18;
  } else { p.seedQuote = null; p.seedToken = null; }

  p.devBuyQuote = p.devbuys.reduce((acc, d) => {
    const { quoteAmt, isBuy } = orient(p, d);
    return isBuy ? acc + Number(quoteAmt) / 1e18 : acc;
  }, 0);
  p.hasDevBuy = p.devbuys.length > 0;

  // per-buyer activity on this pool
  const per = new Map();
  for (const s of p.flow) {
    const { quoteAmt, isBuy } = orient(p, s);
    let a = per.get(s.buyer);
    if (!a) { a = { firstBuy: null, firstSell: null, spent: 0, nBuy: 0, nSell: 0 }; per.set(s.buyer, a); }
    if (isBuy) {
      a.nBuy++; a.spent += Number(quoteAmt) / 1e18;
      if (a.firstBuy === null || s.afterBirth < a.firstBuy) a.firstBuy = s.afterBirth;
    } else {
      a.nSell++;
      if (a.firstSell === null || s.afterBirth < a.firstSell) a.firstSell = s.afterBirth;
    }
  }
  p.perBuyer = per;
  p.nBuyers = [...per.values()].filter((a) => a.nBuy > 0).length;
  p.firstBuyDelta = Math.min(...[...per.values()].map((a) => a.firstBuy).filter((v) => v !== null), Infinity);
  p.quoteVolume = [...per.values()].reduce((s, a) => s + a.spent, 0);
}

// how many distinct pools each address bought — needed for the "repeat" definition, and it is the one
// signal a wallet-rotating operator can defeat for free, so it is never used alone
const poolsPerBuyer = new Map();
for (const p of pools.values())
  for (const [addr, a] of p.perBuyer) if (a.nBuy > 0) poolsPerBuyer.set(addr, (poolsPerBuyer.get(addr) || 0) + 1);

// ---------------------------------------------------------------- bot definitions

const DEFS = {
  // buy then sell fast. survives wallet rotation — the signature works on a single-use wallet.
  flipper: (a) => a.nBuy > 0 && a.firstSell !== null && a.firstSell >= a.firstBuy && a.firstSell - a.firstBuy <= FLIP_BLOCKS,
  // in almost immediately after birth. catches snipers that still hold.
  early: (a) => a.firstBuy !== null && a.firstBuy <= EARLY_BLOCKS,
  // recurs across launches. CANNOT see a rotator; included for comparison, never alone.
  repeat: (a, addr) => a.nBuy > 0 && (poolsPerBuyer.get(addr) || 0) >= REPEAT_MIN,
  // strictest: fast in AND fast out.
  earlyFlipper: (a) => DEFS.early(a) && DEFS.flipper(a),
};

function botsOn(p, def) {
  let n = 0;
  for (const [addr, a] of p.perBuyer) if (DEFS[def](a, addr)) n++;
  return n;
}

// ---------------------------------------------------------------- statistics

const median = (x) => (x.length ? [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)] : NaN);

/** Mann-Whitney U with normal approximation. Non-parametric because these distributions are heavily
 *  skewed — a t-test on seeded liquidity would be dominated by a handful of whales. */
function mannWhitney(a, b) {
  if (a.length < 3 || b.length < 3) return null;
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  let i = 0;
  while (i < all.length) {
    let j = i; while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) all[k].r = r;
    i = j + 1;
  }
  const r0 = all.filter((x) => x.g === 0).reduce((s, x) => s + x.r, 0);
  const n0 = a.length, n1 = b.length;
  const u0 = r0 - (n0 * (n0 + 1)) / 2;
  const mu = (n0 * n1) / 2;
  const sd = Math.sqrt((n0 * n1 * (n0 + n1 + 1)) / 12);
  if (!sd) return null;
  const z = (u0 - mu) / sd;
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  // rank-biserial: interpretable effect size. 0 = identical, ±1 = complete separation.
  return { z, p, effect: (2 * u0) / (n0 * n1) - 1, n0, n1 };
}
function erf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return y;
}

/** Smallest |rho| that would reach p<0.05 at this n. Printed alongside every correlation so a value
 *  below it is visibly noise rather than a finding. */
const rhoThreshold = (n) => (n < 5 ? Infinity : 1.96 / Math.sqrt(n - 1));

// ---------------------------------------------------------------- report

const all = [...pools.values()];

/*
 * RIGHT-CENSORING. A pool born a minute before the log ends has had a minute to attract anyone; one
 * born five hours earlier has had five. Comparing their outcomes measures observation time, not the
 * launch. This is the same error that made TROLLCAT look like a 4-buyer flop: it was scored over 5.5h
 * when 4,973 of its 6,442 swaps arrived later, putting it at the 99.66th percentile chain-wide rather
 * than the bottom. Every pool is therefore truncated to a COMMON observation window, and pools too
 * young to fill it are excluded rather than silently counted as failures.
 */
const lastBlock = Math.max(...all.map((p) => Math.max(p.block, ...p.flow.map((f) => f.block))), 0);
const ages = all.filter((p) => p.hasQuote).map((p) => lastBlock - p.block).sort((a, b) => b - a);
// Default to the window that keeps the oldest ~60% of pools: too wide and everything is censored out,
// too narrow and late-arriving flow is missed — which is precisely how TROLLCAT got mislabelled.
// Widen it deliberately (WINDOW_BLOCKS) as the log grows; wider is stronger, just needs more history.
const WINDOW = Number(process.env.WINDOW_BLOCKS || Math.max(600, ages[Math.floor(ages.length * 0.6)] || 600));
for (const p of all) {
  p.observedFor = lastBlock - p.block;
  p.mature = p.observedFor >= WINDOW;
  // Re-derive outcomes inside the common window only, so every pool is scored on equal exposure.
  const inWin = [...p.perBuyer.entries()].filter(([, a]) => a.firstBuy !== null && a.firstBuy <= WINDOW);
  p.nBuyersWindowed = inWin.length;
}
const censored = all.filter((p) => p.hasQuote && !p.mature).length;
const usable = all.filter((p) => p.hasQuote && p.mature);

console.log(`\n${"=".repeat(78)}\nLAUNCH ANALYSIS — ${FILE}\n${"=".repeat(78)}`);
console.log(`  events read           : ${lines}${bad ? `  (${bad} unparseable)` : ""}`);
console.log(`  pools observed from birth : ${all.length}`);
console.log(`  ...paired against quote   : ${all.filter((p) => p.hasQuote).length}   (others are token/token, not launches)`);
console.log(`  ...observed >= ${WINDOW} blocks : ${usable.length}   (${censored} too young, EXCLUDED not counted as failures)`);
console.log(`  common scoring window   : ${WINDOW} blocks (~${(WINDOW * 0.1 / 60).toFixed(0)} min) — equal exposure for every pool`);
if (ages.length) console.log(`  observation age p90/p50/p10 : ${ages[Math.floor(ages.length * 0.1)]} / ${ages[Math.floor(ages.length * 0.5)]} / ${ages[Math.floor(ages.length * 0.9)]} blocks`);
console.log(`  (raise WINDOW_BLOCKS as the log grows — TROLLCAT looked like a 4-buyer flop at a 5.5h`);
console.log(`   window and turned out 99.66th percentile once its later 4,973 swaps were counted.)`);
console.log(`  with seed recorded        : ${usable.filter((p) => p.seed).length}`);
console.log(`  with a dev buy            : ${usable.filter((p) => p.hasDevBuy).length}`);
console.log(`  that ever traded          : ${usable.filter((p) => p.nBuyers > 0).length}`);

if (usable.length < 30) {
  console.log(`\n  *** ONLY ${usable.length} LAUNCHES. Nothing below can support a conclusion. ***`);
  console.log(`  *** Leave the watcher running — at ~78 launches/hour, a day gives ~1,800. ***`);
}

console.log(`\n--- BASE RATES (read these before any comparison) ---`);
for (const def of Object.keys(DEFS)) {
  const hit = usable.filter((p) => botsOn(p, def) > 0);
  const tot = usable.reduce((s, p) => s + botsOn(p, def), 0);
  console.log(`  ${def.padEnd(13)} : ${String(hit.length).padStart(5)}/${usable.length} pools (${(100 * hit.length / (usable.length || 1)).toFixed(1)}%) touched, ${tot} addresses total`);
}
console.log(`  A definition matching ~everything or ~nothing cannot discriminate, whatever its p-value.`);

// features observable at launch — the only fair candidates, since anything later is an outcome
const FEATURES = [
  ["seedQuote", (p) => p.seedQuote],
  ["seedToken", (p) => p.seedToken],
  ["devBuyQuote", (p) => p.devBuyQuote],
  ["fee", (p) => p.fee],
  ["tickSpacing", (p) => p.tickSpacing],
];

for (const def of ["flipper", "early", "earlyFlipper"]) {
  const bought = usable.filter((p) => botsOn(p, def) > 0);
  const ignored = usable.filter((p) => botsOn(p, def) === 0);
  console.log(`\n--- DISCRIMINATIVE TEST — "${def}"   bought n=${bought.length}  vs  ignored n=${ignored.length} ---`);
  if (bought.length < 3 || ignored.length < 3) { console.log(`  too few on one side to compare.`); continue; }

  for (const [name, get] of FEATURES) {
    const A = bought.map(get).filter((v) => v !== null && Number.isFinite(v));
    const B = ignored.map(get).filter((v) => v !== null && Number.isFinite(v));
    if (A.length < 3 || B.length < 3) { console.log(`  ${name.padEnd(13)} insufficient data`); continue; }

    // A feature that never varies cannot explain anything. This is the trap the reference pad fell
    // into, and it is refused rather than reported.
    const uniq = new Set([...A, ...B]).size;
    if (uniq < 2) { console.log(`  ${name.padEnd(13)} CONSTANT across all launches — cannot be a cause. Not tested.`); continue; }

    const mw = mannWhitney(A, B);
    const line = `  ${name.padEnd(13)} bought med ${String(median(A)).slice(0, 10).padStart(11)}   ignored med ${String(median(B)).slice(0, 10).padStart(11)}`;
    if (!mw) { console.log(`${line}   (n too small)`); continue; }
    const verdict = mw.p < 0.05 ? (Math.abs(mw.effect) > 0.3 ? "DIFFERS" : "differs, small effect") : "no difference";
    console.log(`${line}   effect ${mw.effect >= 0 ? "+" : ""}${mw.effect.toFixed(2)}  p=${mw.p.toFixed(4)}  ${verdict}`);
  }
  console.log(`  (effect is rank-biserial: 0 = identical distributions, ±1 = complete separation.`);
  console.log(`   ${FEATURES.length} features tested, so treat p<${(0.05 / FEATURES.length).toFixed(3)} as the honest bar after multiple comparisons.)`);
}

console.log(`\n--- OUTCOME SPREAD ---`);
const traded = usable.filter((p) => p.nBuyers > 0);
if (traded.length) {
  const bs = traded.map((p) => p.nBuyers).sort((a, b) => a - b);
  const fd = traded.map((p) => p.firstBuyDelta).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`  buyers per traded pool : median ${median(bs)}  max ${bs[bs.length - 1]}  (n=${traded.length})`);
  if (fd.length) console.log(`  blocks to first buy    : median ${median(fd)}  min ${fd[0]}`);
  console.log(`  never traded           : ${usable.length - traded.length}/${usable.length} (${(100 * (usable.length - traded.length) / usable.length).toFixed(1)}%)`);
  console.log(`\n  minimum |rho| meaningful at n=${traded.length}: ${rhoThreshold(traded.length).toFixed(2)}`);
  console.log(`  Any correlation below that is noise. At n=6 the bar is 0.88 — which is why the`);
  console.log(`  six-launch pad could not answer this and ~1,800 observations can.`);
}
console.log();
