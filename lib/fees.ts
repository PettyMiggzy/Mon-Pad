// Monpad LP fee split — buys & sells, off LP fees:
//
//   80% → creator share
//         └─ of which 10 percentage-points is project-token burn
//            (still counted in the creator’s 80%; burned rather than paid out)
//   10% → platform           (MON / quote only — never project tokens on sells)
//   10% → burn MONSHI        (buyback-and-burn Monchi)
//
// Product story shows the four slices that add to 100%:
// creator payout 70 / platform 10 / burn MONSHI 10 / burn project token 10.
// The 10pt project-token burn is nested inside the creator's on-chain 80.
// Liquidity lives in the DEX/LP (no “graduation target” product story).
// Platform wallet is the Minta treasury carried over to Monpad.

import type { Address } from 'viem';

/** Minta fee-splitter treasury — Monpad platform fee receiver */
export const MONPAD_PLATFORM_WALLET =
  '0x5899a0576A94327a6316E01190f951edf7645914' as Address;

/**
 * Creator’s headline share of LP fees = 80%.
 * Includes the nested project-token burn (`PROTOCOL_BURN_TOKEN_BPS`).
 * Net paid to creator wallet ≈ 70% when the nested burn is 10 points.
 */
export const CREATOR_SALE_SHARE_BPS = 8000;

/** Nested inside creator’s 80%: 10 percentage-points burn the launched project token */
export const PROTOCOL_BURN_TOKEN_BPS = 1000;

/** Net creator payout after nested burn = 70% of LP fees */
export const CREATOR_PAYOUT_BPS = CREATOR_SALE_SHARE_BPS - PROTOCOL_BURN_TOKEN_BPS;

/** 10% of LP fees — buyback-and-burn MONSHI (Monchi) */
export const PROTOCOL_BURN_MONSHI_BPS = 1000;

/** 10% of LP fees — platform (quote / MON only on sells) */
export const PROTOCOL_PLATFORM_BPS = 1000;

/** Burn legs that leave the fee pot (nested token burn is inside creator share) */
export const PROTOCOL_BURN_MECHANISM_BPS = PROTOCOL_BURN_MONSHI_BPS;

/** Non-creator headline share = platform + MONSHI = 20% */
export const PROTOCOL_TRADE_SKIM_BPS =
  PROTOCOL_BURN_MONSHI_BPS + PROTOCOL_PLATFORM_BPS;

/** Four slices that add to 100% of LP fees. UI must import these, not hardcode percents. */
export const LP_FEE_SLICES = [
  { id: 'creator', label: 'Creator', bps: CREATOR_PAYOUT_BPS },
  { id: 'platform', label: 'Platform', bps: PROTOCOL_PLATFORM_BPS },
  { id: 'monshi', label: 'Burn MONSHI', bps: PROTOCOL_BURN_MONSHI_BPS },
  { id: 'project', label: 'Burn project token', bps: PROTOCOL_BURN_TOKEN_BPS },
] as const;

export function feePct(bps: number): string {
  const n = bps / 100;
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

/** One-line copy for UI / API */
export const LP_FEE_SPLIT_COPY = `${LP_FEE_SLICES.map((s) => `${feePct(s.bps)} ${s.label.toLowerCase()}`).join(' / ')} — off LP fees`;
