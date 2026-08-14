# Research — sniper economics, measured

Two sources: an agent sim against MonPad's own contracts, and the on-chain history of a real launch that
bots pumped. They disagree, and the real launch wins.

## 1. Sim against our own curve

`test/sim/snipers.sim.test.js`, production geometry, real `MonPadCurveV4` + `MonPadFeeHook`:

```
3 snipers x 5,000 MON in the opening block  ->  8.4% of supply
10 retail x 8,000 MON follow
snipers dump everything

retail pays        1.54x the sniper cost basis
dump moves price  -20.2%
sniper P&L        +13,092 MON   ROI +87.3%
```

Re-pricing that exit across sell-tax levels gives a **break-even of 47.1%** — a 30% opening sell tax still
leaves +32.4% ROI. So a decaying sell tax would need to start near 50%, not 30%.

That was the conclusion. It does not survive contact with a real launch.

## 2. BRACKETS on Robinhood Chain — what actually happened

Token `0x5E453647539D4DD766D7C4c3D6CE589900D39415`, Uniswap **V3** pool
`0x5c5c7264AeE5bE47FC2ec4Ac2b5Db475e8ae5342`, launched 2026-08-04 06:16 UTC. Minute candles:

```
06:16   open   $10,367 FDV                       vol  $8,399    <- launch
06:19   high  $231,419  close $132,923           vol $22,542    <- 22.3x in THREE MINUTES
06:20   high  $152,976  close  $58,421           vol  $8,480    <- round-trip, same minute
06:21          $59,383  ...                                     <- settles, stays there
```

- **22.3x in 3 minutes.** Peak FDV $231,419 from a $10,367 open.
- **Round-tripped inside 60 seconds** of the peak. Only **2 minutes** in the token's entire life closed above
  10x the open.
- ~$40k of volume in the first four minutes — **45% of the token's lifetime volume ($89k)** — then it settled
  at ~$58k and ground sideways for ten days.
- Current state: 1,082 buys vs 196 sells in 24h on $7.9k volume, i.e. ~$7 average trade. Dust.

## 3. What this does to the sell-tax theory

**It kills it.** A sniper who caught that move made 22x gross. Break-even sell tax against a 22x flip is
**95.5%**. Even a realistic exit into the 06:19–06:20 window is ~13x, needing ~92%. No tax anyone would ship
stops this, and a tax high enough to stop it would also stop every legitimate seller.

The sim said 47% because it modeled a **2.4x** move. Reality was **22x** — an order of magnitude more violent.
The sim's mechanics were right and its scenario was far too gentle.

Second error: the whole event lasted **four minutes**. A tax decaying over an hour is the wrong time constant
by more than a factor of ten.

## 4. The finding that actually matters

MonPad's curve **structurally cannot do what BRACKETS did**, and that is a geometry decision, not a tax one.

- `curveWidth = 23000` ticks ⇒ `1.0001^23000` ≈ **9.97x maximum**, launch to graduation. Then it graduates.
- The sim measured 15,000 MON moving our curve **1.18x**. BRACKETS moved **22.3x** on ~$22.5k of buying.
- $22,542 at $0.021/MON is ~1.07M MON — **2.9x our entire 373k MON graduation raise**. The same money that
  22x'd BRACKETS would blow straight through our curve to graduation and stop at 10x.

So the two designs answer a different question:

| | BRACKETS (thin V3 pool) | MonPad (deep curve) |
|---|---|---|
| Max move | unbounded | ~10x, then graduates |
| $22.5k of buying | 22.3x | graduates at 10x |
| After the pump | -75% in 60 seconds | permanent locked LP |
| Lifetime volume | 45% in 4 minutes | — |

Our curve is roughly three times deeper than the entire BRACKETS pump. That is exactly why retail cannot get
destroyed on it — and exactly why it cannot produce the 22x chart bots show up for.

## 5. Open question

The 22x-in-3-minutes chart is the product. It is what gets screenshotted, what pulls the next bot, and what
the user meant by "bots pushed it to 240k."

If MonPad wants that, the lever is **geometry, not fees**: a steeper opening (narrower `curveWidth`, lower
`startTick`) or a higher graduation ceiling. Both trade retail protection for chart violence, and that is a
product decision, not a technical one.

What is now settled is that **no sell tax gets you there or protects against it.** Both of the designs
proposed before this research — decaying sell tax, and its 30%/47% calibration — should be dropped.

---

# 6. Geometry sweep — the actual dial

`test/sim/geometry.sweep.sim.test.js`. Every row raises the **same ~373,000 MON**; only the curve's *shape*
changes. One sniper opens with 5,000 MON, 60,000 MON of retail follows, then the sniper dumps.

```
 width    curve    open FDV    grad FDV   snipe→  +retail→   sniper  supply
          max x                                x         x      ROI       %
 11500   FAILED — reserve check (narrow curves need more reserve than 27% supply)
 23000    10.0x      $3,396     $33,872    1.06x     1.87x     +69%    2.9%
 34500    31.5x      $1,921     $60,496    1.12x     3.18x    +162%    5.1%
 46000    99.5x      $1,075    $106,969    1.25x     6.42x    +336%    8.6%
 57500   314.1x        $608    $191,046    1.49x    14.77x    +592%   13.9%
```

## What it shows

**Width is the chart dial, and it is the only one.** Widening the curve at a fixed raise lowers the opening
FDV, raises the graduation FDV, and multiplies how far a given amount of buying moves the price. The same
65,000 MON of flow produces **1.87x** at width 23000 and **14.77x** at width 57500.

Width 46000–57500 reproduces BRACKETS-shaped charts — $608–$1,075 opening FDV, 6–15x on modest flow,
graduating at $107k–$191k against BRACKETS' $231k peak — while still keeping a graduation ceiling and a
permanent locked LP, which BRACKETS never had.

## The finding

**Chart violence and sniper extraction are the same number.** They move together, exactly, across every row:

| | 23000 | 57500 |
|---|---|---|
| retail-flow multiple | 1.87x | **14.77x** |
| sniper ROI | +69% | **+592%** |
| sniper supply capture | 2.9% | **13.9%** |

There is no geometry that produces a big chart and a small sniper profit, because they are one phenomenon
measured two ways: a steep curve means early tokens are cheap relative to later ones, which *is* the chart and
*is* the sniper's edge. Every mechanism proposed earlier — decaying sell tax, hold gates, staking gates —
attacks the symptom. The dial is `curveWidth`.

Narrow curves are also not freely available: width 11500 fails the factory's reserve check outright, because
`reserveSupply ≥ curveSupply · √(grad/start) · 1.05` demands ~431M tokens against the 270M a 73/27 split
provides. Low-multiple curves need a bigger reserve.

---

# 7. What launches on Robinhood Chain actually do

BRACKETS was n=1. Sampling 120 Robinhood pools via GeckoTerminal and taking every memecoin launch with
meaningful volume gives the distribution. Peak/open is a pure ratio, so it is valid regardless of token
supply (unlike the FDV figures, which assume 1B and are wrong for several of these).

| token | peak multiple | time to peak | drawdown from peak | h1 share of lifetime vol |
|---|---:|---:|---:|---:|
| HOOPLA | **4,666x** | 11h | −100% | — |
| COCO | **1,659x** | 884h | −69% | — |
| LEMON.FUN | **896x** | 489h | −10% | — |
| $ROBBIE | **92x** | 10h | −64% | 39% |
| djt / WETH | **61x** | <1h | −98% | 8% |
| CASHCAT (1%) | **55x** | 183h | −43% | — |
| WW | **50x** | 2h | −98% | 36% |
| CASHCAT (0.3%) | **45x** | 242h | −44% | — |
| djt / DJT | 20x | <1h | −95% | 60% |
| DJT / USDG | 9x | <1h | −91% | 31% |
| BRACKETS | 22x | 3 min | −75% | 45% |
| STONKBROKER | 3.8x | 301h | −24% | — |

Excludes stock and stablecoin pairs (NVDA, SPCX, USDG/WETH) and CASHCAT's duplicate fee-tier pools.

## The distribution

- **Median peak multiple ≈ 45–90x.** The top of the sample is 4,666x.
- **Median drawdown from peak ≈ −44%**, with a fat tail at −95% to −100%. Most of these die.
- **Time to peak is bimodal**: minutes-to-hours (BRACKETS 3 min, djt <1h, WW 2h, $ROBBIE 10h) or weeks
  (COCO 884h, LEMON.FUN 489h, CASHCAT 183–242h). Very little in between.
- Where first-hour volume is measurable it is **31–60% of lifetime volume**.

## What this means for geometry

MonPad's curve caps at **9.97x** and then graduates. The launches that actually work on the most active chain
available run **45x to 4,666x**.

That is not a tuning gap, it is one to two orders of magnitude. From the width sweep in §6:

| target | width | max multiple |
|---|---:|---:|
| current | 23000 | 10x |
| median Robinhood launch | **~46000** | **99x** |
| upper quartile | ~57500 | 314x |

A `curveWidth` near **46000** is what puts a pad in the range where the observed winners live. Nothing about
fees, taxes, gates or bot incentives moves this number — it is set entirely by the tick span of the curve.

The other half of the distribution is equally clear and should not be papered over: the median launch gives
back 44% from its peak and a large minority go to −95% or worse. The multiples and the carnage are the same
distribution. A design that produces one produces the other.
