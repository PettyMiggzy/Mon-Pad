# Mon-Pad — Pre-Mainnet Full-Repo Audit

Scope: the live V3 launchpad (contracts + Next.js app + Supabase). Five independent
adversarial passes (curve, factory/graduator, API/server, client-config/secrets/XSS,
trade-math/RLS), then each Critical/High re-verified against source. Contracts audited
are `hardhat-test/contracts/v3/*` (the set `lib/constants.ts` points at).

**Bottom line:** the core on-chain mechanism is soundly built — the curve conserves
value (invariant traced end-to-end), LP is burned (un-ruggable post-graduation), the
token has no backdoor, secrets are server-only, RLS blocks all public writes, and the
trade previews match the contract. The launch is **blocked by one config issue** (the
app is wired to unaudited TEST contracts) and should not ship until the High items are
resolved.

---

## LAUNCH BLOCKERS (must resolve before mainnet)

### B1 — Site is hard-wired to the TEST factory/graduator (CRITICAL)
`lib/constants.ts:60-61,77-81,89-92`. `FACTORY_V3`/`GRADUATOR_V3` resolve to the low-fee
TEST deploy (`0x45Fb…` / `0xE27E…`, **1 MON create / 20 MON graduate**) and `resolveFactory()`
deliberately ignores `NEXT_PUBLIC_*` env. Every launch, graduation, creator reward, and
treasury cut on mainnet would run against unaudited test economics. The homepage even
advertises "500 MON / 260k" while `create.tsx` shows "1 MON / 20 MON" — a live
copy-vs-behavior contradiction.
- **Fix:** restore env-aware `resolveFactory()` (with the superseded self-heal), point at
  the audited production deploy, and restore economics to 500 / 260_000 / 41_700 / 10_400.

### B2 — The documented "production" graduator uses the wrong Uniswap NPM (HIGH)
`lib/constants.ts:54-56`. The restore note itself warns that the prod graduator `0x9770b2…`
was built against a non-official NPM fork (`0xa9f6…`); un-commenting it would ship a
graduator whose graduated pools DexScreener and the in-app Monorail router can't see.
The only correct-NPM graduator today is the *test* one.
- **Fix:** deploy a **fresh** production graduator against the official NPM
  `0x7197e214c0b767cfb76fb734ab638e2c192f4e53`, verify on-chain, then wire that address.

### B3 — `CREATION_BUFFER_MON` is an immutable constant = 0.2 MON (MEDIUM, blocker-adjacent)
`MonPadFactoryV3.sol:79`. The exit-liquidity buffer is `constant` — it cannot be raised to
the intended 100 MON without a redeploy, even though fee/target/reward are timelock-mutable.
- **Fix:** in the production redeploy, make the buffer a timelocked storage var
  (`require(buffer <= creationFee)`) and set the real value. Confirm the deployed bytecode's
  constants on-chain before promotion.

---

## HIGH (fix before / at launch)

### H1 — `rewards.ts` `refer` action has no signature check (app-layer)
`pages/api/rewards.ts:94-110`. The `refer` branch credits referrer +500 / referee +250 with
no proof of wallet ownership. Loop it with throwaway wallets to farm unlimited airdrop points;
also force-sets a victim's `referred_by` permanently (grief). `checkin` (71-92) is correctly
signed — mirror it.
- **Fix:** require an EIP-191 signature by `wallet` over a `refer <code>` message; recover and
  compare before crediting. Gate the referrer credit on the referee being a real/active user.

### H2 — Studio credit debit is a non-atomic read-modify-write (app-layer)
`pages/api/studio/{chat,image,video}.ts` (and `account.ts` top-up). Debit reads `credits`,
computes `newCredits` in JS, and writes it back with `upsert` — no atomic conditional
decrement. N concurrent requests all read the same balance and all proceed → K paid AI calls
for the price of one. Worst on video (250 cr ≈ $0.80/call): buy ~250 cr (~$2.50), fire 50
concurrent `start`s, get ~50 renders (~$40 provider spend) — obliterates the 3× margin and
drains the Venice budget. `free_used` cap has the same race.
- **Fix:** atomic conditional decrement in Postgres — `update … set credits = credits - X
  where wallet = ? and credits >= X` (RPC or `for update`), treat 0 rows as insufficient.
  Refund relatively (`credits = credits + X`), never an absolute snapshot. Same for `free_used`.

### H3 — `upload.ts` is an unauthenticated open object-storage host (app-layer)
`pages/api/upload.ts`. No auth / no wallet binding / no rate limit; `contentType` comes from the
client `type` field and only `.startsWith('image/')` is checked (bytes never sniffed).
`image/svg+xml` passes → stored and served inline as `image/svg+xml` → stored XSS on the
storage origin; and anyone can script unlimited 5 MB uploads (free CDN for arbitrary payloads).
- **Fix:** gate behind a wallet signature; raster-only allowlist (png/jpeg/webp/gif), reject
  `svg+xml`; sniff magic bytes / re-encode; per-wallet rate limit + global cap.

### H4 — Graduation can be permanently griefed by pre-initializing the V3 pool (contract)
`MonPadGraduatorV3.sol:327-338` (+ `MonPadCurveV3.sol:519`). `onGraduate` reverts
(`PoolPreInitWithBadPrice`) if the WMON/token pool is already initialized off-price; Uniswap V3
`createPool`/`initialize` is permissionless, so for gas anyone can pre-init any launched token's
pool at an absurd price and brick its graduation forever (creator reward + treasury cut + DEX
listing all lost; holders can still exit via the curve, so DoS not theft). Independently flagged
by two auditors; the code comment acknowledges it as accepted.
- **Fix:** eliminate the create race — have the graduator create+initialize the pool at launch
  (in the create/bootstrap flow) so no attacker window exists; or, on bad pre-init, seed against
  the pool's existing price / an alternate fee tier instead of reverting.

### H5 — Centralization: single hot-EOA owner with instant freeze power (contract/ops)
`MonPadFactoryV3.sol:274-277`. `setBlocked` / `setPauseAllSells` / `setPauseAllBuys` are
`onlyOwner` with **no timelock**; `blocked[token]` gates buy/sell/graduate, so the owner can
freeze all holder exits in one tx. Owner can also swap the graduator (24 h timelock) to redirect
all future graduation liquidity (the curve reads `graduator` live, not snapshotted — H1 of the
contract pass) and raise total fees to ~90% (24 h timelock). Deploy doc says owner = one EOA,
not a multisig, not renounced.
- **Fix:** move factory + graduator ownership to a multisig (or renounce). Bound `setBlocked`
  so it can never block sells/graduation (holders can always exit). Snapshot `graduator` per
  curve at init. Cap aggregate buy/sell fees (e.g. ≤ 1000–1500 bps) in the setter.

---

## MEDIUM

| ID | File | Issue | Fix |
|----|------|-------|-----|
| M1 | `next.config.js` | No CSP / `X-Frame-Options` / `Referrer-Policy` / nosniff — clickjacking on a fund-moving dApp | Add a `headers()` block |
| M2 | `pages/swap.tsx:447-463` | Monorail swap approves + sends to an unvalidated `transaction.to` from the keyless aggregator (no router allowlist) | Pin a Monorail router allowlist; enforce own minOut |
| M3 | `pages/token/[address].tsx:18-19,420` + `TokenCard.tsx:63` | Token-page previews use hardcoded fee bps (swap reads live) and card progress uses the **stale 425k V2 target** (V3 = 20/260k) | Read fees + gradTarget live, like `swap.tsx`/`chainV3` |
| M4 | `MonPadCurveV3.sol:202-216` | Creator can raise per-trade tax to 10% instantly (no timelock) — bait-and-switch (tax doesn't go to creator wallet, so not a direct rug) | Allow only lowering post-launch, or timelock; surface live tax in UI |
| M5 | `pages/api/token-meta.ts:106` | Unsigned first-write lets a non-creator seed fake branding/socials before the creator signs | Require a creator signature for all writes |
| M6 | `.env.example` | Instructs operators to put the QuickNode token behind `NEXT_PUBLIC_RPC_URL` (would leak a metered endpoint) | Replace with server-only `RPC_URL=` + a warning |
| M7 | `next.config.js:4-5` | Build ships with `ignoreBuildErrors` + `ignoreDuringBuilds` — a type/lint regression can't fail a deploy | Gate deploys on `tsc --noEmit` + `next lint` |
| M8 | `pages/api/bounties.ts:36` | POST signature has no nonce/timestamp → replayable to spam identical bounties under a real identity | Sign a server nonce + body hash; dedupe |
| M9 | `lib/studioServer.ts:99` | `verifyPayment` has no confirmation/finality guard (shallow reorg could redeem before final) | Require N confirmations (tx_hash PK still blocks double-redeem) |

---

## LOW / INFO (batch)

- `token-meta.ts:98` / render — `image_url` stored without scheme validation (socials use `safeUrl`); run it through the same allowlist.
- `studio/account.ts:18` — account GET is unauthenticated (any wallet's credits/access enumerable).
- `studio/account.ts:60` — top-up upsert is non-atomic (concurrent redemptions can lose *user* credits).
- `token/[address].tsx:392` — token page hardcodes 5% slippage with no user control (swap page is adjustable); lower default + expose control.
- swap/create/token — no explicit chainId guard / "switch to Monad" UX (wagmi still prevents wrong-chain send).
- `schema.sql:85` — `rewards` is publicly readable (`using(true)`), exposing the referral graph; expose only `wallet,points,streak` via a view.
- `MonPadCurveV3.sol:269` — `devBuy` lacks `nonReentrant` (not exploitable with the current hookless token; add for defense-in-depth).
- `lib/curve.ts:29-73` — dead `previewBuy/previewSell/priceAtMon` carry stale V2 virtual reserves (117k) that don't match the self-calibrating V3 curve; delete or mark V2-only.
- `lib/curveSwap.ts:93` / `token page` — sell preview caps gross at `realMonReserve` while the contract *reverts*; show "insufficient curve liquidity" instead of a number.
- `lib/chainV3.ts:313` — holder list is bounded to the ~12k-block log window (dormant pre-window whales omitted); label "recent-window" or seed from an indexer.
- Various endpoints return raw upstream/DB error strings — return generic messages, log details server-side.
- `MonPadGraduatorV3.sol:378` — LP fees are permanently unrecoverable (LP burned) — intended rug-safety, documented as a deliberate decision.
- `MonPadFactoryV3.sol:196` — MONSHI creation-fee discount reads spot balance (flash-loanable); minor, anti-spam fee never fully waived.

---

## Reviewed & clean (verified solid)

**Contracts**
- Curve value-conservation invariant traced end-to-end: `balance == realMonReserve + all
  pending buckets`; sellers/claimers can never draw more than is held; `realMonReserve ≥
  monRaisedNet` holds so graduation always has funds.
- `monRaisedNet` inflation fix holds and was not reintroduced (recycled fee/buyback MON does
  not touch bonding progress).
- Reentrancy / CEI on every trade/claim/graduate path; hookless token gives no callback; state
  set before external calls; no trading during/after graduation.
- LP NFT minted then `safeTransferFrom`'d to `0xdEaD` atomically — no EOA withdrawal path;
  `sweep` cannot touch NFTs or graduated assets. Rug-proof.
- Launched `MonPadTokenV2` has no owner / mint-after-init / pause / blacklist; supply fixed,
  moved once to the curve.
- Fee-split arithmetic conserves value; factory caps keep `fees + maxTax ≤ 10000`.
- Clone addressing collision-free (EIP-1167 via CREATE); init front-run window closed;
  overflow-safe (0.8.24, no unchecked in the curve).

**App / server**
- No committed secrets; `RPC_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VENICE_API_KEY` are all
  server-only, never `NEXT_PUBLIC`, never echoed.
- Studio payment replay guard solid: `tx_hash` PK claimed **before** crediting; `verifyPayment`
  binds `to==treasury`, `from==wallet`, `status==success`, credits native value — can't redeem
  another's tx, a wrong-address tx, a failed tx, or an ERC-20 as MON; can't reuse one tx for
  both access and credits.
- Signature auth (`verifyStudioSig`) is wallet- and day-bound, no true-on-error; stats admin
  gate (`isAdmin` + signature) not bypassable.
- RPC proxy: JSON-RPC method allowlist, batch cap 100, body cap, POST-only, fixed upstream
  (no SSRF).
- Supabase RLS write-side clean: studio_* / payments / usage / bug_reports have **no** policies
  (service-role only); every public policy is `select using(true)` — no public INSERT/UPDATE.
- `curveSwap` previews match `MonPadCurveV3._buy`/`_calcSellOut` (fees + tax both sides, virtual+
  real reserves, liquidity caps); rounding is conservative/user-favorable; minOut enforced
  on-chain.
- `fmtNum` decade-boundary bug fixed (mantissa rounded to 4 sig figs, exponent bumped on carry)
  and not regressed.
- `getV3Holders` uses authoritative `balanceOf` snapshots, excludes curve/dead/zero, no
  double-count.
- Token name/symbol/description render as escaped JSX; socials sanitized via `safeUrl`
  (`javascript:`/`data:` rejected) on both store and render; curve/router approvals are
  exact-amount, not `MAX_UINT256`.
