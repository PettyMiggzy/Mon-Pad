# Curve economics — findings & recommendation

Measured against the **live deployed contracts** on a Monad-mainnet fork
(`hardhat-test/scripts/curve-analysis.js`). MON ≈ $0.0192 (260,000 MON
graduation ≈ $5,000).

## What the current curve does

Self-calibration: `virtualMonReserve = gradTarget × 117000/425000 ≈ 0.275 ×
gradTarget` (inherited from V2). With `gradTarget = 260,000`, `vm ≈ 71,576`.

### 1. Early buyers grab a large share for cheap (first buyer, no prior buys)

| MON in | ~$ in | % of total supply |
|-------:|------:|------------------:|
| 100    | $1.92 | 0.17% |
| 1,000  | $19   | 1.7%  |
| 2,600  | $50   | 4.3%  |
| 5,000  | $96   | **8.1%** |
| 10,000 | $192  | **15.2%** |
| 26,000 | $500  | **33.1%** |

A single wallet can take **a third of the supply for $500**.

### 2. Graduation opens the DEX ~20× above the curve price (discontinuity)

- Supply **sold on the curve: ~99%**; left for the DEX pool: **~1%** (≈8.3M tokens).
- DEX pool seeded with ~212,500 MON + ~8.3M tokens → opens at **~20× the curve's
  final price**. That markup isn't real demand; first sellers dump into a thin
  pool and the price bleeds down. Unhealthy launch.

### 3. Roundtrip is safe ✅

Buy 1,000 MON, sell back → lose ~49 MON to fees (~4.9% round-trip). No value
extraction, no drain. (Selling 100% as the *sole* holder reverts on a 1-wei
rounding floor — benign; partial/normal sells are fine.)

## Root cause

`vm` is too small relative to supply, so MON buys too many tokens early **and**
almost the whole supply sells on the curve, leaving a thin, MON-heavy (overpriced)
LP. Both symptoms share one lever: the `vm / gradTarget` ratio.

`supplySoldFraction ≈ 1.26 / (r + 1)` where `r = vm / gradTarget`.
- r = 0.275 (now) → 98.8% sold, 1.2% to LP, ~20× DEX gap.
- r = 0.68       → 75% sold, **~25% to LP**, **DEX opens ≈ curve price** (continuous).

## Recommendation

1. **Rebalance** `vm` from `0.275×` to **`~0.68× gradTarget`** (≈176,800 for the
   260k target). Result: ~75/25 curve/LP split, DEX opens at the curve price, and
   early grab roughly halves ($96 → ~3.4%, $192 → ~6.6%).
2. **Add a per-wallet buy cap during bonding** (e.g. **2–3% of supply per wallet**
   until graduation) so no single buyer can snipe a large share regardless of
   curve shape ($500 would otherwise still take ~16% even after rebalancing).

Both require redeploying the curve + factory (~1 MON gas) and re-pointing the app.
**No token has launched yet, so there is zero migration cost — best done now.**
