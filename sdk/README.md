# @monpad/sdk

TypeScript SDK for [Monpad](https://www.monpad.net) on Monad mainnet. List coins, quote, buy, sell and launch on the Uniswap V4 pad. Pay and receive **MON or USDC**; the router converts for you. Built on viem.

```bash
npm i @monpad/sdk viem
```

```ts
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createMonpad } from '@monpad/sdk';

const chain = { id: 143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } } };
const publicClient = createPublicClient({ chain, transport: http() });
const walletClient = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain, transport: http() });
const monpad = createMonpad({ publicClient, walletClient }); // Monad mainnet addresses are built in

const { launches } = await monpad.listLaunches({ limit: 5 });
const token = launches[0].token;

await monpad.buy({ token, monIn: parseEther('0.5') });                 // min-out is set from a live quote (1% slippage)
await monpad.sell({ token, tokensIn: 1000n * 10n ** 18n });             // receive MON (default) or { receive: 'usdc' }
await monpad.launch({ name: 'Milk Baron', symbol: 'MILK', creatorTaxBps: 200, devBuyMon: parseEther('2') });
```

No wallet? Reads and quotes still work: `createMonpad({ publicClient })`.

## API

| Call | What it does |
|---|---|
| `listLaunches({ limit })` | Newest coins with price (USD), market cap, creator tax and pool id |
| `getToken(token)` | One coin. Throws `NotAMonpadToken` for anything else |
| `quoteBuy({ token, monIn \| usdcIn })` | Tokens you would get. Works without a wallet |
| `buy({ token, monIn \| usdcIn, slippageBps?, minTokensOut?, simulate? })` | Buys. Handles the USDC approval. Reverts below the minimum |
| `quoteSell({ token, tokensIn, receive? })` / `sell({ ... })` | Same for selling. Handles the token approval |
| `launch({ name, symbol, creatorTaxBps?, devBuyMon \| devBuyUsdc?, simulate? })` | Free launch with an optional first buy. Tax 0 to 500 bps |
| `claimable(account, asset)` / `claim(asset)` | Creator earnings (USDC or a coin you launched) |
| `harvest(token)` | Splits the fees a pool has earned. Anyone can call it |
| `getMonshiBurned()` / `getSpec()` / `monPriceUsd()` | Burn counter, fee policy and addresses, MON price |

Every write takes `simulate: true` to run against the chain without sending. Errors are typed: `SlippageExceeded`, `DeadlineExpired`, `Paused`, `NotAMonpadToken`, `WalletRequired`.

Override any contract with `createMonpad({ addresses: { launcher, hook, router, ... } })`.

## Test

`FORK_URL=http://127.0.0.1:8545 npm test` runs 18 checks against a local fork of Monad mainnet (see `test/fork.mjs`).
