# UV4 internal security review (first pass)

Scope: `hardhat-test/contracts/uv4/` (`MonpadHookLauncher`, `MonpadHook`, `MonpadV4Router`, `MonpadPoolLib`) and `contracts/v4/MonpadToken.sol`, at main after #31/#33/#35/#36.
Method: full manual read, the existing fork tests (11 pass), and new adversarial fork tests in `hardhat-test/test/uv4-audit.fork.js` (7 pass).

**This is an AI-assisted review, not a professional audit.** The repo's own gate is two clean passes plus E2E. This is pass one. Get an independent human review before putting real value behind it.

## Result: no critical or high findings

Checked and found sound:
- Liquidity cannot be removed: the only `modifyLiquidity` calls are add (launch) and a zero-delta collect (harvest). No owner or creator path touches the position.
- Fee enforcement: a swap that skips our router still pays the full fee (test A3: 1,000 USDC buy on a 6% pool harvested 59.999999 USDC). Only the launcher can initialize or configure a pool on the hook (A2).
- Fee accounting: USDC and token allocations sum exactly to what was collected (`require`s plus the existing conservation test).
- Router: results come from pool deltas, not `balanceOf`, so USDC or tokens sitting in the router cannot be taken by a later caller (A1). The unlock callbacks can only be reached through a router-initiated unlock.
- Token: plain OpenZeppelin ERC20, fixed supply, no owner, mint, tax, pause or blacklist.
- Owner powers are limited to: platform address, MONSHI wallet, creation fee (max 10,000 USDC), pausing new launches. `renounceOwnership` is disabled; `Ownable2Step` is used. The owner cannot touch liquidity, claimable balances or reserves.
- Caps: creator tax max 5% (A7), dev buy max 5% of supply (A5).
- `CREATE2` token salt includes `msg.sender`, so a launch cannot be squatted.

## Findings

| # | Severity | Finding | Suggested action |
|---|---|---|---|
| 1 | Medium (economic) | A new pool is single-sided: the only USDC in it is what buyers paid in. Large sells have huge price impact until buying volume builds (seen on the fork: a $250 sell on a fresh pool had 80% impact). Early holders cannot exit size. | Tell users on the create page. Optionally seed USDC. Not an exploit. |
| 2 | Medium (operational) | USDC is Circle's pausable, blacklistable FiatToken. If the launcher is blacklisted, `harvest` reverts for both currencies and USDC claims fail. If the pool manager or router is blacklisted or USDC is paused, all trades and launches fail. | Accepted risk. Document it. Token-side `claim` still works per asset. |
| 3 | Medium (trust) | The owner can redirect future platform and MONSHI shares and creation fees, and pause launches. | Use a multisig as owner. |
| 4 | Low | `launch` has no max-fee argument, so the owner raising `creationFee` before a launch tx lands makes a client that approved a large amount pay more. The site approves the exact total, so it reverts instead. | Add `maxCreationFee` in a future version. |
| 5 | Low | Buyback reference price re-anchors after 10 minutes (A6): a price move held longer than that is accepted. The guard only stops short-term manipulation. The buyback can also be sandwiched within the 3% bound (small, capped at reserve/4 per call). | Accepted. Keep the reserve cap. |
| 6 | Low | Anyone can add their own liquidity to a Monpad pool and share the fees, diluting the launcher position's fee share. It also adds sell-side depth. | Informational. |
| 7 | Low | Comment says the buyback price limit is 1.5%; the limit is 1.5% on sqrt price, so about 3% on price. | Fix the comment. |
| 8 | Info | `test/uv4-router.fork.js` tests the old MON-quoted router and fails in its setup. `_quoteInLimit` has an unused parameter. Stray MON or tokens sent to the router are unrecoverable. The creator gets up to 5% of supply at the start price by design. The V4 protocol fee, if ever enabled by Uniswap governance, reduces LP fees. | Delete or update the stale test. |
| 9 | Design | Contracts are immutable and liquidity is locked forever. A bug in `harvest` would strand fees. | Start with small launches; redeploy for fixes. |

## Not covered
Formal verification, fuzzing, an independent human review, mainnet-state behavior beyond the fork, USDC pause or blacklist against the real token, frontend, SDK, MCP and the bot.
