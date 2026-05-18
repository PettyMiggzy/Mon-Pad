# Mon-Pad V2.1 — Deployed to Monad Mainnet

**Deployed:** 2026-05-18
**Chain:** Monad Mainnet (chainId 143)
**Status:** Live

---

## Contracts

| Contract | Address |
|---|---|
| MonPadFactoryV2 | 0x776af5A5FC3037cAEe3aA02B50443358b68984aE |
| MonPadStakingHub | 0xc214F6c83D014E468f88B4c3F61A0FC179036188 |
| MonPadPoolFactory | 0xe80DfA4E68655D824487DFe3Ed90e6162183e669 |
| MonPadGraduator | 0x700b6C3B7A82b564606342406F58b294747C3486 |

## Clone Implementations

| Contract | Address |
|---|---|
| MonPadCurveV2 (impl) | 0xeDc43eB0c387A6DEa54e8B1B75797B9a75A8B1Db |
| MonPadTokenV2 (impl) | 0xB51708c45e9dD339d048c88310718D9d02b84D6b |
| MonPadStakingPool (impl) | 0xaB3f0F30b1457F96Bc684724031b34c5f5122295 |

## Wallet Roles

| Role | Address | Notes |
|---|---|---|
| Owner / Deployer | 0xB9d4B73bE18914c6d64Bee65a806648370be467f | Admin wallet #2 — owns all 4 main contracts |
| Platform | 0x57C8A5AeC1c172fE41416A2FAE6eBDD92b552A16 | Receives platform fees (1% buys, 1% sells) |
| Treasury | 0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd | Receives creation fees at graduation, MONSHI buyback accumulator |
| Buyback | 0x5dD4bF19C42d45FD414930eFE78D602c5975FFfd | Same as treasury (intentional — MONSHI buybacks accumulate in treasury) |

## External Contracts (pre-existing on Monad)

| Contract | Address |
|---|---|
| MONSHI Token | 0xB744F5CDb792d8187640214C4A1c9aCE29af7777 |
| WMON | 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A |
| Uniswap V3 NonfungiblePositionManager | 0xa9f6B6656e32F223d778b01642F32D00F5310526 |

## Deployment Transactions

| Event | Tx Hash | Block |
|---|---|---|
| factory.bootstrapInit() | 0x2da8488c857f5e79f66dcd3a15243c401ae9ad3cd0622c7f7e482d4d4bcf6aaf | 75355930 |
| hub.bootstrapMonshi() | 0x13ef93c4e311c822de956dbdf074bafd4d668e0e989ea5cc55141d80f9e47a5a | 75355933 |

## Tokenomics (Locked Per Spec)

- **Creation fee:** 100 MON
- **Graduation target:** 425,000 MON (raised, net of fees)
- **Creator graduation reward:** 25,000 MON
- **Total supply per token:** 1,000,000,000 (1B)
- **Curve virtual reserves:** V_M = 117,000 MON, V_T = 1,260,000,000 tokens
- **Buy fees (2% total):** 1% creator + 1% platform buffer
- **Sell fees (2% total):** 1% platform + 0.5% creator + 0.5% staking hub
- **Admin timelock:** 24 hours on all proposeSet* actions

## Infrastructure

- **Frontend:** Vercel (TBD — connect to this repo)
- **Indexer:** https://api.monpad.net (DigitalOcean droplet 138.68.248.211)
- **Image upload:** POST https://api.monpad.net/api/upload (multer + sharp, 512x512 resize)
- **Image serve:** https://api.monpad.net/uploads/<hash>.jpg
- **RPC:** QuickNode Monad Mainnet endpoint (primary) + https://rpc.monad.xyz (fallback)

## Audit Status

- **Round 3 audit:** Cleared via Claude Code, zero mainnet blockers
- **Fork simulation:** 8 steps passed end-to-end (deploy -> buys -> sell -> graduation -> real V3 LP mint -> creator claims)
- **Unit tests:** 18 passing

## Spec Reference

See SPEC_V2.1.md (on King's desktop, v1.1) for full design rationale, audit fix details, and deferred items (vesting, swap contract, staking UI v2.2).

## Next Steps

- [ ] Connect Vercel for live frontend
- [ ] Build Batch 2d (staking page)
- [ ] Lower graduation target via timelock for end-to-end mainnet test
- [ ] Update monpad-server indexer for V2.1 events
- [ ] Public launch
