# Monpad Agent Trading: any token, any chain (scope)

Status: scoping only. Nothing built. Verdict: **feasible**, built on third-party aggregators and data APIs, not on our own contracts per chain.

## What we'd ship
A tool set (MCP + SDK, same shape as today's `@monpad/mcp`) that lets a user's AI agent:
1. **Find** a token on any supported chain (search, price, liquidity, top pools).
2. **Check** it for scams (honeypot, sell-tax, mint/blacklist powers, thin liquidity).
3. **Quote** a buy or sell, showing the full cost including our 1%.
4. **Trade** it from the user's own wallet, with a minimum-out, a dry run by default and spend caps.

Monpad tokens keep their own path (our router, fee enforced by the hook). The 1% applies only to third-party tokens, so there is no double fee.

## Building blocks (what exists today)

| Need | Provider | What I verified | Open question |
|---|---|---|---|
| Token/pool data, many chains | GeckoTerminal / CoinGecko onchain API | Live call returned 126 networks, including `monad`; Monad USDC resolves by address | Rate limits and paid tier needed at volume; API is in beta |
| Second data source | DexScreener | Live call returned 30 Monad pairs for Monad USDC | Terms for commercial use |
| EVM swaps + our fee | 0x Swap API (`swapFeeRecipient`, `swapFeeBps`, `swapFeeToken`, max 1000 bps) | Docs confirm fee params. A Nov 2025 changelog says Monad is supported | Not tested live (needs an API key). Confirm Monad is still listed |
| Cross-chain / bridging + fee | LI.FI (`integrator` + `fee` as decimal, e.g. 0.01) | Docs confirm fees on supported chains | Monad fee support not confirmed. Docs conflict on whether fees pay out instantly or sit in a collector contract |
| Solana swaps + fee | Jupiter (referral fee 50-255 bps; Jupiter keeps 20% of ours) | Docs confirm | Needs a referral account and a token account per fee mint, or fees are silently skipped |
| Scam checks | GoPlus token security API (honeypot, mint, owner, tax) | Coverage claimed at 19-40+ chains depending on the source | Check Monad coverage before relying on it; backstop with our own simulation |

Not covered: Bitcoin and non-EVM chains other than Solana. Chains with no aggregator need a per-chain adapter.

## How the 1% works
- 1% = 100 bps, well under 0x's 1000 bps cap. It is taken inside the swap and paid to a Monpad fee wallet, so we deploy no contracts.
- The fee comes out of the sell or buy token of each trade, so we receive many small token balances, not USDC. We need a sweep job to consolidate, or we choose a stable `swapFeeToken` where the API allows.
- The 1% stacks on the DEX fee and the aggregator's own fees. The quote shown to the agent must list every layer. Comparable trading bots charge about 1%, so this is market-rate, not low.
- Jupiter's 20% cut means we net 0.8% of our 1% on Solana.

## Safety (the real engineering)
Agents will be pointed at random tokens. Required before any send:
1. **Simulate a buy and a sell** on a fork or via `eth_call`. Refuse if the sell reverts or the round-trip loss exceeds a threshold. This catches honeypots independent of GoPlus.
2. **Reputation check** with GoPlus (and a second source). Refuse on blacklist-able, mintable-by-owner or high-tax tokens unless the user overrides.
3. **Liquidity floor and price-impact cap**, with a hard minimum-out.
4. **Spend caps** per trade and per day, per chain (as the MCP has now), and a dry run by default.
5. **Allowlist of spenders**: approve only the aggregator's current router, and exact amounts, never unlimited.
6. **Prompt-injection hardening**: token names and descriptions are untrusted text read by the agent. Tool results must label them as data.

## Wallet model: non-custodial
The user supplies a burner key to their own machine, as with the current MCP. We never hold keys or funds. This keeps us a software/interface provider. Custodial agent wallets (we hold keys, trade for users) are a different business: money-transmission and securities exposure, plus a large hack target. **Do not start there.** Counsel should review before we charge a fee on third-party trading in any jurisdiction we serve.

## Phases
1. **Monad only (about 1-2 weeks).** Data via GeckoTerminal + DexScreener, trades via 0x with the fee, the full safety stack, new MCP tools (`find_token`, `check_token`, `quote_swap`, `swap`). Proves the fee flow and the safety checks on the chain we know.
2. **More EVM chains (about 1 week each, mostly config).** Base, Ethereum, Arbitrum, BNB and others where 0x and GoPlus both cover them.
3. **Solana via Jupiter (about 1-2 weeks).** Different wallet and transaction model, so a separate adapter.
4. **Cross-chain via LI.FI** once fee behavior is confirmed.
5. **Site UI**: a page where a user connects, picks a chain and token, and their agent gets a scoped session. This depends on how the agent connects (local MCP vs hosted).

## Risks and unknowns
- Aggregators change fee rules and chain lists; we depend on their API keys and uptime.
- A hosted version (the site runs the agent) means holding keys or session permissions, which pushes toward custody. A local MCP does not.
- Fee income depends on volume, and the market is crowded.
- GeckoTerminal is free but beta; plan for a paid key.

## Decisions needed
1. Local MCP/SDK only first, or a hosted site experience too?
2. Phase 1 on Monad only, or EVM-wide from the start?
3. Fee wallet and sweep policy (receive in whatever token vs force a stable).
4. Legal review before launch.

## Launch chains (update)

| Chain | Data (GeckoTerminal / DexScreener) | Swap + fee | Notes |
|---|---|---|---|
| Monad | yes / yes (verified live) | 0x lists Monad | One search snippet gave chain id 10143 (Monad testnet); mainnet is 143. Verify the 0x chain id before building |
| Base | yes (`base`) / yes | 0x supports Base | Safest chain to add second |
| Robinhood Chain | yes (`robinhood`) / yes (pairs seen) | Not confirmed in 0x or LI.FI | Arbitrum-based L2; public mainnet since 2026-07-01 per press. Trading is on a dedicated Uniswap AMM, so a direct Uniswap-router adapter may be needed |
| Arc (Circle) | yes (`arc`) / yes (pairs seen) | Not confirmed | Public mainnet was announced for 2026-09-16 (not verified it happened). USDC is the gas token, so fee and gas handling differ. DEX depth unknown |
| "vyrem" | not found in GeckoTerminal | unknown | Need the real chain name |

Plan: ship Monad + Base on 0x first (same adapter, config change). Robinhood and Arc each need a liquidity and router check first; if 0x does not cover them, add a direct Uniswap V3/V4 router adapter (we already know V4 from Monpad), with our own fee wrapper contract or a fee taken in the adapter.
