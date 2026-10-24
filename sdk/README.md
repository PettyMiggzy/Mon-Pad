# @monpad/sdk

TypeScript SDK for **Monpad Uniswap V4** on Monad. **viem** is the only dependency (peer). No bonding curves — trades go through `MonpadV4Router`.

> **Not published to npm in this repo.** Install from the monorepo: `npm install file:../sdk`.

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
import { createMonpad, parseEther } from '@monpad/sdk';
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
const spec = await monpad.getSpec();
const launches = await monpad.listLaunches({ limit: 10 });
const token = await monpad.getToken('0x…');

// Quote (simulates router)
const q = await monpad.quoteBuy(token.token, parseEther('1'));

// Trade — simulate by default; set simulate: false to send
await monpad.buy(token.token, parseEther('0.5'), { slippageBps: 100, simulate: true });

// Launch
await monpad.launch({ name: 'My', symbol: 'MY', creatorTaxBps: 100, simulate: true });
```

## Safety defaults

- **`simulate: true`** on `launch`, `buy`, `sell` (dry-run via `simulateContract`).
- **`maxMonPerTx`** guard (default 5 MON, env `MAX_MON_PER_TX`).
- **`minTokensOut` / `minMonOut`** never zero on sends; quotes include slippage-adjusted `minOut`.
- Typed errors: `SlippageExceeded`, `DeadlineExpired`, `PoolNotFound`, `Paused`, `ContractsNotDeployed`, `MaxMonExceeded`.

## Addresses & fees

No hardcoded platform wallet or Monpad contract addresses in `src/`. Resolution order:

1. `createMonpad({ addresses })`
2. Env (`MONPAD_LAUNCHER`, `MONPAD_HOOK`, `MONPAD_V4_ROUTER`, …)
3. `GET /api/v1/spec` (platform, monshi, dead, fees) + optional future `uv4` block

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | ESM + CJS + `.d.ts` → `dist/` |
| `npm run check:addresses` | CI: fail on `0x…` literals outside `chain-config.ts` |
| `npm test` | Vitest fork tests (needs `FORK_RPC`, `MONPAD_TEST_PRIVATE_KEY`) |

## MCP

The `@monpad/mcp` package can depend on this SDK to avoid duplicating chain logic.
