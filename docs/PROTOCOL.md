# Monpad protocol — Uniswap V3 LP fee split

Canonical constants: `lib/fees.ts`  
Live JSON: `GET /api/v1/spec`

Monpad follows the **Minta** launchpad model: liquidity and swaps live on **Uniswap V3** (no bonding curve). The site is listing / UI; the money side is the V3 pool + LP fee split.

## Uniswap V3 pool fee (swaps)

| | |
|---|---|
| DEX | **Uniswap V3** (`MonPadGraduatorV3` → official NPM `0x7197…`) |
| Pool fee tier | **1%** (`POOL_FEE = 10000`) |
| Pair | WMON / launched token, full-range LP |

That **1%** is the Uniswap pool fee on every swap through the LP. Monpad’s product split of those LP fees:

## Of LP fees (display / product)

| Share | BPS | What |
|---|---|---|
| **Creator** | **8000 (80%)** | Headline creator share — **includes** nested 10pt project-token burn |
| ↳ nested burn | 1000 (10pts of the 80%) | Launched token → `dEaD` (still counted in creator’s 80%) |
| Platform | **1000 (10%)** | `0x5899…5914` — MON/quote only on sells |
| Burn MONSHI | **1000 (10%)** | Buyback-and-burn Monchi |

Display as **80 / 10 / 10**, not four top-level slices.

## Addresses

| Name | Value |
|---|---|
| MONSHI | `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` |
| Dead | `0x000000000000000000000000000000000000dEaD` |
| Platform | `0x5899a0576A94327a6316E01190f951edf7645914` |
| Uniswap V3 NPM | `0x7197e214c0b767cfb76fb734ab638e2c192f4e53` |
| Chain | Monad `143` |

Factory / pool addresses: refresh from `/api/v1/spec`.
