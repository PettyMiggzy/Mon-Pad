# MonPad V2 Smart Contracts

All contracts compiled with `solc 0.8.24`, `viaIR: true`, `optimizer: 200 runs`, `evmVersion: paris`.

## Contracts

| File | Purpose |
|------|---------|
| `MonPadFactoryV2.sol` | Token launcher. All economics admin-tunable. |
| `MonPadTokenV2.sol` | Standard ERC20 minted to curve at deploy. |
| `MonPadCurveV2.sol` | Bonding curve per token. Handles buy/sell, fees, graduation. |
| `MonPadStakingHub.sol` | Routes 0.5% sell-tax. 40% to MONSHI pool, 60% to others by volume. |
| `MonPadStakingPool.sol` | Per-token staking. 4 lock tiers (30/90/180/365 day) with multipliers. |
| `MonPadPoolFactory.sol` | Deploys pools. Free for 1M+ MONSHI holders, 200 MON otherwise. |
| `MonPadVesting.sol` | Token lock + linear vesting for dev allocations. |
| `MonPadSwap.sol` | Wrapper around existing DEX with 0.3% platform fee. |

## Fee Logic

**On every BUY (2% total):**
- 1% → token creator (instant)
- 1% → curve buffer (paid to platform at graduation)

**On every SELL (2% total):**
- 0.5% → token creator (instant)
- 0.5% → reward router (currently buyback wallet, swappable to staking hub via `factory.setRewardRouter()`)
- 1% → platform wallet (instant)

## Graduation

- Target: 425,000 MON net raised
- At graduation:
  - 400,000 MON + remaining tokens → Uniswap V3 LP → burn
  - 25,000 MON → token creator (marketing)
  - Buy buffer accumulated → platform wallet

## Dev Buy Cap

- Max 2% of total supply (20M tokens)
- Enforced in `MonPadCurveV2.devBuy()`
- Atomic at launch (no front-running)

## Staking Lock Tiers

| Tier | Duration | Reward Multiplier |
|------|----------|-------------------|
| 0 | 30 days | 1.0x |
| 1 | 90 days | 1.5x |
| 2 | 180 days | 2.5x |
| 3 | 365 days | 4.0x |

Early unstake: 10% fee on tokens + all rewards forfeited (boosts remaining stakers).

## Admin-Tunable Parameters

All on `MonPadFactoryV2`:
- `creationFee`, `maxDevBuyBps`, `minDevBuyMon`
- `graduationTarget`, `graduationLP`, `graduationCreatorReward`
- All fee BPS (buy/sell splits)
- All wallets (platform, treasury, buyback, monshiPool)
- `rewardRouter` — the magic switch (defaults to buyback, set to stakingHub when ready)
- Pause switches (new launches, all buys, all sells)
- Token blocklist

## Deployment

See `deploy/v2/deploy.js` and `deploy/v2/.env.example`.

```bash
# 1. Set up env
cp deploy/v2/.env.example deploy/v2/.env
# Edit .env with your private key + wallet addresses

# 2. Run deploy
node deploy/v2/deploy.js
```

## Testing

Contracts verified end-to-end via local ganache fork:
- ✅ Launch with creation fee
- ✅ Atomic dev buy with 2% supply cap enforcement
- ✅ Buy/sell with correct fee distribution
- ✅ Auto-graduate at target
- ✅ Admin tuning all parameters
- ✅ Reward router swap (buyback → staking hub)
- ✅ Pool creation (free for 1M MONSHI holders)
- ✅ Staking with 4 lock tiers
