# Monpad on Uniswap V4: a hook that enforces the swap fee and the creator's tax

**Status: written and tested on a fork of Monad mainnet (real Uniswap V4 PoolManager). NOT AUDITED. Do not put real value behind it before a professional audit.**

Files: `hardhat-test/contracts/uv4/` (`MonpadHook.sol`, `MonpadHookLauncher.sol`), tests in `hardhat-test/test/uv4-launcher.fork.js`, deploy in `hardhat-test/scripts/deployUV4.js`, hook address miner in `hardhat-test/scripts/mine-hook.js`.
This supersedes the Uniswap V3 launcher in `contracts/v4/` (see `CONTRACT-V4.md`), which cannot give creators a tax at all, because a V3 pool's fee is one of three fixed tiers.

## What it does
`launch(name, symbol, salt, creatorTaxBps)` in one transaction:
1. deploys a clean ERC-20 (1B supply, no tax, no mint, no owner, no blacklist, no anti-sniper),
2. creates a **Uniswap V4 pool, native MON paired with the token**, using our hook,
3. puts the whole supply in one single-sided position at the launch price.

The launcher owns the position forever and has **no function that removes liquidity**, so liquidity is locked by construction.

## The fee, enforced inside the pool
`MonpadHook` sets the swap fee on **every** swap in the pool to `1% + creatorTax` (creatorTax 0 to 5%, chosen at launch and fixed forever). It does this in the pool's own `beforeSwap`, so any router, aggregator or contract that swaps in this pool pays it. There is no token-level tax, so the token stays a plain ERC-20 and works everywhere.

Only the launcher can create a pool that uses the hook (`beforeInitialize` checks the sender), so nobody can pre-create a launch's pool to grief it.

## Where the fees go (`harvest(token)` is permissionless)
| | Creator | Platform | Burn MONSHI | Burn token |
|---|---|---|---|---|
| **Base 1% fee, native MON side** | 70% (claimable) | 10% (claimable) | 10% (reserve, keeper buys + burns) | 10% (reserve, anyone buys + burns) |
| **Base 1% fee, token side** | 70% (claimable) | 10% (claimable) | burned in the token (20% total for both burn slices) | |
| **Creator tax (everything above 1%)** | 0% | 0% | 0% | **100% buys + burns the token** |

The creator tax can only deflate the token; the creator cannot take it out or change it later.

## Buy and burn
- `buybackToken(token, max)`: anyone. Reverts unless spot is within about 3% of the hook's reference price (sampled before a swap, at most every 10 minutes, so a same-transaction manipulation cannot poison it). Price limit 1.5% from spot, 10-minute cooldown, big reserves are spent 25% per call. Output goes straight to the dead address.
- `buybackMonshi(max, minOut)`: **keeper only** (set by the owner). The keeper supplies `minOut` from an off-chain price, so a sandwich cannot extract more. It works against a hookless native-MON/MONSHI V4 pool that the owner points to after a 48-hour delay.

## What the tests prove (15, fork of Monad mainnet, real PoolManager)
Hook at a mined address with exactly the right flags; launch seeds a real single-sided native pool with the whole supply and nothing left; an outsider cannot create a pool with our hook; the 1% fee is charged and split 70/10/10/10 exactly; a 5% creator tax makes the pool charge 6% and sends the extra to buy-and-burn, not the creator; tax above 5% is rejected; claims pay out and the contract's balance covers every claim and reserve; token buyback refuses when spot is far from the reference and after a big move, then works; dev buy is capped at 5%; the MONSHI buyback is keeper-only with a min-out (tested with a stand-in token); the owner has no withdraw or liquidity-removal function; pausing launches doesn't stop harvest or claims.

A launch costs about **870k gas** (the Uniswap V3 version cost about 8.4M).

## Findings about the live chain
1. **MONSHI has no tradeable liquidity on Uniswap.** The Uniswap V3 MONSHI/WMON 1% pool exists with zero liquidity, and a native-MON/MONSHI V4 pool (1%, spacing 200) exists and is initialised but has **zero active liquidity**. A MONSHI buyback cannot fill today; the 10% MONSHI share waits safely in `monshiReserve`. Seed real MONSHI liquidity (the V4 pool that already exists is the natural place), then `proposeMonshiPool(10000, 200)`, wait 48 hours, `executeMonshiPool()`, set a keeper.
2. Uniswap V4 contracts are deployed on Monad (PoolManager `0x188d586d…`, StateView `0x77395f3b…`).

## Honest limits and open decisions
1. **A second pool can still exist.** Nothing stops someone creating another pool for the same token on another DEX (or a V4 pool without our hook). The supply is locked in our pool, so a rival pool has to buy tokens from us first and pay our fee, but volume can still leak to a cheaper pool. Only a transfer-restricted or tax token could prevent that, at a real cost in compatibility and trust.
2. **Buybacks pay the fee too.** A buyback swap pays the pool fee, and part of that comes back through `harvest` as creator and platform share. It lowers burn efficiency by about the base fee.
3. **Uniswap can turn on a protocol fee** for pools (governance switch, currently off). That would take a slice of the fee before it reaches us.
4. **Aggregator and front-end support for V4 and hooks** (Monorail, DexScreener) is unverified; DexScreener indexing of V4 on Monad needs checking before launch.
5. **Keeper needed:** harvest and the buybacks only run when someone calls them. Run a bot.
6. **Trust points:** owner (can pause new launches, change the platform address, creation fee and keeper, and re-point the MONSHI pool after 48h) and keeper (MONSHI buybacks only; cannot take funds). Use a multisig as owner.
7. A creator tax of up to 5% makes the total fee up to 6%: the UI must show it clearly before anyone buys.
8. Untested: very high volume, extreme price ranges, interaction with every router, gas under Monad's fee model, long-run accounting. **Needs an independent audit.**

## Still to do (frontend and bot are not wired to this yet)
- `/create`: call `launch(name, symbol, salt, creatorTaxBps)` with `msg.value` = fee + dev buy; add a creator-tax field and show the total fee.
- Token page trades through the V4 pool (Universal Router) and shows the fee; chart/volume from the PoolManager's `Swap` events.
- Creator earnings page (`claimable`, `claim`, `harvest`).
- Telegram buy bot: watch the PoolManager's `Swap` events for our pool ids.
- A keeper for `harvest`, `buybackToken` and `buybackMonshi`.
