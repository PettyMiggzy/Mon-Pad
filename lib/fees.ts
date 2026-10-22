// Monpad LP fee split — buys & sells, off LP fees:
//
//   70% → creator
//   10% → platform           (MON / quote only — never project tokens on sells)
//   10% → burn MONSHI        (buyback-and-burn Monchi)
//   10% → burn project token (the token they launched)
//
// Liquidity lives in the DEX/LP (no “graduation target” product story).
// Platform wallet is the Minta treasury carried over to Monpad.

import type { Address } from 'viem';

/** Minta fee-splitter treasury — Monpad platform fee receiver */
export const MONPAD_PLATFORM_WALLET =
  '0x5899a0576A94327a6316E01190f951edf7645914' as Address;

/** 10% of LP fees — burn the launched project token */
export const PROTOCOL_BURN_TOKEN_BPS = 1000;

/** 10% of LP fees — buyback-and-burn MONSHI (Monchi) */
export const PROTOCOL_BURN_MONSHI_BPS = 1000;

/** 10% of LP fees — platform (quote / MON only on sells) */
export const PROTOCOL_PLATFORM_BPS = 1000;

/** 70% of LP fees — creator */
export const CREATOR_SALE_SHARE_BPS = 7000;

/** Burn legs combined (token + MONSHI) = 20% of LP fees */
export const PROTOCOL_BURN_MECHANISM_BPS =
  PROTOCOL_BURN_TOKEN_BPS + PROTOCOL_BURN_MONSHI_BPS;

/** Non-creator share of LP fees = 30% */
export const PROTOCOL_TRADE_SKIM_BPS =
  PROTOCOL_BURN_TOKEN_BPS + PROTOCOL_BURN_MONSHI_BPS + PROTOCOL_PLATFORM_BPS;
