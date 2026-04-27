# DEPLOY-V2 PLAYBOOK

One-time runbook for going from current state (V1 live, V2 contracts ready) to V2 fully live. Designed for mobile — every step is one command + one verify.

**DO NOT START until all 3 PRE-FLIGHT items are ✅.**

---

## 🚦 PRE-FLIGHT (gates everything)

- [ ] **TREASURY_WALLET confirmed** — you have the private key + tested signing
- [ ] **BUYBACK_WALLET confirmed** — same wallet as treasury per handoff, OR different, but you control it
- [ ] **NEVER use `0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd`** — old treasury, access lost

If any of these is "I think so" → STOP. Send 0.1 MON from each wallet to confirm access first. A miswired fee wallet from minute 1 of trading bleeds real money to a dead address.

---

## 1️⃣ DEPLOY BACKEND (commit `41f7db4` → droplet)

Backend = `api.monpad.net` = droplet `138.68.248.211:3001` (DigitalOcean, PM2). Manual git-pull deploy.

**SSH from phone:** DigitalOcean app → Droplets → monpad → Console → opens browser SSH.

```bash
cd ~/Mon-Pad        # or wherever the repo lives — check with: find / -name "Mon-Pad" -type d 2>/dev/null
git pull origin main
pm2 list            # find the backend process name
pm2 restart <name>  # likely "monpad-backend" or "server"
pm2 logs <name> --lines 20    # verify clean startup, no crash loop
```

**Verify from phone:**
- [ ] `curl https://api.monpad.net/api/health` → returns `{"ok":true}`
- [ ] `curl https://api.monpad.net/api/leaderboard/traders` → returns array (may be `[]` if no trades yet)
- [ ] Open `monpad.net/portfolio` connected with a wallet that holds MONSHI → MONSHI shows in holdings list

If holdings show → backend deploy ✅. Otherwise check `pm2 logs` for errors.

---

## 2️⃣ VERIFY VERCEL ENV (before touching contracts)

vercel.com/monpad/monpad → Settings → Environment Variables. Confirm these exist for **Production**:

- [ ] `NEXT_PUBLIC_SERVER_URL` = `https://api.monpad.net`
- [ ] `NEXT_PUBLIC_WC_PROJECT_ID` = `cc1358b5e311a1f844c1d6482633c78d`

If `NEXT_PUBLIC_SERVER_URL` is missing → add it → Deployments tab → Redeploy. (Vars only take effect on next build.)

---

## 3️⃣ DEPLOY V2 CONTRACTS (only after pre-flight + backend ✅)

This step **uses your private key**. Run from your own machine, NOT a server, NOT a shared device. Never paste `PRIVATE_KEY` into chat with any AI.

```bash
cd Mon-Pad/deploy/v2
cp .env.example .env
nano .env           # fill in values below — overwrite the example treasury!
```

Fill `deploy/v2/.env`:

```
PRIVATE_KEY=<your deployer key, no 0x prefix>
RPC_URL=https://rpc.monad.xyz

PLATFORM_WALLET=0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16
TREASURY_WALLET=<YOUR confirmed treasury — NOT the example>
BUYBACK_WALLET=<YOUR confirmed buyback — NOT the example>

DEPLOY_STAKING=1
MONSHI_TOKEN=0xB744F5CDb792d8187640214C4A1c9aCE29af7777

DEPLOY_SWAP=0
```

> **Why DEPLOY_SWAP=0:** swap.js has known bugs (`minOut=0n`, no quote, no token-to-token routing). Deploying MonPadSwap now ships a sandwich-vulnerable surface. Defer until those are fixed.

Deploy:

```bash
node deploy.js 2>&1 | tee deploy.log
```

**Capture from console output (also written to `deploy/v2/deployed.json`):**

- [ ] `MonPadFactoryV2` address → `<FACTORY_V2>`
- [ ] `MonPadVesting` address → `<VESTING>`
- [ ] `MonPadStakingHub` address → `<STAKING_HUB>`
- [ ] `MonPadPoolFactory` address → `<POOL_FACTORY>`

**Verify on Monadscan:**
- [ ] All 4 contracts show as deployed
- [ ] Factory `owner()` = your deployer wallet
- [ ] Factory `platformWallet()` matches `PLATFORM_WALLET`
- [ ] Factory `treasuryWallet()` matches your treasury
- [ ] Factory `buybackWallet()` matches your buyback
- [ ] Factory `graduationTarget()` = `425000000000000000000000` (425k MON in wei)
- [ ] Factory `graduationCreatorReward()` = `25000000000000000000000` (25k MON in wei)
- [ ] Factory `rewardRouter()` = StakingHub address (deploy.js auto-wires this)
- [ ] Factory `monshiStakingPool()` = MONSHI pool address (deploy.js auto-wires this)
- [ ] StakingHub `owner()` = PoolFactory address (deploy.js transfers this)
- [ ] MONSHI pool `creator()` = `BUYBACK_WALLET` ⚠️ if this returns the deployer instead of buyback, deploy.js line 107 wasn't updated for burn vault — STOP and fix before any trades happen

---

## 4️⃣ FLIP FRONTEND TO V2 (Vercel env)

vercel.com/monpad/monpad → Settings → Environment Variables. **Add for Production:**

- [ ] `NEXT_PUBLIC_FACTORY_V2` = `<FACTORY_V2 from step 3>`
- [ ] `NEXT_PUBLIC_STAKING_HUB` = `<STAKING_HUB from step 3>`
- [ ] `NEXT_PUBLIC_POOL_FACTORY` = `<POOL_FACTORY from step 3>`
- [ ] `NEXT_PUBLIC_FACTORY_VERSION` = `v2`

(Skip `NEXT_PUBLIC_SWAP` — not deployed this round.)

Then: Deployments tab → top deploy → ⋯ menu → **Redeploy** → uncheck "Use existing Build Cache" → Deploy.

**Verify:**
- [ ] After redeploy, monpad.net Create page lists `FACTORY_V2` address (check via DevTools or by attempting a launch)

---

## 5️⃣ POINT BACKEND AT V2 FACTORY

Back to droplet SSH:

```bash
cd ~/Mon-Pad
nano .env       # or wherever the backend env lives — check ecosystem.config.js / pm2 env
```

Set / update:

```
FACTORY_ADDRESS=<FACTORY_V2 from step 3>
MONAD_RPC=https://rpc.monad.xyz
```

Then:

```bash
# Reset the indexer cursor so it picks up V2 from genesis of factory
rm -f lib/tradeCache.json lib/tradeBlocks.json lib/db.json    # nuke V1 cache
pm2 restart <backend process name>
pm2 logs <name> --lines 50
```

Watch logs for `Indexed N new tokens (total: N)` — that's the V2 factory being scanned.

> **Note:** V1 token data is gone after this. If you want V1 tokens to stay visible during transition, skip the `rm` step and just update `FACTORY_ADDRESS` — the indexer will dual-run (V1 cached, V2 newly indexed).

---

## 6️⃣ SMOKE TEST (the only step that proves it works)

From a wallet with ~150 MON:

- [ ] **Launch test token:** monpad.net/create, fill in (Name="TEST", Symbol="TEST"), pay 100 MON creation fee. Confirm tx succeeds.
- [ ] **Verify routing:**
  - 100 MON moved from your wallet → `PLATFORM_WALLET`? Check Monadscan.
  - Token appears on monpad.net homepage?
- [ ] **Buy test:** buy 1 MON of your token via the curve.
  - 0.01 MON (1%) goes to YOU (creator). Verify.
  - 0.01 MON (1%) accumulates in curve buffer. Read `curve.totalPlatformFees()` on Monadscan, should ≈ 0.01 MON.
- [ ] **Sell test:** sell back 50% of your tokens.
  - 0.5% to YOU (creator), 0.5% to `BUYBACK_WALLET`, 1% to `PLATFORM_WALLET`. Verify all 3 destinations.
- [ ] **Backend caught it:** `monpad.net/portfolio` shows the test token in your holdings + the buy/sell trades in trades tab.
- [ ] **Leaderboard updated:** `monpad.net/leaderboard` → Traders tab shows your wallet with the test volume.

If all 6 ✅ → V2 is live. Tweet it.

If any ❌ → STOP, do NOT announce. Most likely culprits:
- Backend env didn't update → repeat step 5
- Vercel env didn't redeploy with cache cleared → repeat step 4 with cache uncheck
- Wrong wallet in step 3 → admin panel `/admin` can re-set platform/treasury/buyback live without redeploy

---

## 🆘 ROLLBACK

If V2 is broken and trading needs to keep working:

1. Vercel → set `NEXT_PUBLIC_FACTORY_VERSION=v1` → Redeploy
2. Backend → `FACTORY_ADDRESS=0xc1dF3c842C2e1Fb76656A8415D66B72A101366Bc` → `pm2 restart`

Frontend will fall back to V1 contracts. No funds lost — V2 contracts still exist on-chain, just unrouted.

---

## 📋 POST-DEPLOY CHECKLIST (within 24h of step 6 passing)

- [ ] Send a screenshot of `deploy/v2/deployed.json` to yourself for record
- [ ] Add V2 factory + staking hub addresses to a pinned note in your password manager
- [ ] Verify ownership transfer: factory `owner()` should be your hardware wallet, NOT the deployer key. If still deployer → call `transferOwnership(<hw wallet>)` from `/admin` page
- [ ] Burn deployer key from `deploy/v2/.env` after ownership transfer
