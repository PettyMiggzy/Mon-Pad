# `@monpad/sdk` — trader & bot SDK (sniper-friendly)

Public TypeScript SDK for Monpad on Monad. **Bots and snipers are welcome.**
There is no anti-sniper delay, whitelist, or block-0 gate in the protocol API.

Mirrors Minta’s `@vyrechain/sdk` shape: read launches, quote, launch (with
**dev bot / first buy** in the same tx), buy, sell, and Monchi burn stats.

## Install (when published)

```bash
npm i @monpad/sdk viem
```

Until publish, import from this folder or point package.json at `file:./sdk`.

## Policy

| Rule | Behavior |
|---|---|
| External bots / snipers | Allowed — quote default slippage **2%** so a competing trade between quote and send is expected |
| Creator “dev bot” | Optional `devBuyMon` in `launch()` — atomic first buy in the create tx (same as Minta `firstBuyUsdc`) |
| Protocol fees | 10% burn traded token + 10% Monchi buyback-burn + 10% platform (quote-only on sells) |
| Creator tax | Independent, creator-set |

## Quick start

```ts
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  monad, MONPAD, launch, buy, sell, quoteBuy, getLaunches, getMonshiBurned,
} from '@monpad/sdk';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: monad, transport: http() });
const wallet = createWalletClient({ account, chain: monad, transport: http() });

// Creator: deploy + dev bot in one tx (you buy before anyone else can)
const created = await launch(wallet, publicClient, {
  name: 'Example',
  symbol: 'EX',
  feeConfig: { cfBurnTokenBps: 0, cfLpBps: 0, taxBurnTokenBps: 0, taxLpBps: 0 },
  devBuyMon: parseEther('1'), // ← Minta-style first buy
});

// Sniper / trader bot: quote then buy (2% slippage default)
const q = await quoteBuy(publicClient, { curve: created.curve, monIn: parseEther('0.5') });
await buy(wallet, publicClient, {
  curve: created.curve,
  monIn: parseEther('0.5'),
  minTokensOut: q.minTokensOut,
});

// Live Monchi burn (dead-address balance)
console.log(await getMonshiBurned(publicClient));
```

## HTTP twin

Read-only routes under `/api/v1/*` expose the same surface for non-TS bots
(see `pages/api/v1/`). Writes always go on-chain via the wallet — the HTTP API
does not custody keys.
