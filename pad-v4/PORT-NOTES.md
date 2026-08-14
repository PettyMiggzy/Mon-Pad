# Port notes — Robin V4 curve suite → MonPad V4 (Monad, chain 143)

This directory is a port, not a rewrite. Commit 1 on `pad-v4/` is a **verbatim copy** of the audited Robin
contracts with zero edits, so everything below is a reviewable diff against known-audited source rather than a
claim to be taken on trust.

Source: `PettyMiggzy/sherif` → `pad-v4/` (read-only reference; not modified by this work).

## What was ported, and what was left behind

| Ported | Left behind (basic pad) |
|---|---|
| `RobinCurveV4` → `MonPadCurveV4` | `RobinFloorVault` |
| `CurvePadFactoryV4` → `MonPadFactoryV4` | `RobinAmbushVault` |
| `RobinFeeHook` → `MonPadFeeHook` | `RobinLockStaking` / `DualStaking` / `StakingFactory` |
| `RobinV4FeeConfig` → `MonPadV4FeeConfig` | `PresaleVault` / `PresaleVaultFactory` |
| `PadToken`, `LockVault`, `FeeWalletRegistry`, `BaseHook` | `StockQuoteAdapter` / `EthQuoteAdapter` / stock pads |
| `CurveV4Deployer`, `DeterministicDeployer` | `RobinLpVault` |
| `RobinStateView` → `MonPadStateView` *(local tests only — not deployed)* | |

Dropping the floor vault also drops **H-5**, the one finding still open in the Robin audit register (four
refuted redesigns deep, blocked on external review). It is not a weakness this pad inherits — but it returns in
full the moment a floor vault is added.

## Intentional changes

Everything else is identical to the audited source.

### 1. Keeper bounty re-denominated — `MonPadCurveV4.GRAD_BOUNTY_MAX_WEI`

`0.02 ether` → `100 ether`.

The cap is denominated in the quote asset, so it does not survive a chain change. Robin capped at 0.02 ETH
against a ~4 ETH raise. Ported verbatim that is 0.02 MON ≈ $0.0004 — while **Monad charges gas on the
transaction's gas limit, not gas used**, so a keeper submitting `graduate()` with a 5M limit at the observed
~100 gwei base fee pays ~0.5 MON. The bounty would have been ~25× *smaller* than the cost of claiming it, so no
rational keeper would ever call `graduate()` and every pad would stall at the ceiling awaiting a manual
platform graduation.

100 MON (≈$2.10) against a ~0.5 MON worst case, still only ~0.04% of a 260k raise. Asserted in
`test/sim/curve.graduation.sim.test.js`.

### 2. Leftover reserve burned when no staking sink — `MonPadCurveV4._fundStaking`

The audited path transfers the leftover to the staking pool, or returns early and parks it on the curve when
`staking == address(0)`, for a later `flushStaking()`. The basic pad never wires one, so "parks" means
"stranded forever". It now transfers to `0x…dEaD` and emits `ReserveBurned`.

This is not dust. The factory's `[HIGH-2]` check sizes `reserveSupply` as if the whole raise seeds the LP, but
the waterfall routes only the LP share, so the mint cannot consume the reserve it was sized against —
**~85M tokens, 8.5% of supply**, measured in the graduation sim and predicted independently by
`scripts/calibrate.js`.

Shrinking the reserve is not an alternative: `[HIGH-2]` is a hard floor whose purpose is to stop the LP mint
bricking with `InsufficientReserve`. Going under it means editing audited safety logic on the path that holds
the money.

Wiring `curve.setStaking(pool)` before `graduate()` restores the audited behaviour exactly and skips the burn.

### 3. Floor / ambush shares zeroed — deploy config, not code

`sellFloorShareBps`, `buyLpFloorShareBps`, `ambushGradBps` → `0`.

Not deploying the vaults is *not* sufficient. Graduation step 9 reserves the books out of the platform sweep:

```solidity
platformEthOwed = address(this).balance - floorEthOwed - creatorEthOwed - ambushEthOwed - bounty;
```

Leave the shares non-zero with no vault wired and that MON accrues into books only `flushFloor()` /
`flushAmbush()` can release — and both revert on `address(0)`. Recoverable by wiring a vault later, but silently
accruing until someone notices. Asserted zero after graduation in the sim.

With the floor gone the sell tax has no carve, so the **full 1% goes to the creator** (was 0.8% creator /
0.2% floor).

### 4. Geometry recalibrated for MON

`startTickMag 201600 → 90900`. `curveWidth` unchanged at 23000.

Robin's geometry is calibrated against a ~$3,000 quote asset. MON is ~$0.021, so ported verbatim the pad would
have raised ~4 MON (≈$0.09). Recalibrated to a **260,000 MON** graduation — deliberately the same line as the
live MonPad V3 pad, so the V4 pad is the same product with a better curve rather than a differently-priced one.

Derived from the closed form for a single-sided currency1 range bought from its upper bound to its lower bound:

```
raise = curveSupply / (√P_start · √P_grad) = curveSupply / 1.0001^((startTick + gradTick) / 2)
```

`curveWidth` alone fixes the launch→graduation multiple; the midpoint alone fixes the raise. The two are
independent, so this solves directly rather than by search. The formula reproduces the audited ETH geometry's
measured ~4.1 ETH raise from START 201600 / WIDTH 23000 (`node scripts/calibrate.js --verify`), which is what
validates it before it is trusted on new numbers.

Measured on-chain against a real V4 PoolManager in `test/sim/curve.calibration.sim.test.js`: **262,762 MON**,
10.0× chart, start FDV $2,370, graduation FDV $23,632.

### 5. Toolchain and chain plumbing

- **StateView is not deployed.** Monad has the canonical Uniswap one at `0x7739…9d64`; Robinhood Chain had none
  paired with its PoolManager. `MonPadStateView.sol` is retained only so the local Hardhat suite has one to bind
  to against its own PoolManager.
- **Type-2 txs.** Monad supports EIP-1559. The Robin deploy scripts force `{ type: 0 }` with an explicit
  `gasPrice` because Robinhood Chain has no EIP-1559; that is removed.
- **CREATE2.** The canonical deployer `0x4e59…4956C` exists on Monad (verified on-chain), so the
  address-mining constraint that motivated `DeterministicDeployer` is gone. The contract is retained because the
  factory calls it during launch and needs a known-ABI Solidity interface.
- **Compiler unchanged** — solc 0.8.26, viaIR, optimizer runs 1, evmVersion cancun. Monad supports every
  Ethereum opcode including EIP-1153 transient storage, which the live V4 PoolManager already depends on.

## Not yet done

- **Fork test against the live Monad PoolManager.** Everything here runs against a locally-deployed V4
  PoolManager (identical source), which is what the Robin suite's A3 gate established as sufficient for the
  skim idiom. A fork run against `0x188d58…` still needs an RPC before mainnet.
- **Re-derive the MEV assumptions.** Monad has ~400ms blocks and no global mempool (transactions are forwarded
  to the next few leaders). The Robin suite's sandwich analysis assumes Ethereum-style mempool dynamics. Nothing
  in the *basic* pad is known to depend on it — the add-only vaults where it mattered are the parts not ported —
  but it should be re-derived before a floor vault is ever added here.
- **Optimizer runs.** Monad's contract size limit is 128 KB vs Ethereum's 24 KB, so `runs: 1` is no longer
  forced by size pressure and could be raised to cut per-swap gas. Left at 1 so deployed bytecode matches what
  was audited.
