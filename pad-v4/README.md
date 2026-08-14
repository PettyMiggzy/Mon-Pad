# MonPad V4 — curve-on-Uniswap-V4 pad for Monad

A free-to-launch bonding curve where **the curve *is* a Uniswap V4 position**, with an unbypassable per-swap
fee hook and a permanently locked graduation LP. Native MON, Monad mainnet (chain 143).

Ported from the audited Robin V4 curve suite. This is the **basic pad**: curve + factory + fee hook + locked LP
+ governed fee config. No floor vault, no ambush vault, no staking, no presale, no stock adapters.

## Why this curve instead of the V3 pad's

The live MonPad V3 pad uses a virtual-reserve constant-product curve that graduates by migrating into a
*separate* Uniswap V3 pool. That migration is where `../CURVE-FINDINGS.md` found the DEX opening ~20× above the
curve's final price, fixed by retuning virtual reserves to `9/13 × gradTarget`. That fix is a calibration patch
on a structural problem: two pricing systems stitched together at graduation.

Here there is one pool for the entire life of the token:

- **No graduation discontinuity.** The pool opens at `startTick` holding only token. Buys walk the tick down.
  At `gradTick` the curve is sold out and graduation converts the position in place — it does not migrate to a
  new venue, so the seam cannot reopen.
- **The tax cannot be routed around.** It lives in the V4 hook (`beforeSwap` fee-on-input for buys, `afterSwap`
  on the money leg for sells), so aggregator, DexScreener and raw-pool trades all pay it. The V3 pad's router
  tax leaks on every non-router trade.
- **Free launches.** Single-sided and self-seeded — the creator posts no MON.
- **No dev mint.** The factory enforces `supply == curveSupply + reserveSupply` exactly. The creator receives
  zero tokens at launch and buys from the curve like everyone else.

## Economics (governed defaults, stamped immutable per pad at launch)

| | On a **BUY** (MON→token) | On a **SELL** (token→MON) |
|---|---|---|
| **1% trade tax** (hook) | 0.2% curve buffer → platform at graduation · 0.2% referrer (if a ref link is passed) · rest platform | **100% → creator** |
| **1% LP fee** (pool) | → platform | → platform |

The creator is paid in **MON**, natively. The sell tax is taken from the MON output leg, so there is nothing to
convert — no swapping the creator's own coin into their own pool to pay them.

**Graduation** at the ceiling (~373,000 MON raised): keeper bounty off the top, then platform 20% / creator 15%
/ **LP takes the 65% remainder**, minted as a permanent full-range position and locked in `LockVault` forever.

Geometry — `startTick 87300`, `curveWidth 23000`, `tickSpacing 100`, 1B supply @ 73% curve / 27% reserve:

| | |
|---|---|
| Graduation raise | ~373,000 MON (~$7,830) |
| Start FDV | ~$3,396 |
| Graduation FDV | ~$33,872 |
| Chart | ~10× launch → graduation |
| Platform / creator at graduation | ~$1,566 / ~$1,174 |
| Left in the permanent locked LP | ~$5,088 |

The split is the main lever on launch appeal: every MON taken out at graduation is liquidity the coin does not
have afterwards. 20/15 clears enough for a creator to want to launch while leaving the pool able to absorb sells.
Each bucket is capped at 25% by `MonPadV4FeeConfig`.

Re-derive with `node scripts/calibrate.js` if the target moves; `--verify` checks the formula against the
audited ETH geometry first.

## The leftover reserve is burned

The factory's reserve check sizes `reserveSupply` on the assumption that the **whole** raise seeds the permanent
LP, but the waterfall routes only the LP share (65% after the platform and creator cuts). So the LP mint
structurally cannot consume the reserve it was sized against — **~120M tokens, 12% of supply**, are left on the
curve at graduation.

In the full Robin suite that residue is the holder-staking reward. The basic pad has no staking pool, so it is
**burned to `0x…dEaD`** — permanently out of supply, claimable by nobody including the platform. Shrinking the
reserve instead is not an option: the check is a hard floor whose job is to stop the LP mint bricking, and going
under it means editing audited safety logic.

To route it to holders instead, deploy a staking pool and call `curve.setStaking(pool)` **before** `graduate()`.
That restores the audited behaviour exactly. It is one-shot and the ordering matters.

## MONSHI buy pressure

`contracts/monshi/` turns platform revenue into permanent MONSHI burns, without touching the swap path.

```
platform revenue → PlatformFeeSplitter → 20% → MonshiBuyback → nad.fun DEX → MONSHI → 0x…dEaD
                                       → 80% → treasury
```

MONSHI has **already graduated** off the nad.fun bonding curve and trades in a Uniswap-V3-style WMON/MONSHI pool
(1% fee, tickSpacing 200, factory `0x6B5F…B7F3`), so the DEX router `0x0B79…b137` is the venue — not the bonding
curve. Its `buy` is payable and takes native MON, and its `to` parameter is set to the burn address, so bought
MONSHI is never held by any contract we control.

Measured against the live pool: **1,000 MON moves the price ~2.0%** (1% of which is the pool's own fee) and
2,500 MON ~2.6% — far more absorptive than its ~$6.7k reported TVL suggests. `maxSpendPerCall` defaults to
1,000 MON to keep each buy inside that range.

The buy is **keeper-gated, not permissionless**. It needs a price, and whoever supplies `minOut` decides the
slippage tolerance — a permissionless version lets any caller pass a loose bound and sandwich the trade, and
deriving the bound from live `slot0` is the exact mistake `FLOOR-REDESIGN.md` refuted four times. Since this is
the platform spending its own revenue on its own token, no user funds are at risk and a keeper computing
`minOut` off-chain is both safer and simpler. `maxSpendPerCall` + `cooldown` bound a compromised keeper, and
there is **no withdrawal path** — MON can only ever leave as a MONSHI burn.

## Build & test

```bash
npm install          # postinstall links solmate/forge-std/permit2 for Hardhat
npm run build        # solc 0.8.26, viaIR, runs 1, cancun
npm test             # unit: fee config + curve
npm run test:sim     # production-geometry calibration + graduation (burn, conservation, bounty)
npm run test:all     # everything, including the MONSHI buyback + splitter
```

Fork tests against the live Monad PoolManager need an RPC: `FORK_RPC=<monad rpc> npm run test:fork`.

## Deploy

```bash
MONAD_RPC=<rpc> PRIVATE_KEY=<key> PLATFORM_WALLET=<multisig> \
  npx hardhat run scripts/deploy-curve.js --network monad
```

Then transfer `FeeWalletRegistry` + `MonPadV4FeeConfig` ownership to the platform multisig (both Ownable2Step),
verify on monadscan, and point the app/indexer at `contracts.curveFactory`.

## Uniswap V4 on Monad (chain 143)

Each verified to carry code on `rpc.monad.xyz`:

```
POOL_MANAGER      0x188d586ddcf52439676ca21a244753fa19f9ea8e
POSITION_MANAGER  0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016
STATE_VIEW        0x77395f3b2e73ae90843717371294fa97cc419d64
QUOTER            0xa222dd357a9076d1091ed6aa2e16c9742dd26891
UNIVERSAL_ROUTER  0x0d97dc33264bfc1c226207428a79b26757fb9dc3
PERMIT2           0x000000000022D473030F116dDEE9F6B43aC78BA3
CREATE2           0x4e59b44847b379578588920cA78FbF26c0B4956C
WMON              0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
```

Native MON sentinel = `address(0)`, always sorts as `currency0`. Monad supports EIP-1559, so deploys are
ordinary type-2 txs — unlike Robinhood Chain, do **not** force legacy type-0.

## Provenance

`PORT-NOTES.md` maps every file to its source in the Robin suite and lists every intentional change. The first
commit on this directory is a verbatim copy of the audited contracts, so the port is a reviewable diff rather
than a rewrite.

**Carried-over risk:** the Robin suite's audit register closed at zero findings *except* H-5, an unresolved
weakness in `RobinFloorVault`'s spot-based commit gate. That contract is not ported here, so H-5 does not apply
to this pad. It becomes live again the moment a floor vault is added.
