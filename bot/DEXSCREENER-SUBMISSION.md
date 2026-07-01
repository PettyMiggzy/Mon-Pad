# Getting Mon-Pad tokens on DexScreener

Verified against DexScreener docs (docs.dexscreener.com). Monad chain string is `monad`.

## Path A — graduated tokens (automatic, free) ✅
Once a Mon-Pad token graduates to an **official Uniswap V3** pool on Monad, DexScreener
indexes it automatically — no submission, no fee, no adapter.

DexScreener rule (verbatim): *"All tokens are listed on DEX Screener automatically as
soon as they are added to a liquidity pool and have at least one transaction."*

Requirements:
1. Graduate into the **official** Uniswap V3 factory (already wired — graduator
   `0xE27E3E0D…` → factory `0x204fAca…`).
2. Pool has liquidity **and ≥ 1 trade** (a single buy triggers it — confirmed live
   with FAS: pool `0xaf33f2c7…` appeared after one swap).
3. Nothing else. Appears within minutes (no contractual SLA).

Optional cosmetic: **Enhanced Token Info** (logo/socials/description + locked-supply
market cap) — `https://marketplace.dexscreener.com/product/token-info`, ~$299 (from
$499). Not required for indexing.

## Path B — pre-graduation bonding curve (needs a request)
The custom bonding curve is **not** guaranteed to auto-index (it isn't a standard
Uniswap pool). There is **no self-serve adapter/ABI-upload path** — the only
documented channel is a **Discord curation request**.

To maximize the odds:
1. Best chance of auto-indexing: have the curve emit **Uniswap-V2-compatible `Swap` +
   `Sync` events** and expose reserves so the standard indexer can treat each curve as
   a "pair." *(Inferred, not documented — confirm in the request.)*
2. Meet DexScreener's curation bar (verbatim: *"DEXes with low liquidity and volume may
   not be listed at all"*): meaningful liquidity + volume, **open-source + audited**
   contracts, active community.
3. Submit a **DEX listing request in the DexScreener Discord** —
   `https://discord.gg/wpV9vZsbR4` (verbatim: *"Please use our Discord channel to submit
   a DEX listing request."*). Include: launchpad name, chain (Monad / `monad` / EVM 143),
   factory + curve addresses, the exact events emitted, audit + repo links, and
   liquidity/volume evidence. Ask directly: *can you index the pre-graduation curve, or
   should we emit Uniswap-compatible events?*

No documented listing fee; no published review SLA.

## Marketing layers (optional, not indexing)
- **Token Boosts** — trending-score multiplier (12–24h), Golden Ticker at 500+ active
  boosts. Bought via the yellow **Boost** button on the token's DexScreener page
  (desktop). `https://docs.dexscreener.com/boosting` (tier pricing not officially
  published; unofficial ~$99–$3,999).
- **Trending is organic** (volume/liquidity/txns/unique makers/holders/etc.) — you can't
  buy a slot, only multiply via Boosts. Paid ad placements exist on the marketplace.

## Bottom line
- **Graduated → auto-indexed, free, nothing to do.**
- **Pre-grad curve → emit Uni-V2 `Swap`/`Sync` + open a Discord curation request.**
- Our own bot + monpad.net don't depend on DexScreener — they read the curve/pools
  on-chain — so trending works immediately; DexScreener is the external distribution layer.
