# Brief — what curve geometry actually controls

Research conducted against live contracts and live chain data, August 2026. Working log with full numbers:
`RESEARCH-sniper-economics.md`. Reproducible sims: `test/sim/snipers.sim.test.js`,
`geometry.sweep.sim.test.js`, `devbuy.sweep.sim.test.js`.

## The question

How should a launchpad handle snipers and bots — repel them, attract them, or tax them?

## What was measured

Three sources, in order of authority:

1. **Agent sims against the real `MonPadCurveV4` + `MonPadFeeHook`** on a live-local V4 PoolManager at
   production geometry. Not a model of the curve — the curve.
2. **On-chain history of BRACKETS** (Robinhood Chain), a launch bots pumped, at minute resolution.
3. **The launch distribution across 120 Robinhood Chain pools**, the most active chain available.

## Findings

**1. Sniping is highly profitable and no fee stops it.**
Three snipers putting in 15,000 MON take 8.4% of supply, retail pays 1.54x their cost basis, and they realise
+87% ROI. Slippage both ways plus 1% buy tax, 1% sell tax and 1% LP fee per leg does not price them out.

A decaying sell tax was the obvious fix. Real data killed it. BRACKETS went **22.3x in three minutes** and
round-tripped inside 60 seconds; break-even sell tax against a 22x flip is **95.5%**, and a rate that high
stops every legitimate seller too. The whole event lasted four minutes, so an hour-long decay had the wrong
time constant by more than tenfold.

**2. Real launches run 45x–4,666x. Our curve caps at 10x.**
Sampling every Robinhood memecoin launch with meaningful volume: median peak multiple ~45–90x, top of sample
4,666x, median drawdown from peak −44% with a fat tail at −95% to −100%. Where measurable, 31–60% of lifetime
volume lands in the first hour.

`curveWidth = 23000` caps our curve at 9.97x before graduation. That is one to two orders of magnitude below
where the observed winners live.

**3. Width is the only dial.**
Holding the raise fixed at ~373,000 MON and sweeping `curveWidth` — nothing else — moves opening FDV from
$3,396 down to $2, graduation FDV from $33,872 up to $60M, and the price response to a fixed 65,000 MON of
flow from 1.87x to 897,272x. No fee, tax, gate or bot incentive touches any of it.

**4. Chart size and extraction are the same number.**
Across every geometry tested they move together, exactly. A steep curve means early tokens are cheap relative
to later ones — which *is* the chart and *is* the first buyer's edge. They are one phenomenon measured two
ways, not two effects to be balanced.

**5. Real gains cap at ~77x, because the bound is the raise, not the chart.**
A $100 first buy, curve fills to graduation, dev exits:

```
  width  dev supply   PAPER x     PAPER $   REAL x    REAL $   % of raise
  23000       2.81%      9.5x        $952    8.62x      $862       11.0%
  46000       8.19%     87.6x      $8,765   43.01x    $4,301       54.9%
  57500      13.34%    254.8x     $25,481   62.05x    $6,205       79.2%
 115000      58.35%  19658.4x  $1,965,877   77.45x    $7,745       98.9%
```

Widening from 46000 to 115000 multiplies the **paper** return 224x and the **real** return by less than two.
The dev's exit is bounded by the MON that entered the curve. Total raise $7,833; at width 115000 the dev
realises **$7,745 of it — 98.9%**.

**6. Past a certain width the geometry alone is a rug.**
No malicious code, no hidden mint, no privileged function. Just a curve steep enough that the first buyer owns
the supply everyone else then pays for. At width 115000 the chart reads $1.97M and $7,745 comes out — the dev
holds 58% of supply, so their own exit *is* the dump.

## What a $100 first buy takes, by width

| width | max multiple | dev takes of the raise |
|---:|---:|---:|
| **23000 (current)** | 10x | **11.0%** |
| 34500 | 31x | 28.1% |
| 46000 | 99x | 54.9% |
| 57500 | 314x | 79.2% |
| 86000 | 5,429x | 97.5% |
| 115000 | 98,659x | 98.9% |

## The conclusion

**You cannot build a pad that produces big charts and also protects the people who buy them. It is one dial.**

Every mechanism proposed before this research — decaying sell taxes, hold gates, staking gates, bot rebates,
maker incentives — attacks a symptom. None of them move the number that matters.

The decision is therefore not technical. It is a choice about what the product is:

- **Width 23000** — 10x charts, first buyer takes 11% of the raise. Nobody gets rich, nobody gets destroyed.
- **Width 46000+** — 99x+ charts in the range that actually attracts bots and volume, first buyer takes 55%+.

Both are legitimate products. They are not the same product, and no amount of mechanism design converts one
into the other.

## Two corrections this research forced

Recorded because both were stated confidently before being measured:

- A decaying sell tax starting at 30% was proposed as the fix. Break-even is 47% against our own sim and
  ~95% against a real launch. It would have shipped as a fix while changing nothing.
- Width 46000 was recommended on the grounds that one opening buy takes only 8.6% of supply. Supply share
  understates it — the first buyer's tokens are the cheapest in the distribution, so 8.19% of supply is 54.9%
  of the money.
