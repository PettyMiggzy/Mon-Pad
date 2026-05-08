# 🚀 MonPad V2.1 — Remix Deploy Guide

Deploy 4 contracts to Monad mainnet via Remix in roughly 25 minutes.

This guide replaces the V2 version. It reflects every audit fix in commits
`72d85b8 → f299445` on `main`. If a step disagrees with audit notes, the audit wins.

---

## ⚠️ DO NOT USE THIS WALLET

`0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd` — old treasury, **keys are lost**
(see `DEPLOY-V2.md`). Never enter it as `_treasury`, `_buyback`, or anywhere else.
The `node deploy.js` script refuses to run if any wallet matches this address.

---

## ⚙️ ONE-TIME SETUP (in Remix)

1. Open https://remix.ethereum.org
2. **Solidity Compiler** (left sidebar):
   - Compiler: `0.8.24`
   - EVM Version: **`paris`** ← critical (Monad doesn't support PUSH0 reliably yet)
   - **Enable optimization**: ✅ `200` runs
   - **Advanced configurations** → enable **`viaIR`** ✅
3. **Deploy tab:**
   - Environment: **Injected Provider — MetaMask**
   - MetaMask is on **Monad Mainnet** (chain ID 143, RPC `https://rpc.monad.xyz`)

---

## 📁 UPLOAD CONTRACTS

In Remix file explorer, create a folder `MonPad/` and upload **the entire `contracts/v2/`
directory** from the repo. Remix resolves the cross-file imports automatically.

You should end up with:

```
MonPad/MonPadCurveV2.sol         ← deployed automatically by factory; don't deploy manually
MonPad/MonPadFactoryV2.sol       ← step ①
MonPad/MonPadGraduator.sol       ← step ② (NEW in V2.1)
MonPad/MonPadPoolFactory.sol     ← step ④
MonPad/MonPadStakingHub.sol      ← step ③
MonPad/MonPadStakingPool.sol     ← deployed by PoolFactory; don't deploy manually
MonPad/MonPadSwap.sol            ← skip if not deploying swap this round
MonPad/MonPadTokenV2.sol         ← deployed by factory; don't deploy manually
MonPad/MonPadVesting.sol         ← skip — non-binding (audit V2.1-8)
```

---

## 🔥 DEPLOY ORDER

### ⚠ Have these addresses ready BEFORE you start

| Slot | Address | Notes |
|------|---------|-------|
| `_platform` | **`0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16`** | existing platform wallet |
| `_treasury` | **YOUR confirmed treasury** | NOT `0x5dD4...FFfd`; you have the keys |
| `_buyback`  | **YOUR confirmed buyback** | can equal treasury if you want |
| `_monshi`   | **`0xB744F5CDb792d8187640214C4A1c9aCE29af7777`** | MONSHI token |
| `_npm`      | **Monad Uniswap V3 NonfungiblePositionManager** | confirm on Monadscan |
| `_wmon`     | **`0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`** | wrapped MON |

If any wallet is "I think I have the keys" → STOP. Send 0.1 MON from each one to
confirm access first.

---

### ① **MonPadFactoryV2**

- Compile `MonPadFactoryV2.sol`
- Constructor:
  ```
  _platform: <PLATFORM>
  _treasury: <TREASURY>
  _buyback:  <BUYBACK>
  ```
- Deploy → ✅ save as `FACTORY`

### ② **MonPadGraduator** (NEW — replaces V2's hardcoded LP step)

- Compile `MonPadGraduator.sol`
- Constructor:
  ```
  _factory: <FACTORY>
  _npm:     <Monad NPM address>
  _wmon:    0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
  ```
- Deploy → ✅ save as `GRADUATOR`

### ③ **MonPadStakingHub**

- Compile `MonPadStakingHub.sol`
- Constructor:
  ```
  _factory:              <FACTORY>
  _distributeInterval:   3600                       (1 hour, in seconds)
  _minDistributeBalance: 500000000000000000         (0.5 ether in wei)
  ```
- Deploy → ✅ save as `HUB`

### ④ **MonPadPoolFactory**

- Compile `MonPadPoolFactory.sol`
- Constructor:
  ```
  _hub:     <HUB>
  _factory: <FACTORY>
  _monshi:  0xB744F5CDb792d8187640214C4A1c9aCE29af7777
  ```
- Deploy → ✅ save as `POOL_FACTORY`

> Note: V2.1 dropped the `_buyback` constructor arg. PoolFactory now reads
> `factory.buybackWallet()` live every time it forwards a fee.

---

### ⑤ **WIRING (4 transactions on existing contracts)**

#### 5a) Bootstrap the factory (one-shot — skips 24h timelock)

In Remix's deployed contracts list, expand **FACTORY**:
- Find **`bootstrapInit(address,address,address)`**
- Arguments:
  ```
  _graduator:    <GRADUATOR>
  _rewardRouter: <HUB>
  _poolFactory:  <POOL_FACTORY>
  ```
- Click → confirm

This single tx sets `factory.graduator`, `factory.rewardRouter`, and
`factory.poolFactory` atomically. After this, all three are governed by the
24h timelock for any future change.

#### 5b) Bootstrap the hub's MONSHI binding (one-shot — skips 24h timelock)

Expand **HUB**:
- Find **`bootstrapMonshi(address)`**
- Argument: `0xB744F5CDb792d8187640214C4A1c9aCE29af7777`
- Click → confirm

After this, `monshiToken` on the hub is locked permanently. Re-setting requires
a Hub redeploy.

#### 5c) Create the MONSHI staking pool

Expand **POOL_FACTORY**:
- Find **`adminCreatePool(address,address,bool)`**
- Arguments:
  ```
  token:           0xB744F5CDb792d8187640214C4A1c9aCE29af7777
  creator:         <BUYBACK>      ← NOT the deployer; routes burn vault correctly
  burnsToCreator:  true
  ```
- Click → confirm
- 📋 In the tx receipt, find the **`PoolCreated`** event → copy the **`pool`** address
- ✅ Save as `MONSHI_POOL`

#### 5d) Queue MONSHI pool address on the factory (24h timelock)

Expand **FACTORY**:
- Find **`queueSetMonshiStakingPool(address)`**
- Argument: `<MONSHI_POOL>`
- Click → confirm
- ⏰ **Wait 24 hours**, then come back and run
  **`executeSetMonshiStakingPool(address)`** with the same argument.

The 24h delay is the standard timelock on every non-emergency factory setter.
The staking system functions while you wait — `factory.monshiStakingPool()` just
returns `address(0)` until the execute lands. UI/off-chain readers should treat
that as "not yet set".

---

## 🎉 DONE. Send these 5 addresses to ops:

```
FACTORY      = 0x...
GRADUATOR    = 0x...
HUB          = 0x...
POOL_FACTORY = 0x...
MONSHI_POOL  = 0x...
```

These wire into Vercel as:

```
NEXT_PUBLIC_FACTORY_V2      = <FACTORY>
NEXT_PUBLIC_GRADUATOR       = <GRADUATOR>
NEXT_PUBLIC_STAKING_HUB     = <HUB>
NEXT_PUBLIC_POOL_FACTORY    = <POOL_FACTORY>
NEXT_PUBLIC_FACTORY_VERSION = v2
NEXT_PUBLIC_WC_PROJECT_ID   = <existing>
NEXT_PUBLIC_SERVER_URL      = https://api.monpad.net
```

(VESTING and SWAP intentionally omitted — audit V2.1-8.)

Update the backend `.env` on the droplet:

```
FACTORY_ADDRESS=<FACTORY>
PRIMARY_RPC=<your paid Monad RPC if any>
ADMIN_SECRET=<keep existing>
LIVEPEER_API_KEY=<keep existing>
```

Then `pm2 restart monpad-api` after `git pull`.

---

## 🧪 SANITY CHECK (before flipping the frontend)

Read these on the deployed FACTORY in Remix or Monadscan:

- `creationFee()` → `100000000000000000000` (= 100 MON)
- `graduationTarget()` → `425000000000000000000000` (= 425k MON)
- `graduationLP()` → `400000000000000000000000` (= 400k MON, **decorative** — Curve sends actual balance)
- `graduationCreatorReward()` → `25000000000000000000000` (= 25k MON)
- `maxDevBuyBps()` → `200` (= 2%)
- `minDevBuyMon()` → `0` (V2.1-3 fix; was 100 ether in V2)
- `graduator()` → `<GRADUATOR>` ✅ proves bootstrapInit landed
- `rewardRouter()` → `<HUB>` ✅
- `poolFactory()` → `<POOL_FACTORY>` ✅
- `bootstrapped()` → `true` ✅
- `owner()` → your deployer wallet (transfer to hardware wallet later)

On the HUB:
- `monshiToken()` → `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` ✅
- `factory()` → `<FACTORY>` ✅
- `monshiShareBps()` → `4000` (40%)
- `othersShareBps()` → `6000` (60%)

On the GRADUATOR:
- `monpadFactory()` → `<FACTORY>` ✅ (read by V2.1-2 auth check)
- `wmon()` → `0x3bd3...433A` ✅
- `BURN_ADDRESS()` → `0x000000000000000000000000000000000000dEaD`
- `LP_MON_MIN()` → `1000000000000000000` (1 MON)

If any of these is wrong → STOP, do not flip the frontend.

---

## 🛡️ POST-DEPLOY HARDENING (within 48h)

1. **Transfer ownership** of FACTORY, HUB, POOL_FACTORY, GRADUATOR to your
   hardware wallet via `transferOwnership(newOwner)` then `acceptOwnership()`
   from the new wallet. Each contract uses 2-step ownership; both calls are
   required. The MONSHI_POOL is owned by the deployer too — also transfer.

2. **Burn the deployer key** from `deploy/v2/.env` once ownership transfer
   completes.

3. **Smoke test** before announcing: launch a test token with 100 MON, do a
   1 MON buy, do a 50% sell, verify creator can `claimCreatorRewards()`.
   Don't push to graduation in production with a throwaway token — too expensive.

---

## 🆘 IF SOMETHING IS WRONG

| Symptom | Fix |
|---------|-----|
| Sells revert with `staking fee fail` | One or more curves were launched before bootstrapInit. Call `factory.backfillCurveAuthorization([curve1, curve2, …])` from the factory owner |
| Wrong wallet on factory | `queueSetTreasuryWallet` / `queueSetBuybackWallet` / `queueSetPlatformWallet`, then execute after 24h |
| Wrong wallet on poolFactory | None — V2.1 reads from factory live, no per-pool config |
| Wrong MONSHI in hub | Cannot rotate. Hub redeploy required (binding is one-shot) |
| Wrong NPM/WMON on graduator | Redeploy graduator, then `queueSetGraduator(newGrad)` on factory + execute after 24h |
| Need to graduate but creatorReward is too high | `queueSetGraduationCreatorReward(lower)` + execute after 24h. _graduate's V2.1-14 check now reverts cleanly upfront instead of bricking mid-flow |
