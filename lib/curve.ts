import { CURVE } from './constants';

// Constant-product AMM mirrors MonPadCurveV2.sol:
//   m = V_M + realMonReserve  (realMonReserve == monRaisedNet, net of fees)
//   t = V_T - tokensSold       (tokensSold == REAL_T - realTokenReserve)
//   Invariant: m * t = V_M * V_T = k
//
// All functions are pure math, no network calls. For client-side quote previews
// and the curve visualization. Must match contract math byte-for-byte or
// quote previews will diverge from actual trade outcomes.

const K = CURVE.V_M * CURVE.V_T;

/**
 * Pure curve math. Returns tokens out for a given MON net (post-fee) input.
 *
 * IMPORTANT: monIn here is the NET amount entering the curve, AFTER fees.
 * The contract takes the buy fee off the top before adding to realMonReserve.
 * Callers must compute:
 *   monInNet = grossMonIn * (10000n - BUY_FEE_TOTAL_BPS) / 10000n
 * before passing to this function. Otherwise quotes will overstate tokens out.
 *
 * BUY_FEE_TOTAL_BPS = BUY_FEE_CREATOR_BPS + BUY_FEE_PLATFORM_BPS (currently 200 = 2%).
 *
 * @param monIn   MON entering the curve, net of buy fees (1e18-scaled bigint)
 * @param monRaisedNet  Current net MON raised on the curve (contract: realMonReserve)
 * @returns tokens out (1e18-scaled bigint)
 */
export function previewBuy(monIn: bigint, monRaisedNet: bigint): bigint {
  if (monIn <= 0n) return 0n;
  const m = CURVE.V_M + monRaisedNet;
  const t = K / m;
  const newM = m + monIn;
  const newT = K / newM;
  return t - newT;
}

/**
 * Pure curve math. Returns MON out for a given token input.
 *
 * IMPORTANT: this returns the GROSS MON the curve releases. The contract
 * then takes the sell fee off the top before sending to the seller. Callers
 * who want the user-receivable amount must compute:
 *   monOutToUser = grossMonOut * (10000n - SELL_FEE_TOTAL_BPS) / 10000n
 * after calling this function. Otherwise quotes will overstate user proceeds.
 *
 * SELL_FEE_TOTAL_BPS = SELL_FEE_PLATFORM_BPS + SELL_FEE_CREATOR_BPS + SELL_FEE_STAKING_BPS
 * (currently 200 = 2%).
 *
 * @param tokensIn  Tokens being sold into the curve (1e18-scaled bigint)
 * @param monRaisedNet  Current net MON raised on the curve (contract: realMonReserve)
 * @returns gross MON released by the curve (1e18-scaled bigint, pre-fee)
 */
export function previewSell(tokensIn: bigint, monRaisedNet: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  const m = CURVE.V_M + monRaisedNet;
  const t = K / m;
  const newT = t + tokensIn;
  const newM = K / newT;
  return m - newM;
}

/**
 * Spot price (MON per token) at a given curve state, as a float.
 * Use only for display \u2014 NOT for trade execution.
 */
export function priceAtMon(monRaisedNet: bigint): number {
  const m = CURVE.V_M + monRaisedNet;
  const t = K / m;
  if (t === 0n) return 0;
  // price = m / t, both 1e18-scaled, so ratio is unit-less MON-per-token
  return Number(m) / Number(t);
}

/**
 * Graduation progress as 0..1 float.
 */
export function graduationProgress(monRaisedNet: bigint): number {
  if (CURVE.GRADUATION_TARGET === 0n) return 0;
  if (monRaisedNet >= CURVE.GRADUATION_TARGET) return 1;
  if (monRaisedNet <= 0n) return 0;
  return Number(monRaisedNet) / Number(CURVE.GRADUATION_TARGET);
}

/**
 * MON remaining until graduation (1e18-scaled bigint).
 */
export function monToGraduation(monRaisedNet: bigint): bigint {
  if (monRaisedNet >= CURVE.GRADUATION_TARGET) return 0n;
  return CURVE.GRADUATION_TARGET - monRaisedNet;
}
