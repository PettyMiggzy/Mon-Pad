# Clean redeploy — empty board + keep Supabase PFPs

Tokens on the homepage come from the **on-chain factory**, not the database.
To wipe the junk launches you must **deploy a new Factory + Graduator** and point
Vercel at them. Token profile pictures stay on **Supabase** (same as the original bond pad).

## Storage (do not replace)

Same as the original pad:

| Piece | Where |
|---|---|
| Logo / PFP upload | `POST /api/upload` → Supabase Storage bucket **`images`** |
| Token profile meta | `POST/GET /api/token-meta` → table **`token_meta`** |
| Schema | `supabase/schema.sql` (run once in Supabase SQL editor) |

Vercel env (Production + Preview):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
```

Probe: `GET /api/v1/storage` → `{ ok: true, bucket: "images", table: "token_meta" }`

## Clear the board (new contracts)

```bash
cd hardhat-test
# .env: PRIVATE_KEY, PLATFORM_WALLET=0x5899a0576A94327a6316E01190f951edf7645914
#       TREASURY_WALLET=…  BUYBACK_WALLET=…
#       WMON_ADDRESS=0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
#       NPM_ADDRESS=0x7197e214c0b767cfb76fb734ab638e2c192f4e53   # official Uniswap V3 NPM
#       MONSHI_ADDRESS=0xB744F5CDb792d8187640214C4A1c9aCE29af7777

npx hardhat run scripts/deployV3.js --network monadMainnet
# → prints Factory + Graduator; also writes deployments/v3-143.json
```

Then on Vercel → Environment Variables → Production:

```
NEXT_PUBLIC_FACTORY_V3=0x<new factory>
NEXT_PUBLIC_GRADUATOR_V3=0x<new graduator>
```

Redeploy the frontend. Old test factory `0x45Fb…` is superseded — board shows **only** launches from the new factory (empty until the first create).

## Create flow (PFP)

1. User picks image on `/create` → `/api/upload` → public Supabase URL  
2. After `createLaunch` confirms → signed `POST /api/token-meta` with `imageUrl` + socials  
3. Board + token page load logos via `GET /api/token-meta?addresses=…`

If upload fails with “Image storage not configured”, the Supabase env vars are missing on Vercel.

## RPC (server-only)

```
RPC_URL=https://rpc.monad.xyz
RPC_URL_FALLBACK=https://monad-mainnet.g.alchemy.com/v2/<YOUR_KEY>
```

`/api/rpc` uses primary then fallback. Never set `NEXT_PUBLIC_RPC_*` — that ships the key to browsers.
