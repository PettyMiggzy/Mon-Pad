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
