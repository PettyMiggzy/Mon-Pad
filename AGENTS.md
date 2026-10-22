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

Display **80 / 10 / 10**. Source of truth: `lib/fees.ts`.

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
| MCP | `mcp/server.mjs` |

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
