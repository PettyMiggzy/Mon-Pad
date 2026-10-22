# Monpad protocol — LP fee split

Canonical constants: `lib/fees.ts`  
Live JSON: `GET /api/v1/spec`

## Of LP fees on every buy & sell

| Share | BPS | What |
|---|---|---|
| Creator | **7000 (70%)** | Token creator |
| Platform | **1000 (10%)** | `0x5899a0576A94327a6316E01190f951edf7645914` — MON/quote only (never project tokens on sells) |
| Burn MONSHI | **1000 (10%)** | Buyback-and-burn Monchi |
| Burn project token | **1000 (10%)** | The token they launched → `dEaD` |

Liquidity lives in the **DEX/LP** — there is no product “graduation target.” The curve is the pool.

## Addresses

| Name | Value |
|---|---|
| MONSHI | `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` |
| Dead | `0x000000000000000000000000000000000000dEaD` |
| Platform | `0x5899a0576A94327a6316E01190f951edf7645914` |
| Chain | Monad `143` · RPC `https://rpc.monad.xyz` |

Factory / pool addresses: always refresh from `/api/v1/spec`.
