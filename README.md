# MonPad — Fair Launch on Monad

> The fairest pad on Monad. Devs earn 2% of all volume forever.

## ✨ Features

- **Fair launch** — no presale, no team tokens, no insider games
- **Devs earn forever** — 2% of every trade (1% buy, 0.5% creator + 1.5% other on sells)
- **Bonding curve** to 425K MON graduation, then LP burned forever 🔥
- **Staking with 4 lock tiers** — 30/90/180/365 days, up to 4× reward boost
- **Admin-tunable economics** — every fee, wallet, and threshold rotatable
- **Reward router upgrade path** — sell-tax routes flip from buyback → staking via single tx
- **Token blocklist** — admin can disable scams without redeploying
- **Referrals** — share your link, earn from launches that come through it
- **Mobile PWA** — installable, swipe nav, dark theme

## 🏗️ Architecture

### Smart Contracts (`contracts/v2/`)

| Contract | Lines | Purpose |
|----------|-------|---------|
| `MonPadFactoryV2.sol` | 234 | Token launcher with 2-step ownership + admin tunables |
| `MonPadCurveV2.sol` | 308 | Bonding curve, fees split per launch |
| `MonPadTokenV2.sol` | 72 | Standard ERC20, minted to curve at deploy |
| `MonPadStakingHub.sol` | 168 | Routes 0.5% sell-tax to staking pools |
| `MonPadStakingPool.sol` | 209 | Per-token staking with 4 lock tiers |
| `MonPadPoolFactory.sol` | 110 | Pool deployer (free for 1M+ MONSHI holders) |
| `MonPadVesting.sol` | 126 | Dev token locks + linear vesting |
| `MonPadSwap.sol` | 162 | DEX wrapper with 0.3% buyback fee |

Compiled with `solc 0.8.24`, `viaIR: true`, `optimizer: 200`, `evmVersion: paris`.

End-to-end tested on local Ganache fork. Build artifacts: `deploy/v2/build/*.json`.

### Frontend (Next.js 14)

- `pages/index.js` — browse with trending carousel + tabs (live/new/mcap/grad)
- `pages/create.js` — launch with dev-buy slider + image upload + referrals
- `pages/token/[address].js` — chart + trade terminal + dev fees + staking widget
- `pages/staking.js` — global pools dashboard
- `pages/stake/[address].js` — per-token staking with tier selector
- `pages/portfolio.js` — net worth dashboard with P&L + achievements
- `pages/admin.js` — owner-only contract param control
- `pages/swap.js` — token-to-token swap UI
- `pages/leaderboard.js` — top creators / stakers / traders / tokens
- `pages/profile.js` — referral link + share buttons + activity stats
- `pages/docs.js` — how it works

### Backend (`lib/server.js`)

Express + WebSocket on port 3001, deployed at `https://api.monpad.net`.

Endpoints:
- `/api/tokens` — all launched tokens (paged)
- `/api/token/:address` — single token state
- `/api/token/:address/{trades,holders,candles,meta}` — detail data
- `/api/staking/{pools,pool/:t,positions/:wallet,hub}` — staking data
- `/api/portfolio/:wallet/{holdings,trades,achievements}` — user dashboard
- `/api/leaderboard/{creators,stakers,traders}` — rankings
- `/api/upload/{banner,pfp}` — image uploads
- `/api/mon-price` — MON/USD via DexScreener + CoinGecko fallback

## 🚀 Deployment

### Smart Contracts

```bash
cd deploy/v2
cp .env.example .env
# Edit .env with PRIVATE_KEY, RPC_URL, wallets

node deploy.js
# Saves results to deploy/v2/deployed.json
```

### Frontend (Vercel)

```bash
# Required env vars on Vercel:
NEXT_PUBLIC_SERVER_URL=https://api.monpad.net
NEXT_PUBLIC_FACTORY_V2=0x...      # after V2 deploy
NEXT_PUBLIC_STAKING_HUB=0x...
NEXT_PUBLIC_POOL_FACTORY=0x...
NEXT_PUBLIC_VESTING=0x...
NEXT_PUBLIC_SWAP=0x...
NEXT_PUBLIC_BUYBACK_WALLET=0x...
```

Then in `lib/constants.js`, flip `FACTORY_VERSION = 'v2'` and push.

### Backend (Droplet)

```bash
# On droplet, in /root/monpad-api/:
git pull
pm2 restart monpad-api
```

Required env (in `.env`):
```
MONAD_RPC=https://your-rpc-here  # do NOT commit
FACTORY_ADDRESS=0x...             # V1 or V2
PORT=3001
```

## 🏷️ Fee Spec

**BUY 2%:**
- 1% → token creator (instant)
- 1% → curve buffer (paid to platform at graduation)

**SELL 2%:**
- 0.5% → token creator (instant)
- 0.5% → reward router (default = buyback wallet, swappable to staking hub)
- 1% → platform wallet (instant)

**Graduation (425K MON net raised):**
- 400K MON + remaining tokens → Uniswap V3 LP → burned forever 🔥
- 25K MON → token creator
- Buy buffer accumulated → platform

## 🥩 Staking

**Lock tiers:**
| Lock | Boost |
|------|-------|
| 30 days | 1.0× |
| 90 days | 1.5× |
| 180 days | 2.5× |
| 365 days | 4.0× |

**Pool creation:** Free for 1M+ MONSHI holders, 200 MON otherwise (→ buyback wallet).

**Hub distribution:** 40% to MONSHI's pool, 60% to others by trading volume.

**Early unstake:** 10% fee on tokens (→ creator) + ALL pending rewards forfeited (boosts other stakers).

## 🔐 Admin Powers

All on `MonPadFactoryV2`:
- `setCreationFee(uint256)`
- `setGraduationTarget(uint256)` / `setGraduationCreatorReward(uint256)`
- `setMaxDevBuyBps(uint256)` (capped at 1000 = 10% safety)
- `setFeeSplits(buyCreator, buyBuffer, sellCreator, sellStaking, sellPlatform)`
- `setRewardRouter(address)` — flip sell-tax target
- `setPlatformWallet(address)` / `setTreasuryWallet(address)` / `setBuybackWallet(address)`
- `setPauseNewLaunches(bool)` / `setPauseAllBuys(bool)` / `setPauseAllSells(bool)`
- `setBlocked(address, bool)` — token blocklist
- 2-step `transferOwnership` for safety

## 📱 Links

- Live: [monpad.net](https://monpad.net)
- API: [api.monpad.net](https://api.monpad.net)
- 𝕏: [@Monshi_Monpad](https://x.com/Monshi_Monpad)

## 📜 License

MIT — fork it, ship it, make Monad win.
