#!/usr/bin/env node
/*
 * Curve geometry calibrator.
 *
 * The pad's bonding curve is a single-sided currency1 (token) Uniswap V4 range spanning [gradTick, startTick].
 * The pool opens at startTick holding only token; buyers walk the tick DOWN; at gradTick the curve is sold out
 * and the position is entirely quote (MON). For such a range there is a closed form for the raise:
 *
 *     curveSupply = L · (√P_start − √P_grad)
 *     raise       = L · (1/√P_grad − 1/√P_start)
 *   ⇒ raise       = curveSupply / (√P_start · √P_grad)
 *                 = curveSupply / 1.0001^((startTick + gradTick) / 2)
 *
 * So the raise depends only on curveSupply and the MIDPOINT of the tick range, while curveWidth alone fixes the
 * launch→graduation multiple (1.0001^width). The two knobs are independent, which is what makes this solvable
 * directly instead of by search.
 *
 * Sanity check: the audited Robin geometry (curveSupply 730M, start 201600, width 23000) yields 4.05 ETH, which
 * matches the ~4.1 ETH its own calibration sim measures on-chain. That agreement is what validates the formula —
 * `--verify` re-runs it.
 *
 * Usage:
 *   node scripts/calibrate.js                          # defaults: 260,000 MON target, 10x chart
 *   node scripts/calibrate.js --target 500000          # different graduation raise (in MON)
 *   node scripts/calibrate.js --width 30000            # wider chart (1.0001^30000 ≈ 20x)
 *   node scripts/calibrate.js --mon-usd 0.05           # price the USD columns differently
 *   node scripts/calibrate.js --verify                 # reproduce the audited ETH geometry
 */
const L = Math.log(1.0001);
const price = (t) => Math.exp(t * L);

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
}

const SUPPLY = arg("supply", 1e9);
const CURVE = arg("curve-supply", 730e6);
const RESERVE = SUPPLY - CURVE;
const TARGET = arg("target", 260_000);
const WIDTH = arg("width", 23000);
const TS = arg("tick-spacing", 100);
const MON_USD = arg("mon-usd", 0.021);
// graduation waterfall, must match MonPadV4FeeConfig defaults
const PLATFORM_BPS = arg("platform-grad-bps", 1000);
const CREATOR_BPS = arg("creator-grad-bps", 1000);
const AMBUSH_BPS = arg("ambush-grad-bps", 0);
const BOUNTY_BPS = 20, BOUNTY_CAP = 100; // MonPadCurveV4.GRAD_BOUNTY_BPS / GRAD_BOUNTY_MAX_WEI

if (process.argv.includes("--verify")) {
  const mid = (201600 + 178600) / 2;
  const got = 730e6 / price(mid);
  console.log(`audited Robin geometry: start 201600 / grad 178600 / curve 730M`);
  console.log(`  predicted raise ${got.toFixed(2)} ETH — its calibration sim measures ~4.1 ETH on-chain`);
  console.log(got > 3.8 && got < 4.4 ? "  ✓ formula agrees" : "  ✗ FORMULA DISAGREES — do not trust the output below");
  process.exit(0);
}

// solve for the midpoint that produces the target raise, then align the range to the tick spacing
const midNeeded = Math.log(CURVE / TARGET) / L;
const startAligned = Math.round((midNeeded + WIDTH / 2) / TS) * TS;
const gradAligned = startAligned - WIDTH;
const mid = (startAligned + gradAligned) / 2;
const raise = CURVE / price(mid);

const pStart = price(startAligned), pGrad = price(gradAligned); // tokens per MON
const startPx = MON_USD / pStart, gradPx = MON_USD / pGrad;

// reserve sizing: the factory's [HIGH-2] check requires reserveSupply·√start·100 ≥ curveSupply·√grad·105
const k = Math.sqrt(pGrad / pStart);
const reserveFloor = CURVE * k * 1.05;

// how much of the reserve the permanent LP can actually consume, and hence what gets burned
const bounty = Math.min(raise * BOUNTY_BPS / 1e4, BOUNTY_CAP);
const distributable = raise - bounty;
const lpMon = distributable * (1 - (PLATFORM_BPS + CREATOR_BPS + AMBUSH_BPS) / 1e4);
const lpToken = lpMon * pGrad;
const burned = RESERVE - lpToken;

const f = (n, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });
console.log(`
GEOMETRY  (tickSpacing ${TS}, aligned)
  startTickMag   ${startAligned}
  curveWidth     ${WIDTH}          → gradTick ${gradAligned}, ${price(WIDTH).toFixed(2)}x chart
  supply         ${f(SUPPLY / 1e6)}M   = curve ${f(CURVE / 1e6)}M + reserve ${f(RESERVE / 1e6)}M

RAISE
  graduation     ${f(raise)} MON   ($${f(raise * MON_USD)} @ $${MON_USD}/MON)     target ${f(TARGET)}
  start FDV      $${f(startPx * SUPPLY)}
  graduate FDV   $${f(gradPx * SUPPLY)}

RESERVE
  factory floor  ${f(reserveFloor / 1e6, 1)}M   ${RESERVE >= reserveFloor ? `✓ ${f(RESERVE / 1e6, 1)}M passes` : `✗ ${f(RESERVE / 1e6, 1)}M FAILS — launch reverts BadConfig`}
  LP consumes    ${f(lpToken / 1e6, 1)}M  (pairing ${f(lpMon)} MON at the graduation price)
  burned         ${f(burned / 1e6, 1)}M  = ${(burned / SUPPLY * 100).toFixed(2)}% of supply → 0x…dEaD

Set in scripts/deploy-curve.js DEFAULTS (or via env):
  START_TICK_MAG=${startAligned} CURVE_WIDTH=${WIDTH} MIN_GRAD_WIDTH=${WIDTH - 200}
`);
