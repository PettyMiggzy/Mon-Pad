# Mon-Pad — DexScreener pre-bond indexing (pump.fun-style)

Goal: a token charts on DexScreener **the moment it launches, pre-graduation,
tradable**, exactly like pump.fun — not only after it bonds.

## The mechanism (confirmed)

DexScreener shows pump.fun tokens pre-bond because it has a **dedicated parser
mapped to the pump.fun bonding-curve contract** — it reads the curve's buy/sell
logs and derives price from the curve formula (that's why those pairs have *no*
`liquidity` field: there's no two-sided AMM pool yet). It is NOT automatic for a
new curve. Two things are required:

1. **A curve whose trades are fully derivable from on-chain logs** — deterministic
   on-chain formula + a clean trade event per buy/sell carrying amounts and
   post-trade reserves, plus a per-launch creation event from a consistent
   factory. (This repo's curve already qualifies; the events below make it
   first-class for an indexer.)
2. **DexScreener mapping your curve contract** — requested via their Discord
   (#listings / DEX integration). Because a bonding curve isn't a standard AMM,
   they enable/build a parser for it (or you match a standard close enough for
   their generic parser). Monad (chain 143) is already supported, so this
   contract-mapping is the only gate.

Until (2) is granted, the same events + the Uniswap-V2 read shim already let
other Monad scanners index the curve; post-graduation the real AMM pool charts
automatically.

---

## Event signatures (shape for easy indexer parsing)

Native-MON pad. "Quote" = MON; for USD pricing report **WMON
`0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`** as the quote token (native MON has
no ERC20 address; WMON/USD gives the indexer a USD reference, same way pump.fun
uses WSOL).

### 1. Per-launch creation — emitted by the factory

```solidity
event Launch(
    address indexed token,        // launched ERC20 — the "pair" key
    address indexed curve,        // per-token bonding-curve clone (trades emit from here)
    address indexed creator,
    string  name,
    string  symbol,
    address quoteToken,           // WMON address (USD reference)
    uint256 totalSupply,          // 1e18-scaled
    uint256 virtualMonReserve,    // initial virtual reserves (price basis)
    uint256 virtualTokenReserve,
    uint256 createdAt             // block.timestamp
);
```
The indexer watches the **factory** for `Launch` to discover each new curve clone
(EIP-1167), then subscribes to that curve's `Trade` events.

### 2. Every buy and sell — emitted by the curve (one unified event, pump.fun-style)

```solidity
event Trade(
    address indexed token,            // pair key (same as Launch.token)
    address indexed trader,
    bool    isBuy,                    // true = buy (MON->token), false = sell
    uint256 monAmount,                // gross MON in (buy) / gross MON out (sell), 1e18
    uint256 tokenAmount,              // tokens out (buy) / tokens in (sell), 1e18
    uint256 virtualMonReserve,        // POST-trade — price fully derivable from these
    uint256 virtualTokenReserve,      // POST-trade
    uint256 realMonReserve,           // POST-trade (net raised so far)
    uint256 realTokenReserve,         // POST-trade (unsold supply)
    uint256 priceX18,                 // POST-trade MON-per-token, 1e18-scaled (convenience)
    uint256 tradedAt                  // block.timestamp
);
```
Price is derivable with zero off-chain data:
`price = (virtualMonReserve + realMonReserve) * 1e18 / (virtualTokenReserve - (totalSupply - realTokenReserve))`
(also emitted directly as `priceX18`). Volume = `monAmount`. This mirrors
pump.fun's `TradeEvent` (which carries `solAmount/tokenAmount/isBuy` + virtual &
real reserves) so a generic/cloned parser maps cleanly.

### 3. Graduation / migration — emitted by curve + graduator

```solidity
event Graduate(
    address indexed token,
    address indexed pool,             // the AMM pool the LP migrated to
    uint256 monToLp,                  // MON seeded into the pool
    uint256 tokensToLp,               // tokens seeded (includes all unsold)
    uint256 graduatedAt
);
```
On `Graduate` the indexer transitions the token's page from the curve to the real
AMM pool (same flow as pump.fun → PumpSwap).

---

## DexScreener listing-request package (paste into their Discord)

> **Chain:** Monad (chainId 143)
> **Protocol:** Mon-Pad (bonding-curve launchpad) — request a pre-bond parser /
> dedicated `dexId`, like `pumpfun`, so curve tokens chart before graduation.
> **Factory contract:** `0xf82bFD436ea36515DFF5A6933980F86813D4f3Fa` — emits
> `Launch(...)` per token (discovers per-token curve clones). Verified source.
> **Curve contract (per token, EIP-1167 clone of impl
> `0xf5184f2255797f5AD5fa92Ca273FdBb07EbaB623`):** emits `Trade(...)` on every
> buy/sell with post-trade virtual+real reserves and `priceX18`; deterministic
> on-chain constant-product formula, no oracle. Verified source.
> **Quote token (for USD):** WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`.
> **Price derivation:** `priceX18` field, or
> `(virtualMon+realMon)/(virtualToken-(supply-realToken))`.
> **Graduation:** graduator `0x9770b2a62d719b67E4Be206b0B0158b1448eB666` emits
> `Graduated(token, pool, ...)` and migrates liquidity into a Uniswap V3 pool via
> NPM `0xa9f6B6656e32F223d778b01642F32D00F5310526`; please transition the page to
> that pool post-bond.
> **Event ABIs:** (attach `Launch`, `Trade`, `Graduate` ABI JSON)
> **Examples:** (attach 1 launch tx + 1 buy tx + 1 sell tx hash once deployed)

Provide a verified contract + a few real txs; an indexer integration is far
easier to grant when the events are already live and parseable on mainnet.

---

## Build checklist (so the above is true on-chain)

- [x] Factory emits `Launch` with quoteToken=WMON + initial virtual reserves.
- [x] Curve emits `Trade` (unified, post-trade reserves + priceX18) on buy/sell/devBuy.
- [x] Graduator emits `Graduated` with the AMM pool address.
- [x] All 4 contracts source-verified on the Monad explorer (Etherscan V2, chain 143).
- [ ] **Create the first token** (~500 MON) so there are real `Launch`/`Trade` txs to attach.
- [ ] Submit the listing-request package above to DexScreener (Discord) with those tx hashes.
- [x] Uniswap-V2 read shim present on the curve (fallback for generic scanners).
