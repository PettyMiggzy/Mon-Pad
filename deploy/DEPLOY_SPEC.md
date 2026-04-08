# MonPad Mainnet Deploy Spec

## Chain
- Monad Mainnet, Chain ID 143
- RPC: https://rpc.monad.xyz (primary), https://rpc1.monad.xyz (fallback)

## Wallet Roles
- **Owner/Deployer/Treasury:** `0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd` — deploys, owns contract, receives 0.5% sell fee real-time + creation fee at graduation
- **Platform:** `0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16` — receives 1% buy buffer at graduation + 1% sell fee real-time

## Canonical Contracts (Monad Mainnet)
- WMON: `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`
- Uniswap V3 NPM (Crust Finance): `0xa9f6B6656e32F223d778b01642F32D00F5310526`
- Block Explorer: https://monadscan.com

## Token Economics
- **Max supply:** 1,000,000,000 tokens per launch
- **Creation fee:** 100 MON (stays in curve, sent to treasury at graduation)
- **Min dev buy:** 100 MON (no max limit). Dev buy is atomic at launch time — no frontrunning.
- **Graduation target:** 425,000 MON total raised (monRaisedNet)
  - At graduation:
    1. 400K MON + remaining tokens → Uniswap V3 LP → burn LP (send NFT to dead address)
    2. 25K MON → token creator wallet (marketing/reward)
    3. Buy buffer (platform 1% accumulated) → platform wallet
    4. Creation fee → treasury wallet
    5. Sell buffer → platform wallet

## Fee Structure (2% buy / 2% sell)

### Buy Fees (2% total)
| Recipient | BPS | Timing |
|-----------|-----|--------|
| Platform  | 100 | Held in curve as sell buffer until graduation, then sent to platform |
| Creator   | 100 | Real-time, every buy |

### Sell Fees (2% total)  
| Recipient | BPS | Timing |
|-----------|-----|--------|
| Platform  | 100 | Real-time, every sell |
| Creator   | 50  | Real-time, every sell |
| Treasury  | 50  | Real-time, every sell |

- All fee recipient addresses (platform, treasury, creator) must be changeable by owner via factory
- Fee BPS values must be changeable per curve by owner via factory

## Contract Changes from existing mvpdeploy.sol

1. Rename `buyback` → `treasury` everywhere
2. Update fee defaults:
   - Buy: platformBps=100 (buffer), creatorBps=100 (real-time), bufferBps=0 (the platform IS the buffer)
   - Actually: buyFeePlatformBps=0 (real-time to platform = 0 on buy), buyFeeCreatorBps=100, buyFeeBufferBps=100
   - Wait — let me be precise:
     - Buy 1% to creator (immediate) = buyFeeCreatorBps=100
     - Buy 1% to curve as sell buffer (held, paid to platform at graduation) = buyFeeBufferBps=100
     - buyFeePlatformBps=0 (no immediate platform payout on buy)
   - Sell: sellFeePlatformBps=100 (real-time), sellFeeCreatorBps=50, sellFeeTreasuryBps=50
   - Need to add sellFeeTreasuryBps (new field, was sellFeeBuybackBps)
3. Update graduation:
   - 25K MON to creator (marketing reward) — NEW
   - buyBuffer → platform wallet
   - creationFee → treasury wallet
   - sellBuffer → platform wallet (existing behavior)
   - Remaining MON + tokens → V3 LP → burn
4. createLaunch must accept referrer param and dev buy:
   - msg.value = creationFee + devBuyAmount
   - creationFee goes into curve
   - devBuyAmount executes atomic buy on the curve (no frontrunning possible)
   - Min devBuyAmount = 100 MON (configurable via minDevBuy on factory)
5. Update factory constructor defaults:
   - capMon = 425_000 ether
   - creationFee = 100 ether
6. Factory Launched event should include referrer and devAmt for indexing

## Frontend Changes (wagmi.ts)
- Chain: Monad Mainnet (id: 143)
- RPC: https://rpc.monad.xyz
- Block explorer: https://monadscan.com

## Frontend Changes (constants.js)
- All addresses updated to mainnet deployed addresses
- `price` renamed to `priceWeiPerToken` in CURVE_ABI
- MONADSCAN = 'https://monadscan.com'
- CREATION_FEE = 100n * 10n ** 18n
- MIN_DEV_BUY = 100n * 10n ** 18n
- GRADUATION_TARGET = 425000n * 10n ** 18n

## Server Changes (server.js on droplet)
- Chain ID 143
- Primary RPC: https://rpc.monad.xyz (free, 25 rps)
- Fallback: https://rpc1.monad.xyz (15 rps)  
- Emergency fallback: QuickNode paid endpoint
- Smart polling: 60s index interval instead of 30s, batch RPC calls
- Factory address updated
- START_BLOCK = deployment block number
- priceWeiPerToken used consistently
