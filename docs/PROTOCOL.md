# Monpad protocol — fee & burn reference

Canonical constants: `lib/fees.ts`  
Canonical enforcement: `hardhat-test/contracts/v3/MonPadCurveV3.sol`  
Live JSON: `GET /api/v1/spec`

## Stack on every buy & sell

| Leg | BPS | Asset | Destination |
|---|---|---|---|
| Protocol token burn | 1000 | Project token | `0x…dEaD` |
| MONSHI buyback | 1000 | MON (quote) | `monshiBuybackPending` → buyback wallet |
| Platform | 1000 | MON (quote) | `platformPending` → `0x5899a0576A94327a6316E01190f951edf7645914` |

**Sells never take platform fee in project tokens.**  
**Creator tax** (`FeeConfig`) is independent and creator-set (0–10% trade tax cap).

### Buy mechanics

- From `monIn`: skim creator fee + platform + MONSHI + creator tax → remainder hits the curve.
- From `tokensOut`: burn `protocolBurnTokenBps`; buyer receives the rest.

### Sell mechanics

- From `tokensIn`: burn `protocolBurnTokenBps`; remainder sold into the curve.
- From `grossMonOut`: creator / MONSHI / platform / tax skims in **MON only**.

### Dev bot

`createLaunch` may include native MON for `devBuy` in the **same transaction** (fee-free, capped by `maxDevBuyBps`, default 2% supply). Purpose: creator is not sniped at launch.

## Addresses

| Name | Value |
|---|---|
| MONSHI | `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` |
| Dead | `0x000000000000000000000000000000000000dEaD` |
| Platform | `0x5899a0576A94327a6316E01190f951edf7645914` |
| Chain | Monad `143` · RPC `https://rpc.monad.xyz` |

Factory / graduator: always refresh from `/api/v1/spec` — do not trust chat memory.
