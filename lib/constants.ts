// Mon-Pad v2.1 frontend constants
// Wallet addresses from SPEC_V2.1 §8. Contract addresses are zero sentinels
// until mainnet deploy lands — fill via NEXT_PUBLIC_* env vars in .env.local.

import type { Address } from 'viem';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// --- Wallets (SPEC §8) ----------------------------------------------------
export const PLATFORM_WALLET = (process.env.NEXT_PUBLIC_PLATFORM_WALLET ?? ZERO_ADDRESS) as Address;
export const TREASURY_WALLET = (process.env.NEXT_PUBLIC_TREASURY_WALLET ?? ZERO_ADDRESS) as Address;
export const BUYBACK_WALLET = (process.env.NEXT_PUBLIC_BUYBACK_WALLET ?? TREASURY_WALLET) as Address; // buyback defaults to treasury per V2.1 spec; split via env when needed
export const MONSHI_TOKEN = '0xB744F5CDb792d8187640214C4A1c9aCE29af7777' as const;
export const WMON = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as const;
export const UNISWAP_V3_NPM = '0xa9f6B6656e32F223d778b01642F32D00F5310526' as const;

// --- Admin wallets (SPEC §7) ---------------------------------------------
export const ADMIN_WALLETS = [
  '0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16',
  '0xB9d4B73bE18914c6d64Bee65a806648370be467f',
] as const;

export function isAdmin(address?: string | null): boolean {
  if (!address) return false;
  const lc = address.toLowerCase();
  return ADMIN_WALLETS.some((a) => a.toLowerCase() === lc);
}

// --- V2 contract addresses (zero sentinels, fill via env post-deploy) ----
export const CONTRACTS = {
  factoryV2:   (process.env.NEXT_PUBLIC_FACTORY_V2   ?? ZERO_ADDRESS) as Address,
  hub:         (process.env.NEXT_PUBLIC_HUB          ?? ZERO_ADDRESS) as Address,
  poolFactory: (process.env.NEXT_PUBLIC_POOL_FACTORY ?? ZERO_ADDRESS) as Address,
  graduator:   (process.env.NEXT_PUBLIC_GRADUATOR    ?? ZERO_ADDRESS) as Address,
} as const;

export function contractsConfigured(): boolean {
  return Object.values(CONTRACTS).every((a) => a !== ZERO_ADDRESS);
}

// --- Chain (SPEC: Monad mainnet) -----------------------------------------
export const MONAD_CHAIN_ID = 143 as const;
export const MONAD_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.monad.xyz';
export const MONAD_EXPLORER = 'https://monadscan.com';

// --- Tokenomics constants from SPEC --------------------------------------
export const CREATION_FEE_MON = 100n;
export const GRADUATION_TARGET_MON = 425_000n;
export const CREATOR_GRADUATION_REWARD_MON = 25_000n;
export const TOTAL_SUPPLY = 1_000_000_000n;
export const TOKEN_DECIMALS = 18;

// Fees (basis points)
export const BUY_FEE_CREATOR_BPS = 100;   // 1%
export const BUY_FEE_PLATFORM_BPS = 100;  // 1%
export const SELL_FEE_PLATFORM_BPS = 100; // 1% default
export const SELL_FEE_CREATOR_BPS = 50;   // 0.5% default
export const SELL_FEE_STAKING_BPS = 50;   // 0.5% default

export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;

// --- Backend (monpad-server) ---------------------------------------------
export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || '';
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || SERVER_URL;
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === '1';

// --- Bonding curve constants (mirrors MonPadCurveV2.sol lines 142-144) ---
export const CURVE = {
  V_M: 117_000n * 10n ** 18n,            // virtualMonReserve
  V_T: 1_260_000_000n * 10n ** 18n,      // virtualTokenReserve
  REAL_T: 1_000_000_000n * 10n ** 18n,   // realTokenReserve initial (== TOTAL_SUPPLY)
  GRADUATION_TARGET: GRADUATION_TARGET_MON * 10n ** 18n,
  CREATOR_GRADUATION_REWARD: CREATOR_GRADUATION_REWARD_MON * 10n ** 18n,
} as const;

export const MONORAIL_API = process.env.NEXT_PUBLIC_MONORAIL_API || 'https://pathfinder.monorail.io';
export const MONORAIL_PARTNER_ID = process.env.NEXT_PUBLIC_MONORAIL_PARTNER_ID || '1176408161626';
