# Monpad — agent playbook

Fair launches on Monad. Liquidity on **Uniswap V3**. Every trade feeds Monshi.

Site: https://www.monpad.net · Spec: `/api/v1/spec` · Burns: `/api/v1/burn`

---

## Model (Minta reskin)

Monpad inherits the **Minta** pattern: **no bonding curve**. Listing/UI is the site; **money + fees** flow through **Uniswap V3 LP**.

---

## LP fee split (buys & sells — off Uniswap V3 LP fees)

Pool fee tier: **1%** (`POOL_FEE = 10000` on Uniswap V3).

| Share | BPS | Destination |
|---|---|---|
| **Creator** | **8000 (80%)** | Creator headline share (**includes** nested 10pt project-token burn) |
| ↳ nested burn | 1000 | Inside the 80% — launched token → `dEaD` |
| **Platform** | 1000 (10%) | `0x5899…5914` — MON/quote only on sells |
| **Burn MONSHI** | 1000 (10%) | Buyback-and-burn Monchi |

Display the four slices from `lib/fees.ts` (`LP_FEE_SLICES`): **70% creator payout / 10% platform / 10% burn MONSHI / 10% burn project token**. The on-chain creator headline is 80% because the project-token burn is nested inside it. Do not hardcode the percents in UI.

The home hero is a full-bleed 3D stage (Monshi on the logotype). That is intentional.

Optional **dev bot**: atomic first buy in `createLaunch` (Minta `firstBuy` pattern).

---

## How an agent should integrate

### 1. Discover (read-only, no key)

```bash
curl -s https://www.monpad.net/api/v1/spec | jq .
curl -s https://www.monpad.net/api/v1/burn  | jq .
```

### 2. Surfaces

| Surface | Path |
|---|---|
| HTTP | `/api/v1/spec`, `/api/v1/burn`, `/api/v1/storage` |
| SDK | `sdk/` (`@monpad/sdk`) |
| MCP | `mcp/server.mjs` (`@monpad/mcp`, Uniswap V4 launcher) |

### MCP (V4)

Package: `mcp/` → **`@monpad/mcp`** (`npx -y @monpad/mcp`). Targets **MonpadHookLauncher** (no curves). Set `MONPAD_LAUNCHER`, `MONPAD_HOOK`, and `MONPAD_V4_ROUTER` when deployed; empty config returns *contracts not deployed yet*. Default **`dryRun: true`** (no key); **`MONPAD_PRIVATE_KEY`** burner for broadcast. Caps: `MAX_MON_PER_TX` / `MAX_MON_PER_DAY` (includes sell proceeds). See `mcp/README.md` and `CONTRACT-UV4.md`.

### 3. Storage (token PFPs — same as original pad)

| Path | Backend |
|---|---|
| `POST /api/upload` | Supabase Storage bucket **`images`** |
| `GET/POST /api/token-meta` | Supabase table **`token_meta`** |
| Probe | `GET /api/v1/storage` |

Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Vercel. Schema: `supabase/schema.sql`.

### 4. Clean board

Tokens are **on-chain from the factory**. Deploy a new factory (`hardhat-test/scripts/deployV3.js`), set `NEXT_PUBLIC_FACTORY_V3` + `NEXT_PUBLIC_GRADUATOR_V3`, redeploy frontend. See `docs/REDEPLOY.md`.

### 5. RPC

Server-only: `RPC_URL` (primary) + `RPC_URL_FALLBACK` (Alchemy). Never `NEXT_PUBLIC_RPC_*`.

---

## Safety / mainnet gate

Two clean audit passes + E2E bots before calling fee logic production-final.  
**Never** commit private keys. Meshy key stays in `.env.local` (gitignored).

---

## File map

| Path | Role |
|---|---|
| `lib/fees.ts` | Protocol BPS + platform wallet + LP copy |
| `pages/api/v1/spec.ts` | Public JSON policy |
| `hardhat-test/contracts/v3/MonPadGraduatorV3.sol` | Uniswap V3 LP seed (`POOL_FEE = 10000`) |
| `docs/PROTOCOL.md` | LP + Uniswap V3 fee notes |

---

## Cursor Cloud specific instructions

- Node **24** (`.nvmrc`, `package.json` `engines`). Source nvm and `nvm use 24` before install or dev; the base image may still have Node 22 earlier on `PATH`.
- Three dependency installs: `npm ci` at the repo root, `npm ci --prefix hardhat-test`, and `npm install --prefix mcp` (`mcp/` has no lockfile). `curve-testrig/` and `bot/` are optional and are not started (research rig, and the bot needs Telegram secrets).
- Dev server: `RPC_URL=https://rpc.monad.xyz npm run dev -- --hostname 0.0.0.0 --port 3000`. Hello-world checks are `GET /api/v1/spec` (policy JSON) and `GET /api/v1/burn` (live Monshi burn from the public Monad RPC).
- An unset `NEXT_PUBLIC_FACTORY_V3` is a valid empty board: the home copy is “Launches open when the factory goes live.” `/api/v1/storage` returns 503 until `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. WalletConnect stays limited until `NEXT_PUBLIC_WC_PROJECT_ID` is set.
- Protocol tests need no RPC: `npm test` in `hardhat-test`. `npm run build` is the production build (`typescript.ignoreBuildErrors` is on). `npx tsc --noEmit` currently fails in `sdk/src/index.ts` on a pre-existing viem client type error.
