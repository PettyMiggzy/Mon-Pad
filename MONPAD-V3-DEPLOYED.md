# Mon-Pad V3 (native MON) — Deployed to Monad Mainnet

**Chain:** Monad Mainnet (chainId **143**)
**Base currency:** native **MON**
**Status:** contracts live + **source-verified** (Etherscan V2, chain 143); pending ownership `acceptOwnership` + frontend wiring + DexScreener listing.

> **Redeployed 2026-06-28** with the rebalanced curve (nad.fun-style **180,000 virtual MON**
> = `gradTarget × 9/13`) + a **100 MON creation-fee buffer** seeded into each curve + a
> **25% buyback skim** on the creator's per-trade tax above the 2% free threshold
> (`taxSkimRateBps`, tunable). This moderates early-buyer share (first $96 ≈ 3.3% vs 8%),
> splits ~75% curve / ~25% DEX LP, and opens the DEX at ≈ the curve's final price (no
> graduation spike). Earlier sets (`0x9007…4C01`, `0x9ae8…E9C`) are superseded — do not use.
> See `CURVE-FINDINGS.md`.

All 4 contracts are verified (Etherscan V2, chain 143):
MonPadCurveV3, MonPadTokenV2, MonPadFactoryV3, MonPadGraduatorV3 — view at
`https://monadscan.com/address/<address>#code`. Re-run with `scripts/verify-v3.sh`.

**Ownership:** `transferOwnership` called → `pendingOwner` = `0xC022B75D302AF292328cc0C056c7310552E74c8E`
on the factory + graduator; call `acceptOwnership()` from that wallet to finalize, then the
burner is safe to discard.

**RPC:** the app uses a QuickNode Monad-mainnet endpoint (set `NEXT_PUBLIC_RPC_URL` +
`NEXT_PUBLIC_RPC_WSS` in Vercel/.env.local; public `rpc.monad.xyz` is the fallback).

## Contracts

| Contract | Address |
|---|---|
| MonPadFactoryV3 | `0x11495d18d065c78AC64891F45E81902036791143` |
| MonPadGraduatorV3 | `0xc86C4A94C2C2Efa05115A7c523D3a074aA243E5e` |
| MonPadCurveV3 (impl, cloned per token) | `0x6d008Fa497acEc9EE7Ab78344a3D88cB04Da0ebe` |
| MonPadTokenV2 (impl, cloned per token) | `0x4fC4df29a5dE017b198D0CA966A3762dE1E356bf` |

_Superseded (do not use): factories `0x9007E499EdafBEC87Cc363fbE8Fd2B31142F4C01`, `0x9ae8376ef5F22e02e217b1A4081686ea9e488E9C`._

## Wallet roles

| Role | Address | Notes |
|---|---|---|
| Owner / Deployer (TEMP burner) | `0xbbDB9561c981E72290EF5d138d781C14A825fAd5` | ⚠️ transfer ownership off this before discarding |
| Platform | `0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16` | platform trade-fee cut |
| Treasury | `0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5` | creation fees + $200 graduation cut |
| Buyback | `0xe7a31fd91a6f2ab0c73db3b7d0954a6a3acc7ab5` | 0.5% sell slice → buy & burn MONSHI |

## External (pre-existing on Monad)

| Contract | Address |
|---|---|
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| Uniswap V3 NonfungiblePositionManager | `0xa9f6B6656e32F223d778b01642F32D00F5310526` |
| MONSHI (holder discount + buyback target) | `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` |

## Economics (live; tunable via 24h timelock)

- **Creation fee:** 500 MON (~$10) — MONSHI holders get a discount.
- **Graduation target:** 260,000 MON (~$5,000 raised).
- **Creator graduation reward:** 41,700 MON (~$800).
- **Treasury graduation cut:** 10,400 MON (~$200).
- **LP at graduation:** the rest + ALL unsold tokens → WMON/token Uniswap V3, NFT burned.
- **Trade fees:** buy 1% creator + 1% platform buffer; sell 0.5% creator + 0.5% MONSHI-buyback + 1% platform; plus optional creator per-trade tax (≤10%) → token buyback-burn / LP.
- Per-token creator FeeConfig: token buyback-burn + LP reserve, editable by the creator.

## ⚠️ Immediate next steps (owner = burner)

1. **Transfer ownership off the burner** to a wallet you keep:
   `factory.transferOwnership(<your wallet>)` then `acceptOwnership()` from that wallet.
   Same for the graduator (`MonPadGraduatorV3.transferOwnership` / `acceptOwnership`).
   Until this is done, do NOT discard the burner.
2. **Verify the 5 contracts** on the Monad explorer (source) — needed for the DexScreener parser request.
3. **DexScreener listing request** — use the addresses above + `DEXSCREENER-INDEXING.md`
   (factory `Launch` event discovers curve clones; curve `Trade` event charts pre-bond).
4. **Frontend wiring** — point the app at the factory + WMON + MONSHI; native-MON buy/sell;
   creator tokenomics form; `getCurveReserves` for previews.

## Deploy record

See `hardhat-test/deployments/v3-143.json`. Deployer (burner)
`0xbbDB9561c981E72290EF5d138d781C14A825fAd5`. Source: `hardhat-test/contracts/v3/`.
