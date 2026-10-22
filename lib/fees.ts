// Monpad protocol fee spec (Minta port → Monad).
// Creator-set taxes stay independent of these protocol skims.
//
// On every buy & sell (quote notional = MON in / MON out):
//   • 10% burn traded token   (buys: burn from token out; sells: burn from tokens in)
//   • 10% buyback-and-burn Monchi (MONSHI) — quote accrued → keeper/buyback burns
//   • 10% platform            — always in quote (MON); never as project tokens on sells
// Creator share of the launch/sale fee layer (when routed as such): 80% to creator.
// Platform wallet is the Minta treasury carried over to Monpad.

import type { Address } from 'viem';

/** Minta fee-splitter treasury — Monpad platform fee receiver */
export const MONPAD_PLATFORM_WALLET =
  '0x5899a0576A94327a6316E01190f951edf7645914' as Address;

export const PROTOCOL_BURN_TOKEN_BPS = 1000;   // 10% — burn traded token
export const PROTOCOL_BURN_MONSHI_BPS = 1000;  // 10% — buyback & burn MONSHI
export const PROTOCOL_PLATFORM_BPS = 1000;     // 10% — platform (quote only)
export const CREATOR_SALE_SHARE_BPS = 8000;    // 80% — creator share of sale/fee layer

/** Combined protocol skim on trade notional (excludes creator tax). */
export const PROTOCOL_TRADE_SKIM_BPS =
  PROTOCOL_BURN_TOKEN_BPS + PROTOCOL_BURN_MONSHI_BPS + PROTOCOL_PLATFORM_BPS;
