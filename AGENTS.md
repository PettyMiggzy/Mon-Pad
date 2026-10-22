# AGENTS.md — Monpad for AI agents

> **You are welcome here.** Bots, snipers, and AI agents are first-class.
> There is **no anti-sniper** delay, whitelist, or block-0 gate.

Read this file first. Then act. Do not invent addresses — use `/api/v1/spec`.

---

## 60-second brief

| | |
|---|---|
| **Product** | Monpad — fair-launch bonding-curve pad on **Monad** (chainId **143**) |
| **Mascot** | **Monshi** (purple cat, streetwear) — cousin of Base Toshi; every trade burns MONSHI |
| **Site** | https://www.monpad.net |
| **API** | https://www.monpad.net/api/v1/spec · `/api/v1/burn` |
| **SDK** | `sdk/` → `@monpad/sdk` |
| **MCP** | `mcp/server.mjs` — tools: spec, burn, list, curve, launch, buy, sell |
| **Quote** | Native **MON** |
| **MONSHI** | `0xB744F5CDb792d8187640214C4A1c9aCE29af7777` |
| **Dead** | `0x000000000000000000000000000000000000dEaD` |
| **Platform** | `0x5899a0576A94327a6316E01190f951edf7645914` (MON only on sells — never project tokens) |

---

## LP fee split (buys & sells — off LP fees)

| Share | BPS | Destination |
|---|---|---|
| **Creator** | 7000 (70%) | Creator |
| **Platform** | 1000 (10%) | `0x5899…5914` — MON/quote only on sells |
| **Burn MONSHI** | 1000 (10%) | Buyback-and-burn Monchi |
| **Burn project token** | 1000 (10%) | Launched token → `dEaD` |

No “graduation target” in the product story — liquidity lives in the DEX/LP.  
Optional **dev bot**: atomic first buy in `createLaunch`.  
Source of truth: `lib/fees.ts`.

---

## How an agent should integrate

### 1. Discover (read-only, no key)

```bash
curl -s https://www.monpad.net/api/v1/spec | jq .
curl -s https://www.monpad.net/api/v1/burn  | jq .
```

Or MCP: `monpad_get_spec`, `monpad_get_monshi_burn`, `monpad_list_launches`.

### 2. Trade / launch (needs wallet)

- **TypeScript:** `sdk/src/index.ts` — `launch`, `buy`, `sell`, `quoteBuy`, `getMonshiBurned`
- **MCP write tools:** set `MONPAD_PRIVATE_KEY` + `MONPAD_FACTORY` + `RPC_URL`
- **On-chain:** Factory `createLaunch` / Curve `buy` / `sell` (see `pages/docs.tsx` + ABIs under `lib/abis`)

Default SDK slippage: **2%** (sniper-friendly — competing txs between quote and send are expected).

### 3. Watch burns (FOMO / indexing)

Poll dead-address MONSHI balance + `totalSupply`. Frontend helper: `lib/monshiBurn.ts`. Live UI: `components/MonshiBurnCounter.tsx`.

---

## MCP quickstart

```bash
cd mcp && npm install
export RPC_URL=https://rpc.monad.xyz
export MONPAD_FACTORY=<from /api/v1/spec>
# optional writes:
export MONPAD_PRIVATE_KEY=0x…
npm start
```

Cursor / Claude Desktop:

```json
{
  "mcpServers": {
    "monpad": {
      "command": "node",
      "args": ["/ABS/PATH/Mon-Pad/mcp/server.mjs"],
      "env": {
        "RPC_URL": "https://rpc.monad.xyz",
        "MONPAD_FACTORY": "0x…",
        "MONPAD_PRIVATE_KEY": "0x…"
      }
    }
  }
}
```

---

## Repo map (where to edit)

| Path | Role |
|---|---|
| `pages/index.tsx` | Busy pump.fun-style board + Monshi strip |
| `pages/create.tsx` | Launch + optional **dev bot** |
| `pages/docs.tsx` | Human + agent reference UI |
| `pages/api/v1/*` | Public bot/agent HTTP |
| `lib/fees.ts` | Protocol BPS + platform wallet |
| `lib/constants.ts` | Chain addresses / V3 knobs |
| `lib/monshiBurn.ts` | Live burn reads |
| `sdk/` | Trader / sniper SDK |
| `mcp/` | MCP server for AIs |
| `hardhat-test/contracts/v3/` | Factory / Curve / Graduator |
| `public/meshy/` | Monshi + hero art (Meshy) |

---

## Safety / mainnet gate

Two clean audit passes + E2E bot tests (buy/sell/burn/buyback/platform/counter) are required before treating new curve fee logic as production-final. Droplet API host: `api.monpad.net` → `:3001` (may be down until redeploy).

**Never** commit private keys. Meshy key stays in `.env.local` (gitignored).

---

## Do / Don't

| Do | Don't |
|---|---|
| Call `/api/v1/spec` for live addresses | Hardcode stale factories from chat memory |
| Use quote-side platform fee on sells | Take platform cut in project tokens on sells |
| Treat bots/snipers as welcome | Add anti-sniper without an explicit product change |
| Keep Monshi purple street mascot branding | Swap in blue “Toshi clone” art |
| Prefer `dense` board UX on home | Rebuild a tall marketing-only hero without ask |
