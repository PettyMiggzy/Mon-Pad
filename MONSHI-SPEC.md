# Mon-Pad (MONSHI-native) — full lifecycle spec

Everything from creation to post-graduation. **Numbers below are the current
defaults inherited from the MON design — they are now denominated in MONSHI and
you should confirm/replace them with MONSHI-appropriate values before deploy
(see ⚠️ at the end).** All params are admin-tunable behind a 24h timelock.

Base currency: **MONSHI** (`0xB744F5CDb792d8187640214C4A1c9aCE29af7777`).
Per-token supply: **1,000,000,000 (1B)**, 18 decimals.

---

## 1. Creation — `createLaunch(name, symbol, quoteAmount, feeConfig)`

The creator first `approve`s the factory for `quoteAmount` MONSHI, then calls
`createLaunch`. `quoteAmount = creationFee + devBuy` (devBuy optional).

| Item | Default | Notes |
|---|---|---|
| **Creation fee** | **100 MONSHI** | Pulled from creator → **treasury** wallet. |
| **Dev buy at creation** | optional, **0 or ≥ minDevBuyMon (0)** | Capped so dev receives **≤ 2% of supply** (`maxDevBuyBps = 200`). Fee-free + tax-free. |
| Token + curve | cloned (EIP-1167) | 1B supply minted to the curve. |
| FeeConfig | set here, editable later | creator tokenomics (below). |

**Dev buy mechanics (confirmed working):** if `quoteAmount > creationFee`, the
surplus is the dev buy. The factory transfers it into the curve and calls
`devBuy(creator, amount)` atomically. The curve enforces the 2% supply cap and
reverts the whole launch if exceeded. Dev pays **no creator fee and no per-trade
tax** on this initial buy. Result: the creator can launch and grab up to 2% in
one transaction.

**Creator tokenomics (`FeeConfig`, editable anytime by the creator):**
- *Creator-fee routing* — splits the creator's OWN trade fee into: buyback-burn
  the project token / burn MONSHI / reserve for the graduation LP / (remainder →
  creator wallet). Cannot route to anyone but burn/LP/self.
- *Per-trade tax* — an extra skim on **every** trade (all traders), capped at
  **10%**, routed to the same buyback-burn / MONSHI-burn / LP buckets.
- Banner / pfp / socials are **off-chain** metadata (backend), not on-chain.

---

## 2. Trading on the bonding curve (pre-graduation)

Constant-product curve (`m·t = k`) on virtual reserves
(`virtualMon = 117,000`, `virtualToken = 1.26B`, `realToken = 1B`).

**Buy** — `buy(quoteIn, minTokensOut)` (approve MONSHI first):
- Fees off the top: **1% creator + 1% platform buffer + per-trade tax**.
- Remainder buys tokens on the curve; buyer protected by `minTokensOut`.

**Sell** — `sell(tokensIn, minMonOut)` (approve token first):
- Gross MONSHI out from the curve, then **0.5% creator + 0.5% staking + 1%
  platform + per-trade tax** off the top; seller protected by `minMonOut`.

Creator fees accrue to a pull-claim (`claimCreatorRewards`). Platform buffer
accrues to a pull-claim (`claimPlatformBuffer`). Staking 0.5% is sent in MONSHI
to the reward recipient (buyback wallet until a MONSHI staking hub ships).

**Graduation progress** = `monRaisedNet / graduationTarget` (the V2 read shim
also exposes price/reserves for scanners — see §5).

---

## 3. Graduation — `graduate()` (permissionless, retryable)

When `monRaisedNet ≥ graduationTarget`, anyone (the frontend auto-calls it, or a
keeper, or the next trader) calls `graduate()`:

| Item | Default | Notes |
|---|---|---|
| **Graduation target** | **425,000 MONSHI** (net raised) | Snapshotted per-curve at launch. |
| **Creator graduation reward** | **25,000 MONSHI** | Reserved for the creator to pull. |
| LP seed | curve's remaining MONSHI + tokens | Builds a **MONSHI/token Uniswap V3** full-range position. |
| LP NFT | **burned to dEaD** | Liquidity locked forever. |

Graduation is **decoupled from `buy()`** (audit fix): a griefed/mispriced
external pool can never brick trading; `graduate()` just reverts atomically and
can be retried.

---

## 4. Post-graduation

- Curve trading stops; the token trades on the **MONSHI/token Uniswap V3 pool**.
- That real V3 pool **auto-appears on DexScreener** (DexScreener indexes Uniswap
  V3 on Monad) — graduated visibility is automatic.
- Creator pulls: accrued fees (`claimCreatorRewards`) + the 25k MONSHI reward
  (`claimGraduationReward`). Platform pulls the buffer (`claimPlatformBuffer`).

---

## 5. DexScreener / DEX "day 1" — the honest reality

The curve already exposes a **Uniswap-V2 read shim** (`getReserves`, `token0`,
`token1`) + clean `Buy`/`Sell` events, so it is *index-ready*. **But that alone
does NOT guarantee a DexScreener listing pre-graduation**, because DexScreener
auto-indexes pools created by DEX factories it already supports — a standalone
bonding curve is not one of those. Pump.fun tokens show pre-bond on DexScreener
only because DexScreener built a **custom pump.fun integration**.

So, to be on DexScreener **from day 1 (pre-graduation)**, the real options are:

- **(A) Submit Mon-Pad to DexScreener for a bonding-curve integration** (the
  pump.fun model). Free, uses the read shim we already have, but requires their
  onboarding — not instant and not guaranteed by us alone.
- **(B) Seed a tiny real MONSHI/token Uniswap V3 pool at creation.** DexScreener
  then auto-detects it day 1. Downside: a second price venue → arbitrage between
  curve and pool, split liquidity, more risk (you previously chose to avoid this).
- **(C) Post-graduation** the real V3 pool shows automatically (always true).

Graduated = automatic. Pre-graduation day-1 DexScreener = needs (A) or (B).

---

## ⚠️ Confirm before deploy

1. **MONSHI-denominated values.** 100 / 425,000 / 25,000 are the old MON numbers.
   Decide the right MONSHI amounts (depends on MONSHI price/supply). If you change
   the graduation target a lot, the curve's virtual reserves
   (`117,000 / 1.26B`) should be re-calibrated to keep a sensible launch→grad
   price multiple.
2. **Wallets you control:** platform / treasury / buyback (don't reuse the old
   access-lost treasury).
3. **Owner key:** the deployer becomes owner. Transfer ownership to a secure
   wallet **before** discarding the burner, or you lose admin control.
4. **DexScreener approach:** (A), (B), or (C)-only — see §5.
