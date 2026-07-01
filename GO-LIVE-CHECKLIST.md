# Mon-Pad GO-LIVE checklist (TEST → PRODUCTION)

Everything currently runs in **TEST mode** (1 MON create / 20 MON graduate, low buffer).
Flip all of the following together when switching to the real launch. Nothing here is
done automatically — each is a deliberate step.

## 1. Contracts — redeploy a fresh PRODUCTION V3 set
The current TEST factory/graduator have TEST economics baked in. The *old* production
factory (`0xf82bFD436ea36515DFF5A6933980F86813D4f3Fa` / graduator
`0x9770b2a62d719b67E4Be206b0B0158b1448eB666`) is **NOT reusable** — it used the
non-official Uniswap NPM (`0xa9f6…`) and predates the exit-liquidity fix. Redeploy fresh:

- [ ] In `hardhat-test/contracts/v3/MonPadFactoryV3.sol`, set production economics:
  `creationFee = 500 ether`, `graduationTarget = 260_000 ether`,
  `graduationCreatorReward = 41_700 ether`, `graduationTreasuryCut = 10_400 ether`,
  `CREATION_BUFFER_MON = 100 ether`. **Keep** the exit-liquidity fix (buy buffer stays
  in the curve — do NOT revert that).
- [ ] `.env` `NPM_ADDRESS` = official Uniswap V3 NPM `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`
  (factory `0x204fAca1764B154221e35c0d20aBb3c525710498`) — already set.
- [ ] Deploy: `npx hardhat run scripts/deployV3.js --network monadMainnet` (fund the deployer).
- [ ] Run `test/v3-sell-cushion.js` against prod economics values first (adjust the buy
  amounts) to confirm sells + graduation still pass.
- [ ] Verify all contracts on the explorer (helps DexScreener + trust).

## 2. Frontend (`lib/constants.ts`)
- [ ] `FACTORY_V3_DEFAULT` / `GRADUATOR_V3_DEFAULT` → the new production addresses.
- [ ] Add the current TEST factory (`0x45Fb501E1167FbBfEBf42206A3C9945F13C70aaF`) to
  `SUPERSEDED_FACTORIES`.
- [ ] `V3_*` economics constants → 500 / 260_000 / 41_700 / 10_400.
- [ ] Rebuild + redeploy Vercel.

## 3. Backend `monpad-server` (droplet `/root/monpad-server/.env`)
Currently on **V2.1** contracts (stale). Decide first: **is it still used?** The frontend
reads V3 on-chain directly, so this may be legacy. If still used, update to the new
production V3 addresses; if not, retire the pm2 process.
- [ ] `FACTORY_ADDRESS` / `MONPAD_FACTORY` / `FACTORY_V2_ADDRESS` `0xa7AF30…` → prod V3 factory
- [ ] `GRADUATOR_ADDRESS` `0xa964…` → prod V3 graduator
- [ ] `STAKING_HUB_ADDRESS`, `POOL_FACTORY_ADDRESS`, `MONSHI_POOL_ADDRESS` — confirm still
  relevant or drop.
- [ ] `pm2 restart monpad-server`.

## 4. Bots (droplet)
- [ ] Mon-Pad trending bot `bot/.env`: `FACTORY_V3` → prod factory; keep `BOOST_CONTRACT`
  (`0xE50Ab41eAE60309d06a6aaA699f5E5786D78e4DA` — MONSHI-paid, already production-grade);
  `RPC_URL` → dedicated Mon-Pad endpoint. `pm2 restart monpad-bot`.
- [ ] MONSHI buy bot: unaffected (watches MONSHI, not the pad) — no change.

## 5. RPC + secrets
- [ ] Confirm QuickNode endpoints are current (old one was rotated). Keep them
  **server-side only** (`RPC_URL`, never `NEXT_PUBLIC_*`).
- [ ] Rotate any token that was pasted in chat.
- [ ] Split load: site + Mon-Pad bot on the dedicated Mon-Pad endpoint; MONSHI bot on its own.

## 6. DexScreener
- [ ] Graduated tokens auto-index on official Uniswap V3 (free — nothing to do).
- [ ] For pre-grad curve visibility: open a DEX listing request in DexScreener Discord
  (`discord.gg/wpV9vZsbR4`) with the verified/audited contracts. See
  `bot/DEXSCREENER-SUBMISSION.md`.

## 7. Ownership + wallet hygiene
- [ ] Transfer ownership of the prod factory / graduator / MonPadBoostMonshi from the
  burner deployer (`0xbbDB9561c981E72290EF5d138d781C14A825fAd5`) to a wallet you keep
  (`transferOwnership` → `acceptOwnership`), then discard the burner.
- [ ] Never reuse the abandoned/compromised wallets (`0xC022…`, `0xe7a3…`, `0x9007…`).
- [ ] Confirm treasury addresses: boost treasury `0xece5d15e567c801c835029a49b2e4067b0eb63aa`.

---
Reference (current TEST deploy): factory `0x45Fb501E1167FbBfEBf42206A3C9945F13C70aaF`,
graduator `0xE27E3E0D1AAABDDF26Fa00c6046B842A2F58616b`, MONSHI boost
`0xE50Ab41eAE60309d06a6aaA699f5E5786D78e4DA`.
