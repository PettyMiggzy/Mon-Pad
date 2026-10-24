# @monpad/sdk

TypeScript SDK for **Monpad Uniswap V4** on Monad. **viem** is the only dependency (peer). No bonding curves. Every launch pool is **USDC / token**, and trades go through `MonpadV4Router`.

> **Not published to npm.** Install from the monorepo: `npm install file:../sdk`. The contracts are unaudited and not deployed; the SDK targets the USDC-quote launcher and router (PR #36).

## USDC is the quote asset

- Launch fee, dev buy, buys and sells are in **USDC (6 decimals)**. Launch tokens have 18 decimals.
- Native **MON** is only for gas, and for the router's two MON routes (`buyWithMon`, `sellForMon`), which hop through the hookless MON/USDC pool.
- The USDC address comes from `launcher.quoteAsset()`; you do not configure it. (`addresses.quoteAsset` / `MONPAD_QUOTE_ASSET` override it.)
- USDC is a Circle token: it can be **paused** and can **blacklist** addresses. See [USDC pause and blacklist](#usdc-pause-and-blacklist).

## 5-minute quickstart

```bash
cd sdk && npm install && npm run build
export RPC_URL=https://rpc.monad.xyz
export MONPAD_LAUNCHER=0x…      # when deployed
export MONPAD_HOOK=0x…
export MONPAD_V4_ROUTER=0x…
export MONPAD_POOL_MANAGER=0x…  # infra from spec / env
export MONPAD_STATE_VIEW=0x…
export MONPAD_PRIVATE_KEY=0x…   # only for simulate: false
```

```typescript
import { createMonpad, parseUnits, parseEther } from '@monpad/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.MONPAD_PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
  account,
  chain: { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL!] } } },
  transport: http(process.env.RPC_URL!),
});

const monpad = createMonpad({ walletClient, specUrl: 'https://www.monpad.net/api/v1/spec' });

// Read-only
const launches = await monpad.listLaunches({ limit: 10 });
const token = await monpad.getToken('0x…');   // token.approxUsdcPerToken, token.volumeUsdcApprox

// Quote (simulates the router; needs no USDC balance or approval)
const q = await monpad.quoteBuy(token.token, parseUnits('25', 6));

// Buy with USDC. Simulates by default; simulate: false approves exactly usdcIn, then sends.
await monpad.buy(token.token, parseUnits('25', 6), { slippageBps: 100, simulate: true });

// Buy with MON: MON -> USDC (hookless pool) -> token, one transaction
await monpad.buyWithMon(token.token, parseEther('1'), { simulate: true });

// Sell for USDC, or for MON
await monpad.sell(token.token, 1_000_000n * 10n ** 18n, { simulate: true });
await monpad.sellForMon(token.token, 1_000_000n * 10n ** 18n, { simulate: true });

// Launch: creation fee + dev buy are both USDC and approved for you when sending
await monpad.launch({ name: 'My', symbol: 'MY', creatorTaxBps: 100, devBuyUsdc: parseUnits('50', 6), simulate: true });
```

## Methods

| Method | Notes |
|---|---|
| `quoteAsset()` | The USDC address (read from the launcher) |
| `quoteHealth()` | `{ paused, blacklisted: { launcher, router, poolManager }, ok }` |
| `listLaunches`, `getToken`, `trending` | Prices are USDC per whole token; volume is USDC base units |
| `quoteBuy(token, usdcIn)` / `quoteBuyWithMon(token, monIn)` | Simulated; returns `tokensOut` and a slippage-adjusted `minOut` |
| `quoteSell(token, tokensIn)` / `quoteSellForMon(token, tokensIn)` | `usdcOut` / `monOut` |
| `buy`, `buyWithMon`, `sell`, `sellForMon` | `simulate` defaults to `true`; every send has a non-zero minimum out |
| `launch({ devBuyUsdc })` | Dev buy is capped on-chain at 5% of supply |
| `creatorEarnings(account)` | `{ claimableUsdc, perToken }` |
| `claim(asset)` | Pass the USDC address for the USDC payout, or a token for its token-side share |
| `harvest(token)` | Anyone can call; splits the collected LP fees |

On the MON routes `minTokensOut` / `minMonOut` guard the whole trade; the optional `minUsdcOut` guards the MON/USDC leg on its own (default `1`, so set it if you care about that leg).

## Safety defaults

- **`simulate: true`** on `launch`, `buy`, `buyWithMon`, `sell`, `sellForMon` (dry-run via `simulateContract`).
- **`maxUsdcPerTx`** (default 25 USDC, env `MAX_USDC_PER_TX`) and **`maxMonPerTx`** (default 5 MON, env `MAX_MON_PER_TX`).
- Minimum-out values are never zero on sends; quotes include a slippage-adjusted `minOut`.
- Typed errors: `SlippageExceeded`, `DeadlineExpired`, `PoolNotFound`, `Paused`, `ContractsNotDeployed`, `MaxUsdcExceeded`, `MaxMonExceeded`, `InsufficientQuoteBalance`, `QuoteAssetBlocked`.

## USDC pause and blacklist

Circle can pause USDC or blacklist an address. If it blacklists the launcher, the router or the PoolManager, or pauses the token, launches, trades and claims in USDC all revert, and fees already in the launcher cannot be harvested or claimed until it is lifted.

- Dry runs use a simulated USDC balance, which overwrites the slot that also holds the blacklist flag, so a simulation alone would not show a blacklist. The SDK therefore calls `paused()` and `isBlacklisted()` first and throws `QuoteAssetBlocked`.
- A real revert from USDC (`Pausable: paused`, `Blacklistable: account is blacklisted`) is also mapped to `QuoteAssetBlocked`.
- `quoteHealth()` is a cheap probe for bots and monitors. It reports `checked: false` when the quote asset has no such functions (for example a test token).

## Quote simulation and storage layout

To quote without a balance or approval, the SDK overrides USDC storage in `eth_call` only: balances are slot **9** and allowances slot **10** (Circle FiatToken v2; both checked against the live token on Monad). If USDC were upgraded to a different layout, quotes would fail loudly rather than return wrong numbers; update `USDC_BALANCES_SLOT` / `USDC_ALLOWANCES_SLOT` in `src/pool.ts`.

## Addresses & fees

No hardcoded platform wallet or Monpad contract addresses in `src/`. Resolution order:

1. `createMonpad({ addresses })`
2. Env (`MONPAD_LAUNCHER`, `MONPAD_HOOK`, `MONPAD_V4_ROUTER`, `MONPAD_QUOTE_ASSET`, …)
3. `GET /api/v1/spec` (platform, monshi, dead, fees) + optional future `uv4` block (`launcher`, `hook`, `v4Router`, `quoteAsset`)

Fees: every swap pays 1% plus the creator tax (0 to 5%). The base 1% splits 70% creator / 10% platform / 10% MONSHI burn / 10% token burn. On the USDC side these are paid and reserved in USDC; on the token side the creator and platform get 70% / 10% and the rest is burned. The creator tax is entirely buy-and-burn.

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` | ESM + CJS + `.d.ts` → `dist/` |
| `npm run check:addresses` | CI: fail on `0x…` literals outside `chain-config.ts` |
| `npm test` | Vitest fork tests (needs `FORK_RPC`, `MONPAD_TEST_PRIVATE_KEY`, and the USDC-quote contracts from PR #36 in `hardhat-test/`) |

The fork tests need launches to start at the intended price in **both** currency orderings. That depends on the start-tick fix described in the PR #36 review; without it the price assertion in the first test fails.

## MCP

`@monpad/mcp` depends on this SDK so chain logic is not duplicated.
