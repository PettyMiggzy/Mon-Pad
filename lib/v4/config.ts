// Monpad V4 (Uniswap V4 + hook launcher) wiring. Everything here is inert until the three contract addresses are set:
//   NEXT_PUBLIC_LAUNCHER_UV4, NEXT_PUBLIC_HOOK_UV4, NEXT_PUBLIC_ROUTER_UV4
// (printed by hardhat-test/scripts/deployUV4.js). With them unset the site keeps its existing behaviour.
import type { Address } from 'viem';

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const addr = (v: string | undefined, fallback: Address = ZERO): Address =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? (v.trim() as Address) : fallback;

export const LAUNCHER_V4 = addr(process.env.NEXT_PUBLIC_LAUNCHER_UV4);
export const HOOK_V4 = addr(process.env.NEXT_PUBLIC_HOOK_UV4);
export const ROUTER_V4 = addr(process.env.NEXT_PUBLIC_ROUTER_UV4);
/** Uniswap V4 StateView on Monad mainnet (read-only price/liquidity lookups). */
export const STATE_VIEW_V4 = addr(process.env.NEXT_PUBLIC_STATE_VIEW_UV4, '0x77395f3b2e73ae90843717371294fa97cc419d64');

export function v4Configured(): boolean {
  return LAUNCHER_V4 !== ZERO && HOOK_V4 !== ZERO && ROUTER_V4 !== ZERO;
}

export const QUOTE_DECIMALS = 6; // USDC
export const TOKEN_DECIMALS = 18;
export const DYNAMIC_FEE = 0x800000;
export const TICK_SPACING = 200;
export const BASE_FEE_BPS = 100; // 1% on every swap, plus the creator's tax
export const MAX_CREATOR_TAX_BPS = 500;
export const MAX_DEV_BUY_BPS = 500; // dev buy is capped at 5% of supply by the launcher
