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

// --- V3 (native-MON pad, LIVE on Monad mainnet 143) ----------------------
// ⚠️ TEST MODE: the live site is pointed at a LOW-FEE test deploy (1 MON to create,
//    20 MON to graduate) for end-to-end testing. Hard-coded so it works with NO
//    Vercel env vars — the NEXT_PUBLIC_FACTORY_V3 / _GRADUATOR_V3 env vars are
//    intentionally ignored (see resolveFactory below).
//
//    To restore PRODUCTION (full-fee, audited) deploy, set:
//      FACTORY_V3_DEFAULT   = 0xf82bFD436ea36515DFF5A6933980F86813D4f3Fa
//      GRADUATOR_V3_DEFAULT = 0x9770b2a62d719b67E4Be206b0B0158b1448eB666
//    and the V3_* economics below back to 500 / 260_000 / 41_700 / 10_400,
//    and re-enable the env-aware resolveFactory() (commented inside).
export const FACTORY_V3_DEFAULT = '0x38e4056Db9BB7b3e499A3C6Ec8c5D6C69409458D' as Address;   // TEST factory
export const GRADUATOR_V3_DEFAULT = '0xa858791D36C4c911F483E60af31f1480F6fAe292' as Address; // TEST graduator

// Retired factories — NEVER transact with these (pre-rebalance curve / compromised
// treasury). Includes the prior production factory while we're in test mode.
export const SUPERSEDED_FACTORIES: ReadonlySet<string> = new Set(
  [
    '0x9007E499EdafBEC87Cc363fbE8Fd2B31142F4C01',
    '0x9ae8376ef5F22e02e217b1A4081686ea9e488E9C',
  ].map((a) => a.toLowerCase()),
);

// TEST MODE: hard-code to the test deploy, ignoring env entirely.
// (Production version was env-aware with a superseded-factory self-heal.)
function resolveFactory(): Address {
  return FACTORY_V3_DEFAULT;
}
export const FACTORY_V3 = resolveFactory();
export const GRADUATOR_V3 = GRADUATOR_V3_DEFAULT;
export function v3Configured(): boolean { return FACTORY_V3 !== ZERO_ADDRESS; }
export function factoryIsSuperseded(addr: string = FACTORY_V3): boolean {
  return SUPERSEDED_FACTORIES.has((addr || '').toLowerCase());
}

// V3 economics — ⚠️ TEST MODE values (match the low-fee test factory).
// Production values: 500 / 260_000 / 41_700 / 10_400.
export const V3_CREATION_FEE_MON = 1n;
export const V3_GRADUATION_TARGET_MON = 20n;
export const V3_CREATOR_REWARD_MON = 10n;
export const V3_TREASURY_CUT_MON = 2n;
export const V3_MAX_DEV_BUY_BPS = 200;     // 2% supply cap on dev buy
export const V3_MAX_TRADE_TAX_BPS = 1000;  // 10% creator per-trade tax cap
export const V3_BUY_FEE_CREATOR_BPS = 100;
export const V3_BUY_FEE_BUFFER_BPS = 100;
export const V3_SELL_FEE_CREATOR_BPS = 50;
export const V3_SELL_FEE_STAKING_BPS = 50;  // -> MONSHI buyback
export const V3_SELL_FEE_PLATFORM_BPS = 100;
// Curve self-calibration: virtualMon = gradTarget * 117000/425000 (preserves the audited shape).
export const V3_TOTAL_SUPPLY = 1_000_000_000n;

// --- Chain (SPEC: Monad mainnet) -----------------------------------------
export const MONAD_CHAIN_ID = 143 as const;
// RPC routing — the QuickNode URL is kept SERVER-SIDE only (RPC_URL) and never
// shipped to the browser. In the browser, all RPC goes through the same-origin
// /api/rpc proxy; on the server we hit the real endpoint directly (faster, no
// self-proxy loop). process.env.RPC_URL is non-public so it is stripped from the
// client bundle. Do NOT set NEXT_PUBLIC_RPC_URL/_FALLBACK/_WSS (those would leak).
export const MONAD_RPC_URL =
  typeof window !== 'undefined'
    ? `${window.location.origin}/api/rpc`
    : process.env.RPC_URL || 'https://rpc.monad.xyz';
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
// INDEXER_URL is intentionally NOT a fallback to SERVER_URL: the live-ticker /
// token poll only runs against a dedicated indexer. Without one set, the app
// reads everything on-chain and the ticker stays quiet (no 404 spam).
export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '';
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === '1';

// --- Bonding curve constants (mirrors MonPadCurveV2.sol lines 142-144) ---
export const CURVE = {
  V_M: 117_000n * 10n ** 18n,            // virtualMonReserve
  V_T: 1_260_000_000n * 10n ** 18n,      // virtualTokenReserve
  REAL_T: 1_000_000_000n * 10n ** 18n,   // realTokenReserve initial (== TOTAL_SUPPLY)
  GRADUATION_TARGET: GRADUATION_TARGET_MON * 10n ** 18n,
  CREATOR_GRADUATION_REWARD: CREATOR_GRADUATION_REWARD_MON * 10n ** 18n,
} as const;

// Monorail aggregator (keyless — the public pathfinder/api endpoints need no key).
// `source` is NOT auth: it's the Chogi App ID revenue tag. Every swap routed with
// it accrues the 1% partner fee (100% to the Chogi treasury). Pass it on quotes.
export const MONORAIL_API = process.env.NEXT_PUBLIC_MONORAIL_API || 'https://pathfinder.monorail.xyz';
export const MONORAIL_DATA_API = process.env.NEXT_PUBLIC_MONORAIL_DATA_API || 'https://api.monorail.xyz';
export const MONORAIL_PARTNER_ID = process.env.NEXT_PUBLIC_MONORAIL_PARTNER_ID || '1176408161625'; // Chogi App ID
