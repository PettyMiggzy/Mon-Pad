# Mon-Pad V3 (native MON) — Deployed to Monad Mainnet

**Chain:** Monad Mainnet (chainId **143**)
**Base currency:** native **MON**
**Status:** contracts live; pending ownership transfer + frontend wiring + DexScreener listing.

## Contracts

| Contract | Address |
|---|---|
| MonPadFactoryV3 | `0x9007E499EdafBEC87Cc363fbE8Fd2B31142F4C01` |
| MonPadGraduatorV3 | `0x07b5AAaB9080f4A7aA491933437e47e3dFFe90a9` |
| MonPadCurveV3 (impl, cloned per token) | `0x4410feC440D3F774266323B79ee0E06f2d2D07Ca` |
| MonPadTokenV2 (impl, cloned per token) | `0x61d018D65a6A66270f335812E05dc6A7181D40b6` |

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
