# 🚀 MonPad V2 — Remix Deploy Guide

Deploy 5 contracts to Monad mainnet via Remix. Total time: ~15 min if everything is in your wallet ready.

---

## ⚙️ ONE-TIME SETUP (in Remix)

1. Open https://remix.ethereum.org
2. **Solidity Compiler tab (left sidebar):**
   - Compiler: `0.8.24`
   - Language: Solidity
   - EVM Version: **`paris`** ← critical (Monad doesn't support Shanghai/PUSH0 yet on some configs)
   - **Enable optimization**: ✅ `200` runs
   - **Advanced configurations** → enable **`viaIR`** ✅
3. **Deploy tab:**
   - Environment: **Injected Provider — MetaMask**
   - Make sure MetaMask is on **Monad Mainnet** (chain ID 143, RPC `https://rpc.monad.xyz`)

---

## 📁 UPLOAD CONTRACTS

In Remix file explorer, create folder `MonPad/` and upload all 5 files from this repo:

```
deploy/v2/remix/MonPadFactoryV2.flat.sol
deploy/v2/remix/MonPadVesting.flat.sol
deploy/v2/remix/MonPadStakingHub.flat.sol
deploy/v2/remix/MonPadPoolFactory.flat.sol
deploy/v2/remix/MonPadSwap.flat.sol
```

Each is **self-contained** (no imports needed).

---

## 🔥 DEPLOY ORDER (DO THIS IN ORDER)

### ⚠ Before you start — HAVE READY:

| Wallet | Address |
|--------|---------|
| `_platform` | **`0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16`** (existing platform wallet) |
| `_treasury` | **`0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd`** (dev wallet) |
| `_buyback` | **(YOU NEED TO CHOOSE — see below)** |
| `_monshi` | **`0xB744F5CDb792d8187640214C4A1c9aCE29af7777`** (MONSHI token) |

You said you'd answer the buyback question when you stop driving — **for the deploy you can use the dev wallet `0x5dD4...FFfd` as buyback temporarily**, then change it later via `setBuybackWallet(newAddr)` on the factory once you decide. Zero downside since you can rotate any time.

---

### ① **MonPadFactoryV2** (the main contract)

Open `MonPadFactoryV2.flat.sol`, compile, then in Deploy panel:
- Select **`MonPadFactoryV2`** from the contract dropdown
- Constructor args (paste in this order):
  ```
  _platform: 0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16
  _treasury: 0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd
  _buyback:  0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd
  ```
  (or your real buyback wallet)
- Click **Deploy** → confirm in MetaMask
- ✅ **SAVE THE ADDRESS** as `FACTORY` (you'll need it next)

### ② **MonPadVesting** (no constructor args)

- Compile `MonPadVesting.flat.sol`
- Select `MonPadVesting`
- Click **Deploy** → confirm
- ✅ Save as `VESTING`

### ③ **MonPadStakingHub**

- Compile `MonPadStakingHub.flat.sol`
- Select `MonPadStakingHub`
- Constructor:
  ```
  _factory: <FACTORY address from step ①>
  _monshi:  0xB744F5CDb792d8187640214C4A1c9aCE29af7777
  ```
- Deploy → confirm
- ✅ Save as `HUB`

### ④ **MonPadPoolFactory**

- Compile `MonPadPoolFactory.flat.sol`
- Select `MonPadPoolFactory`
- Constructor:
  ```
  _hub:      <HUB address>
  _factory:  <FACTORY address>
  _monshi:   0xB744F5CDb792d8187640214C4A1c9aCE29af7777
  _buyback:  <same buyback as step ①>
  ```
- Deploy → confirm
- ✅ Save as `POOL_FACTORY`

### ⑤ **WIRING (3 transactions on existing contracts)**

#### 5a) Transfer Hub ownership to PoolFactory
In Remix's deployed contracts list, expand **HUB**:
- Find **`transferOwnership`** function
- Argument: `<POOL_FACTORY address>`
- Click → confirm
- _(This lets the pool factory register new pools with the hub)_

#### 5b) Set FACTORY's reward router to HUB
In deployed contracts, expand **FACTORY**:
- Find **`setRewardRouter`**
- Argument: `<HUB address>`
- Click → confirm
- _(This routes 0.5% sell tax → hub instead of buyback)_

#### 5c) Create the MONSHI staking pool (free, admin-created)
Expand **POOL_FACTORY**:
- Find **`adminCreatePool`**
- Arguments:
  ```
  token:   0xB744F5CDb792d8187640214C4A1c9aCE29af7777
  creator: <your dev wallet 0x5dD4...FFfd>
  ```
- Click → confirm
- 📋 In the tx receipt, find the **`PoolCreated`** event → copy the **`pool`** address
- ✅ Save as `MONSHI_POOL`

#### 5d) Tell FACTORY about the MONSHI pool
Expand **FACTORY**:
- Find **`setMonshiStakingPool`**
- Argument: `<MONSHI_POOL address>`
- Click → confirm

---

## 🎉 DONE. Send me back these 5 addresses:

```
FACTORY      = 0x...
VESTING      = 0x...
HUB          = 0x...
POOL_FACTORY = 0x...
MONSHI_POOL  = 0x...
```

I'll wire them into the frontend env vars + flip `FACTORY_VERSION = 'v2'` and ship.

---

## 🧪 SANITY CHECK (optional, do BEFORE telling me you're done)

In Remix on the deployed FACTORY contract:
- `creationFee()` should return `100000000000000000000` (= 100 MON)
- `graduationTarget()` should return `425000000000000000000000` (= 425K MON)
- `maxDevBuyBps()` should return `200` (= 2%)
- `getRewardRecipient()` should return your **HUB** address (proves wiring worked)
- `monshiStakingPool()` should return your **MONSHI_POOL** address
- `owner()` should be your deployer wallet

If all 6 check out — you're golden. Ship it.

---

## 🛡️ SECURITY NOTES

- The deployer wallet you used = the `owner` of all contracts. Keep that key safe.
- You can transfer ownership later via `transferOwnership(newAddr)` then `acceptOwnership()` from the new wallet (2-step for safety).
- If anything goes wrong, you can pause all launches/buys/sells via `setPauseNewLaunches(true)` etc.
- All economics tunable post-deploy: fees, grad target, dev buy cap, wallets, blocklist.
