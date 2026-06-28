# Mon-Pad MONSHI-native rebuild — design & diff (DRAFT, not deployed)

Status: **drafted in `hardhat-test/contracts/monshi/`, compiles, 7/7 tests passing
(`test/monshi-flow.js`). NOT deployed. MUST be professionally audited before any
mainnet deploy.** The currently-live MON contracts are untouched so this is a clean
audit-diff.

## Goal

Make **MONSHI** (`0xB744F5CDb792d8187640214C4A1c9aCE29af7777`) the base currency:
creators pay to launch in MONSHI, and everyone buys/sells curve tokens in MONSHI.
Plus per-launch, creator-editable tokenomics (fee routing + per-trade tax with
token/MONSHI burns and LP).

## Files

| New file | Based on | Change |
|---|---|---|
| `contracts/monshi/MonPadCurveV2Monshi.sol` | `MonPadCurveV2.sol` | MONSHI quote asset + creator `FeeConfig` + V2 read shim |
| `contracts/monshi/MonPadFactoryV2Monshi.sol` | `MonPadFactoryV2.sol` | `createLaunch` non-payable, MONSHI fees, `quoteToken` immutable, `FeeConfig` param |
| `contracts/monshi/MonPadGraduatorMonshi.sol` | `MonPadGraduator.sol` | builds a **MONSHI/token** V3 LP (no WMON wrap) |
| `contracts/test/MocksMonshi.sol` | new | functional Uniswap V3 mocks + MONSHI graduator stub |
| `test/monshi-flow.js` | new | full lifecycle + tokenomics + invariant tests |
| `MonPadTokenV2.sol` | — | **unchanged** (the launched ERC20 is currency-agnostic) |

## Core MON → MONSHI changes

- **Currency:** every native-MON flow (`msg.value`, `call{value:}`, `receive`) becomes a
  MONSHI ERC20 flow (`transferFrom` / `transfer`). Storage names that say `mon`
  (`monRaisedNet`, `realMonReserve`, …) are kept for layout/frontend familiarity but
  are denominated in MONSHI.
- **`createLaunch(name, symbol, quoteAmount, cfg)`** — no longer `payable`. The creator
  must `approve` the factory for `quoteAmount` MONSHI (`= creationFee + optional devBuy`).
  Fee is pulled to treasury in MONSHI; devBuy MONSHI is pushed into the curve.
- **`buy(quoteIn, minTokensOut)`** — no longer `payable`; pulls `quoteIn` MONSHI via
  `transferFrom` (buyer approves the curve first).
- **`sell(tokensIn, minMonOut)`** — pays the seller in MONSHI via `transfer`.
- **Curve math is byte-for-byte identical** (constant product on virtual reserves), so
  `lib/curve.ts` previews stay valid.
- **Graduation** seeds a **MONSHI/token** Uniswap V3 full-range position and burns the LP
  NFT (sent to dEaD). `onGraduate(token, lpTokens, quoteAmount)` is non-payable; the curve
  transfers both sides to the graduator first.
- **Staking sell-fee:** the curve `transfer`s MONSHI to `getRewardRecipient()` and
  best-effort calls `notifyReward(address,uint256)`. At launch the reward recipient is the
  buyback EOA (staking hub is "coming soon"), so this is a plain MONSHI transfer.

## New: creator tokenomics (`FeeConfig`)

Per-launch struct, set in `createLaunch`, **editable later by the creator** via
`setFeeConfig` (caps enforced):

```solidity
struct FeeConfig {
    // Creator-fee routing — splits the creator's OWN fee. Sum <= 10000; remainder → creator wallet.
    uint16 cfBurnTokenBps;    // buyback-and-burn the project token
    uint16 cfBurnMonshiBps;   // burn MONSHI (→ dEaD)
    uint16 cfLpBps;           // reserve MONSHI for the graduation LP
    // Per-trade tax — EXTRA skim on every trade (all traders). Sum <= MAX_TRADE_TAX_BPS (1000 = 10%).
    uint16 taxBurnTokenBps;
    uint16 taxBurnMonshiBps;
    uint16 taxLpBps;
}
```

- **Burn token** = buyback-and-burn: the allocated MONSHI runs an internal curve micro-buy
  (`_buyAndBurn`), tokens go to dEaD. No external call → no new reentrancy surface (runs
  inside `nonReentrant` trades). Deflationary for the project token.
- **Burn MONSHI** = MONSHI sent straight to dEaD.
- **LP** = MONSHI accumulated in `lpPendingMonshi`, added to the graduation LP.
- **Per-trade tax** is taken off the trade notional (reduces buyer tokens / seller proceeds)
  and routed to the same buckets for *every* trader.
- **Dev buy** at launch pays no fee and no tax.
- Stats: `totalBurnedTokens`, `totalBurnedMonshi`, `lpPendingMonshi`.

**Value-conservation invariant** (asserted in tests): at all times
`MONSHI.balanceOf(curve) >= realMonReserve + creatorPending + platformPending +
lpPendingMonshi + creatorGraduationPending`.

## New: DEX "day 1" index-readiness (Uniswap-V2 read shim)

Pre-graduation tokens stay 100% on the curve (no parallel pool, no arbitrage). To let
DexScreener-style scanners and aggregators (Monorail) display/route them day 1, the curve
exposes the standard V2 pair read interface mapped to its *effective* reserves:

- `getReserves() → (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)` — the
  V2 selector `0x0902f1ac` generic scanners read.
- `token0()` / `token1()` — address-ordered (token vs MONSHI).
- `effectiveReserves()` — `(virtual+real MONSHI, effective tokens)`; `price = m / t` matches
  `priceWeiPerToken()`.

⚠️ **Breaking rename:** the rich 4-tuple curve reserves moved from `getReserves()` to
**`getCurveReserves()`** (so the plain `getReserves()` can be the V2-compatible one). The
frontend swap reads must switch to `getCurveReserves()`.

Off-chain side of "day 1 in DEX": share the factory address with Monorail / scanners so they
index `Launched` events → read each curve via the V2 shim. (Partner ID already
`1176408161626`.)

## Frontend ABI deltas (for the rebuild)

- `createLaunch` now takes `(name, symbol, quoteAmount, FeeConfig)` and is non-payable;
  add a MONSHI `approve(factory, quoteAmount)` step and a creator tokenomics form.
- `buy(quoteIn, minOut)` non-payable; add MONSHI `approve(curve, quoteIn)` before buys.
- `sell` unchanged signature; proceeds arrive as MONSHI.
- Token-page trade panel must read `getCurveReserves()` (renamed) for previews.
- New: creator tokenomics editor calling `setFeeConfig`; surface burn/LP stats.
- Banner / pfp / socials are **off-chain** — extend the existing
  `/api/launches/prepare` metadata + a creator-auth `PATCH` (backend), not the contracts.

## Deploy notes (when audited)

1. Deploy `MonPadFactoryV2Monshi(platform, treasury, buyback, MONSHI)`.
2. Deploy `MonPadGraduatorMonshi(factory, NPM, MONSHI)` (NPM = `0xa9f6…0526`).
3. `factory.bootstrapInit(graduator, rewardRouter, poolFactory)`.
4. A MONSHI-native staking hub (`notifyReward(address,uint256)`) is **not yet written** —
   until then set `rewardRouter` to the buyback wallet so the sell staking-fee is a plain
   MONSHI transfer.
5. Point the frontend env at the new addresses; rebuild with cache cleared.

## Not done / open items

- [ ] MONSHI staking hub (`MonPadStakingHubMonshi`) — deferred (staking is "coming soon").
- [ ] Frontend rewiring (approve flows, createLaunch cfg, `getCurveReserves`, tokenomics UI).
- [ ] Backend: banner/pfp/socials edit endpoint + indexer for MONSHI events.
- [ ] Deploy script for the MONSHI set.
- [ ] **Professional security audit** — buyback-burn + auto-LP inside a bonding curve are
      the highest-risk surfaces; the included tests are smoke/invariant level, not an audit.
