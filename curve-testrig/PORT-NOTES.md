# Port notes — code provenance for curve-testrig

> **Scope note.** `curve-testrig` is a standalone research rig, not a launchpad and not anyone's production
> pad. This document records where its contracts came from so a reviewer can diff them against known-audited
> source and confirm that measured behaviour is not an artifact of rewritten code. It is a code-lineage
> record, nothing more — the rig does not depend on, integrate with, or share governance, liquidity or
> branding with the source project.

This directory is a port, not a rewrite. Commit 1 on it is a **verbatim copy** of the audited Robin contracts
with zero edits, so everything below is a reviewable diff against known-audited source rather than a claim to
be taken on trust.

Source: `PettyMiggzy/sherif` → `pad-v4/` (read-only reference; not modified by this work). Ported here as
`Mon-Pad/curve-testrig/`.

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

100 MON (≈$2.10) against a ~0.5 MON worst case, still only ~0.03% of a 373k raise. Asserted in
`test/sim/curve.graduation.sim.test.js`.

### 2. Unsold reserve → the pad's staking pool, wired by the factory at launch

The audited path transfers the leftover to a staking pool, or returns early and parks it on the curve when
`staking == address(0)` for a later `flushStaking()`. Parking means "stranded forever" if nothing is ever wired,
so two changes: the factory now deploys a `MonPadLockStaking` pool per pad and wires it inside `launch()`, and
an unreachable burn fallback catches any curve deployed outside the factory.

Wiring at launch also closes **[M-11]** from the audited suite. `setStaking` is one-shot and had to be called by
hand *before* `graduate()` — but graduation is permissionless and keeper-driven here, so a pad wired late could
graduate first and permanently register its locked-LP fee recipient as `address(0)`, needing a separate one-shot
repair on `LockVault`. Doing it in the launch transaction removes the ordering hazard rather than documenting it.

`MonPadCurveV4.setStaking` accordingly accepts the **factory** as well as the platform fee wallet. That widening
is safe: the call is still one-shot, still requires a contract, and still requires the pool's stake asset to
equal the pad's token ([M-25]'s `token()`/`tokenAsset()` probe), so neither caller can point a curve at a
foreign sink. New: `contracts/pads/MonPadLockStaking.sol` (ported) and `contracts/core/StakingDeployer.sol`
(creationCode offload, mirroring `CurveV4Deployer`).

This is not dust. The factory's `[HIGH-2]` check sizes `reserveSupply` as if the whole raise seeds the LP, but
the waterfall routes only the LP share, so the mint cannot consume the reserve it was sized against —
**~120M tokens, 12% of supply** at the shipped 20%/15% graduation split, measured in the graduation sim and
predicted independently by `scripts/calibrate.js`. (It scales with the split: the more MON the platform and
creator take at graduation, the less the LP can pair, so the more is left over — 8.5% at 10%/10%, 12% at
20%/15%.)

Shrinking the reserve is not an alternative: `[HIGH-2]` is a hard floor whose purpose is to stop the LP mint
bricking with `InsufficientReserve`. Going under it means editing audited safety logic on the path that holds
the money. So the leftover is put to work instead of minimised.

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

`startTickMag 201600 → 87300`. `curveWidth` unchanged at 23000. Graduation split `10%/10% → 20%/15%`.

Robin's geometry is calibrated against a ~$3,000 quote asset. MON is ~$0.021, so ported verbatim the pad would
have raised ~4 MON (≈$0.09). Recalibrated to a **~$34k graduation FDV** (~373,000 MON at $0.021/MON), matching the
audited suite's USD targets rather than its ETH numbers.

Derived from the closed form for a single-sided currency1 range bought from its upper bound to its lower bound:

```
raise = curveSupply / (√P_start · √P_grad) = curveSupply / 1.0001^((startTick + gradTick) / 2)
```

`curveWidth` alone fixes the launch→graduation multiple; the midpoint alone fixes the raise. The two are
independent, so this solves directly rather than by search. The formula reproduces the audited ETH geometry's
measured ~4.1 ETH raise from START 201600 / WIDTH 23000 (`node scripts/calibrate.js --verify`), which is what
validates it before it is trusted on new numbers.

Measured on-chain against a real V4 PoolManager in `test/sim/curve.calibration.sim.test.js`: **376,617 MON**,
10.0× chart, start FDV $3,396, graduation FDV $33,872.

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

### 6. Auto-graduation kept; no "let it ride"

The Labs V3 pad (`Robinlabz/Labs` → `launchpad/CurvePool.sol`) lets the dev pick where to graduate between
`minGradTick` and the ceiling via `setGradTarget`, with a 7-day `GRAD_TIMEOUT` so an abandoned pad can still be
graduated at the minimum. That was deliberately dropped: this pad graduates at the fixed ceiling only, and
`graduate()` is permissionless from the moment `ready()` flips.

`minGradWidth` survives in `MonPadV4FeeConfig` (validated `0 < minGradWidth < curveWidth`) but is never read by
`MonPadCurveV4`. It is inert on purpose. Left in place rather than removed because deleting a field from the
stamped config struct changes its ABI and the per-pad immutable layout for no functional gain.

`scripts/auto-graduate.cjs` is ported with two Monad changes: type-2 txs instead of forced legacy type-0, and
`CHUNK` defaulted to 100 because Monad's public RPC caps `eth_getLogs` at a 100-block range (`-32614`) — the
original's 5000 would have failed every pass. Its header comment claiming the keeper gets "no reimbursement"
was also stale: the curve pays the bounty to `msg.sender`.

### 7. MONSHI buy pressure — new, additive, touches nothing audited

`contracts/monshi/MonshiBuyback.sol` + `PlatformFeeSplitter.sol`. Neither is in the money path of the curve,
hook or factory: the splitter is simply installed as `FeeWalletRegistry.platformFeeWallet`, so it sees only
platform revenue that had already been paid out. No audited contract changed to support this.

Two facts that shaped the design, both verified live rather than assumed:

- **MONSHI has graduated off the nad.fun bonding curve.** It trades in a Uniswap-V3-style WMON/MONSHI pool
  (`fee()` 10000, `tickSpacing()` 200, `factory()` = nad.fun's `0x6B5F…B7F3`). So the DEX router is the venue,
  not the bonding-curve router. The router's `buy` is payable, takes native MON, and accepts an arbitrary `to` —
  simulated live at 1 MON → 1,870 MONSHI delivered to `0x…dEaD`.
- **The pool absorbs far more than its reported TVL suggests.** DexScreener shows ~$6.7k liquidity and ~$3/day
  volume, which reads as unusably thin. Simulated against the live pool, a 1,000 MON buy moves the price only
  ~2.0% and 2,500 MON ~2.6%. `maxSpendPerCall` is set to 1,000 MON on that basis.

Also worth recording: `docs/REFERENCES/nad-fun-v2-api.md` lists a `V2_NAD_FUN_ROUTER` at
`0x75588668999cA0557b78046b8a5E86b47b9234ec`. **That address has no code on Monad mainnet.** Use the V3
`DEX_ROUTER` `0x0B79…b137`.

## Verified against live Monad

`test/fork/CurveGraduation.fork.test.js` runs the whole flow against Monad's real V4 stack — PoolManager
`0x188d58…ea8e`, PositionManager `0x5b7e…4016`, Permit2, and the canonical StateView `0x7739…9d64`:

launch (hook salt mined, flags `0x00CC` self-asserted, no dev mint) → buy the curve out past the ceiling with
native MON → hostile MON donation → `graduate()`. Asserts the ceiling nudge lands spot exactly on `gradTick`,
the permanent LP mints through the **real** PositionManager and lands in `LockVault`, the leftover reserve is
burned, `floorEthOwed`/`ambushEthOwed` are both zero, and the platform + creator books pay out.

```
FORK_RPC=https://rpc.monad.xyz FORK_CHAINID=143 npm run test:fork
→ 1 passing (21s)
```

This was the one leg the local suite could not cover: the local tests spin up their own PoolManager, which
proves the hook and curve logic but not the real PositionManager + Permit2 mint path.

## Not yet done

- **Re-derive the MEV assumptions.** Monad has ~400ms blocks and no global mempool (transactions are forwarded
  to the next few leaders). The Robin suite's sandwich analysis assumes Ethereum-style mempool dynamics. Nothing
  in the *basic* pad is known to depend on it — the add-only vaults where it mattered are the parts not ported —
  but it should be re-derived before a floor vault is ever added here.
- **A live buyback.** `MonshiBuyback` is unit-tested against a mock router that reproduces the live contract's
  observed behaviour (payable `buy`, `InvalidAmountOut()` on a zero bound, `InsufficientOutput()` on an
  unmeetable one). The real call has been simulated via `eth_call` but never sent.
- **Optimizer runs.** Monad's contract size limit is 128 KB vs Ethereum's 24 KB, so `runs: 1` is no longer
  forced by size pressure and could be raised to cut per-swap gas. Left at 1 so deployed bytecode matches what
  was audited.
