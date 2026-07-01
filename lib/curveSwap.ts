// lib/curveSwap.ts
// Mon-Pad bonding curve swap helpers - preview math, preflight gates,
// allowance/approve helpers, write-call args.
//
// Preview math mirrors MonPadCurveV2.sol exactly:
// - BUY: fees taken off-the-top of monIn, then constant-product on virtual reserves
// - SELL: constant-product to grossMonOut, then fees taken off-the-top of grossMonOut
//
// See hardhat-test/contracts/MonPadCurveV2.sol lines 213-336 (buy) and 267-299 (sell).

import { maxUint256 } from 'viem';

// Mirrors the 1_000_000_000 ether supply constant in MonPadCurveV2.sol
export const SUPPLY_CONST = 10n ** 9n * 10n ** 18n;
export const MAX_UINT256 = maxUint256;

export type CurveReserves = {
  virtualMonReserve: bigint;
  virtualTokenReserve: bigint;
  realMonReserve: bigint;
  realTokenReserve: bigint;
};

export type CurveFees = {
  buyCreatorBps: number;
  buyBufferBps: number;
  sellCreatorBps: number;
  sellStakingBps: number;
  sellPlatformBps: number;
  tradeTaxBps?: number; // creator-set per-trade tax (taxBurnTokenBps + taxLpBps); charged on BOTH sides
};

export type PreflightState = {
  pauseAllBuys: boolean;
  pauseAllSells: boolean;
  blocked: boolean;
  pauseBuys: boolean;
  pauseSells: boolean;
  graduated: boolean;
};

export type PreflightResult =
  | { ok: true }
  | { ok: false; reason: string; reroute?: 'monorail' };

// previewBuy: replicate MonPadCurveV2.sol _buy() math exactly.
// monIn -> tokensOut (after creator+buffer fees off-the-top).
export function previewBuy(
  monIn: bigint,
  r: CurveReserves,
  f: CurveFees
): bigint {
  if (monIn <= 0n) return 0n;
  const creatorFee = (monIn * BigInt(f.buyCreatorBps)) / 10000n;
  const bufferFee = (monIn * BigInt(f.buyBufferBps)) / 10000n;
  const taxTotal = (monIn * BigInt(f.tradeTaxBps ?? 0)) / 10000n; // contract subtracts tax off-the-top too
  const monForBuy = monIn - creatorFee - bufferFee - taxTotal;
  if (monForBuy <= 0n) return 0n;

  const currentMon = r.virtualMonReserve + r.realMonReserve;
  const currentTokens =
    r.virtualTokenReserve - (SUPPLY_CONST - r.realTokenReserve);
  if (currentTokens <= 0n) return 0n;

  const newMonReserve = currentMon + monForBuy;
  const newTokenReserve = (currentMon * currentTokens) / newMonReserve;
  const tokensOut = currentTokens - newTokenReserve;
  // Real liquidity cap from contract: tokensOut <= realTokenReserve
  if (tokensOut > r.realTokenReserve) return r.realTokenReserve;
  return tokensOut;
}

// previewSell: replicate MonPadCurveV2.sol _calcSellOut() + fee deduction.
// tokensIn -> monOut (after creator+staking+platform fees off-the-top of grossMonOut).
export function previewSell(
  tokensIn: bigint,
  r: CurveReserves,
  f: CurveFees
): bigint {
  if (tokensIn <= 0n) return 0n;

  const currentMon = r.virtualMonReserve + r.realMonReserve;
  const currentTokens =
    r.virtualTokenReserve - (SUPPLY_CONST - r.realTokenReserve);
  if (currentTokens <= 0n) return 0n;

  const k = currentMon * currentTokens;
  const newTokenReserve = currentTokens + tokensIn;
  const newMonReserve = k / newTokenReserve;
  const grossMonOut = currentMon - newMonReserve;
  if (grossMonOut <= 0n) return 0n;
  // Real liquidity cap from contract: grossMonOut <= realMonReserve
  const gross =
    grossMonOut > r.realMonReserve ? r.realMonReserve : grossMonOut;

  const creatorFee = (gross * BigInt(f.sellCreatorBps)) / 10000n;
  const stakingFee = (gross * BigInt(f.sellStakingBps)) / 10000n;
  const platformFee = (gross * BigInt(f.sellPlatformBps)) / 10000n;
  const taxTotal = (gross * BigInt(f.tradeTaxBps ?? 0)) / 10000n; // contract subtracts tax on sells too
  return gross - creatorFee - stakingFee - platformFee - taxTotal;
}

// Apply slippage bps to a quoted output to produce a minOut floor.
export function applySlippage(out: bigint, slippageBps: number): bigint {
  return (out * BigInt(10000 - slippageBps)) / 10000n;
}

// Preflight gate for a buy intent.
export function preflightBuy(s: PreflightState): PreflightResult {
  if (s.graduated)
    return { ok: false, reason: 'Token has graduated - routing through aggregator', reroute: 'monorail' };
  if (s.pauseAllBuys)
    return { ok: false, reason: 'Buys paused on Mon-Pad - try again later' };
  if (s.blocked)
    return { ok: false, reason: 'This token has been blocked by Mon-Pad' };
  if (s.pauseBuys)
    return { ok: false, reason: 'Buys paused on this token' };
  return { ok: true };
}

// Preflight gate for a sell intent.
export function preflightSell(s: PreflightState): PreflightResult {
  if (s.graduated)
    return { ok: false, reason: 'Token has graduated - routing through aggregator', reroute: 'monorail' };
  if (s.pauseAllSells)
    return { ok: false, reason: 'Sells paused on Mon-Pad - try again later' };
  if (s.blocked)
    return { ok: false, reason: 'This token has been blocked by Mon-Pad' };
  if (s.pauseSells)
    return { ok: false, reason: 'Sells paused on this token' };
  return { ok: true };
}

// Helper: check whether existing allowance is sufficient for a sell amount.
export function needsApprove(allowance: bigint, amount: bigint): boolean {
  return allowance < amount;
}
