# Monpad V4 contracts: DEX day one, no curve

**Status: written and tested on a fork of Monad mainnet. NOT AUDITED. Do not put real value behind it before a professional audit.**

Files: `hardhat-test/contracts/v4/` (`MonpadLauncher.sol`, `MonpadToken.sol`), tests in `hardhat-test/test/v4-launcher.fork.js`, deploy in `hardhat-test/scripts/deployV4.js`.

## What it does
One transaction (`launch`) deploys a clean ERC-20 (1B supply, no tax, no mint, no owner, no blacklist, no anti-sniper), creates a real **Uniswap V3 pool on Monad (WMON, 1% tier)** through the official position manager, and puts the **whole supply in one single-sided position starting at the launch price and extending up**. The token is tradeable and indexable by DexScreener from the first block. There is no bonding-curve contract and no graduation.

The launcher owns the position NFT forever. It has **no function that removes liquidity or moves the NFT**, so liquidity is locked by construction. The only thing that comes out of the position is swap fees, through `harvest`.

## Fee split (constants, no setter exists)
Swap fees are the 1% pool fee. `harvest(token)` is permissionless.

| Fee asset | Creator | Platform | Burn MONSHI | Burn token |
|---|---|---|---|---|
| WMON | 70% (native MON, claimable) | 10% (claimable) | 10% (buys MONSHI, burns it) | 10% (buys the token, burns it) |
| Token | 70% (claimable) | 10% (claimable) | the MONSHI slice and the token slice are both burned in the token itself (20% to the dead address) |

Buy-and-burn runs from reserves via `buybackToken(token, max)` and `buybackMonshi(max)`. Anyone can call them. They are gated: the pool's 10-minute TWAP must exist and spot must be within about 3% of it (else revert), the swap has a price limit of 1.5% from spot, there is a 10-minute cooldown, and big reserves are spent 25% per call. Output goes straight to the dead address.

## Other behaviour
- **Creation fee** (owner can set, max 10,000 MON, default 100 in the deploy script) goes to the platform's claimable balance.
- **Dev buy:** send extra MON with `launch`; it buys on the new pool at the launch price and goes to the creator, capped at 5% of supply.
- **Start price** (`startTick`) is immutable per deployment. `START_MCAP_MON` in the deploy script chooses it.
- **Owner can:** change the platform address, set the creation fee, pause **new launches** only, and re-point MONSHI buybacks to another official-Uniswap pool after a 48-hour delay. `renounceOwnership` is disabled; ownership transfer is two-step.
- **Owner cannot:** touch liquidity, fees owed, or reserves. There is no withdraw, sweep, rescue or setter for the split.
- **Creator can** hand future fee rights to another address (`setCreator`).

## What the tests prove (fork of Monad mainnet, real Uniswap V3)
13 tests: launch seeds a real single-sided pool with the whole supply and zero left over; the launcher owns the LP NFT; fees split exactly 70/10/10/10 and the token share burns; claims pay out; buyback fails closed with no oracle history, works after the TWAP matures, and refuses when spot is far from TWAP; MONSHI buyback logic works against a liquid pool; a pre-initialised pool at a wrong price makes the launch revert and loses only gas; dev buy is capped; pausing launches does not stop harvest or claims; the owner has no withdraw or liquidity-removal function.

## Known issues and decisions to review before any mainnet deploy
1. **MONSHI has no liquidity on Uniswap today.** The MONSHI/WMON 1% pool exists on Monad but holds only dust (liquidity = 0), so `buybackMonshi` reverts with "no fill" and spends nothing. The 10% MONSHI share piles up in `monshiReserve` (safe) until MONSHI has a real pool. To fix: add real MONSHI liquidity on Uniswap V3 (any tier) and call `proposeMonshiPool(fee)` if it is not the 1% tier.
2. **Token-side fees:** the MONSHI burn slice can't buy MONSHI from token fees, so token-side fees burn 20% in the token itself. Intentional compromise.
3. **Keepers:** harvest and both buybacks only run when somebody calls them. Run a keeper bot (the Telegram bot host is a natural place).
4. **Launch griefing:** a third party who predicts the token address (`predictToken`) can pre-create its pool at the wrong price. The launch then reverts and the creator loses only gas; pick a new salt. No theft is possible.
5. **Gas:** a launch uses about 8.4M gas (token deploy + pool + position). Cheap in MON terms but check the Monad gas schedule before setting expectations.
6. **No anti-sniper** by design. First buyers are whoever is fastest.
7. **LP is permanent:** the position can never be rebalanced or withdrawn, and the range is fixed at launch.
8. **Platform and owner keys:** platform address and owner are trust points (they receive the platform share and can pause launches). Use a multisig as owner.
9. Untested: very high-volume behaviour, extreme price ranges, interaction with aggregators, long-run reserve accounting beyond the fork tests, the exact gas on Monad's fee model. Needs an independent audit.

## Still to do (frontend and bot are not yet wired to V4)
- `/create` must call `launch(name, symbol, salt)` with `msg.value` = fee + dev buy, and read the `Launched` event.
- Token page trades must use the pool (V3 swap path), not curve `buy/sell`. Chart/volume from the pool's `Swap` events.
- Creator earnings page: `claimable`, `claim`, `harvest`.
- Telegram buy bot: watch each launch pool's `Swap` events (token list from `Launched` events), not curve `Trade` events.
- A keeper for `harvest` and the two buybacks.
