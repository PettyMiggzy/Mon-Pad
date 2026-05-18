# Batch 2c — Token Detail + Create + Swap + Admin

**Standing rule (session-wide):** No dev server bouncing. Compile + build verification only. King eyeballs at the END of the whole batch. No `npm run dev`, no `pkill`, no "refresh your browser" suggestions. Verification bar = `npx tsc --noEmit -p .` clean **+** `npm run build` clean.

**Pickup order:** This contract starts the moment `CONTRACT-sparkline.md` lands clean (both checks pass, King has the outputs).

---

## File 1: `pages/token/[address].tsx` (NEW, ~600 lines)

Biggest page in the build. Single-file, sectioned.

### Data fetching
- Read `address` from `router.query`
- `useEffect` to call `api.getToken(address)` once on mount
- `useTokenUpdates(address)` for live updates
- Parallel fetch `api.getTrades(address)`, `api.getCandles(address, timeframe)`, `api.getComments(address)`
- Loading skeleton if any of token/trades/candles undefined

### Layout (desktop)
```
+----------------------------------------------------------+
| Token Header (image | name+symbol+creator | links/socials)|
+----------------------------------------------------------+
| Big chart (TradingView Lightweight) | Buy/Sell Panel     |
| ~500px tall                          | ~360px wide       |
+----------------------------------------------------------+
| Graduation Progress Bar (full width, sticky if near grad) |
+----------------------------------------------------------+
| Tabs: Trades | Comments | Holders                         |
| (active tab content below)                                |
+----------------------------------------------------------+
```
**Mobile:** stack header → chart → buy/sell panel → grad progress → tabs → tab content. Buy/sell becomes a sticky bottom drawer (slide-up handle).

### Chart subsection
- `lightweight-charts` (already in deps from Batch 1)
- Candle data from `api.getCandles(address, tf)`
- Timeframe selector: 1m / 5m / 15m / 1h / 4h / 1d (default 5m)
- Brand purple theme: up `#A855F7`, down `#7C3AED`, grid `rgba(139, 92, 246, 0.05)`
- Volume bars below candles, color-coded by side
- Pinch-zoom enabled (mobile)

### Buy/Sell Panel
- Two tabs at top: BUY / SELL
- Input field: amount (MON for buy, tokens for sell)
- Quick-pick chips: `0.1 / 1 / 10 / 100 / MAX` MON for buy; `25% / 50% / 75% / 100%` for sell
- Live quote preview using `previewBuy()` / `previewSell()` from `lib/curve`
- Use `BUY_FEE_TOTAL_BPS` / `SELL_FEE_TOTAL_BPS` from constants for fee-off-top math
- Slippage: `1% / 5% / 10%` chips + custom field
- Big buy/sell button at bottom (brand purple bg)
- Disabled state if wallet not connected → shows `ConnectButton` instead
- On submit: wagmi `useWriteContract` against `curveAddress` with abi from `lib/abis/MonPadCurveV2.json`
- Toast/banner for tx pending, confirmed, failed

### Graduation Progress Bar
- Full-width row showing `monRaisedNet / 425_000` as percentage
- Brand purple gradient fill
- Text overlay: "X of 425,000 MON" + "%.1f%% to graduation"
- When ≥95%: pulsing glow, "NEAR GRADUATION" label
- When graduated: "🎓 Graduated to LP" + link to V3 pool on a DEX explorer
- Hidden if loading

### Tabs

**Trades tab:**
- List of recent trades, newest first
- Columns: side (buy/sell pill) | wallet (shortAddr, link to `/profile/[wallet]`) | MON amount | tokens | price | ago
- Auto-update from `useTradeFeed()` filtered to this token
- Show ~50 most recent; "Load more" button below

**Comments tab:**
- List of `Comment[]` from `api.getComments(address)`
- Each comment: wallet (shortAddr or displayName) | text | ago | reply button
- Threaded replies (`parentId`)
- Compose box at top: textarea + optional image upload + "Post" button
- On post: prompt user to sign a message via wagmi `useSignMessage`, then `api.postComment(...)` with signature
- Disabled if not connected → "Connect wallet to comment"

**Holders tab:**
- Simple bubble visualization (rolled our own, no Bubblemaps)
- Each holder = a circle, size proportional to holding %
- Color: creator = gold, top 10 = brand purple, rest = muted purple
- Hover tooltip: wallet shortAddr + holding amount + % of supply
- Layout: pack circles roughly in a grid, no fancy clustering
- Below the bubbles: a sortable list (rank | wallet | holding | % supply)
- Data source: `api.getHolders(address)` (NEW method — see below)

### Creator-only actions
Only visible if `useAccount().address === token.creator`:
- "Claim creator fees" button (calls `curve.claimCreatorRewards()`)
- "Claim graduation reward" button (only after graduated, calls `curve.claimGraduationReward()`)
- Both show the pending amount above the button

---

## File 2: `pages/create.tsx` (NEW, ~400 lines)

Three-section vertical form.

### Section 1: Token identity
- Name input (1-32 chars)
- Symbol input (1-8 chars, auto-uppercase)
- Image upload (drag-drop area, max 2MB, jpg/png/gif)
- Description textarea (optional, max 500 chars)
- Twitter / Telegram / Website (optional)

### Section 2: Launch parameters
Display the locked-in values (read from constants):
- Creation fee: 100 MON
- Graduation target: 425,000 MON
- Buy fee: 2% (1% creator + 1% platform)
- Sell fee: 2% (1% platform + 0.5% creator + 0.5% staking)
- Creator graduation reward: 25,000 MON
- Subtle "(these are protocol constants, not adjustable)" copy

### Section 3: Review + Launch
- Summary card with all entered values
- Total cost: 100 MON + estimated gas
- Big "Launch Token" button (brand purple)
- On submit: wagmi `useWriteContract` → `factory.createLaunch(name, symbol, ...)` with `value: parseEther("100")`
- Pending state, confirmed state with link to new token page

### Image upload backend
- Stub: `api.uploadImage(file): Promise<{ url: string }>` — calls `INDEXER_URL/api/upload` with multipart
- In `MOCK_MODE`: returns `{ url: 'data:image/...base64...' }` immediately
- Indexer will store images at S3 / IPFS later (out of scope for 2c)

---

## File 3: `pages/swap.tsx` (NEW, ~250 lines)

Generic token swap powered by Monorail Pathfinder API.

### Layout
- Center column, ~480px wide on desktop
- "From" token selector + amount input
- Swap-arrow icon (rotates on click)
- "To" token selector + amount output
- Slippage / deadline settings (collapsed by default)
- Quote details: rate, price impact, fee, route hops
- Big swap button

### Token selector
- Modal/popover with search field
- Common tokens at top (MON, WMON, MONSHI)
- Then alphabetical list of all Monad tokens (fetched from Monorail's `/tokens` endpoint)
- Each token row: image | symbol | name | balance (if connected)

### Pricing
- Debounced (300ms) call to Monorail `/quote` endpoint on input change
- Loading spinner during fetch
- Display all relevant fields from response

### Submit
- Monorail returns transaction data (to, data, value)
- wagmi `useSendTransaction` with that data
- Standard pending/confirmed/error states

---

## File 4: `pages/admin.tsx` (NEW, ~350 lines)

Admin-only. Gates on `isAdmin(address)`. Redirects non-admins to `/`.

Sections (collapsed by default, click to expand):

### Factory controls
- Display current values (read on mount): `platformWallet`, `treasuryWallet`, `buybackWallet`, `graduator`, `rewardRouter`, `poolFactory`
- "Propose change" buttons for each (modal with new-value input + timelock countdown explanation)
- Pause / Unpause buttons

### Hub controls
- Current `distributeInterval`, `distributeThreshold`, `monshiToken`
- "Force distribute" button (emergency action)
- "Update reward router" timelock action

### PoolFactory controls
- List of registered pools
- "Clear token pool" button (emergency action, requires sweep-first warning)

### Bug reports
- Read from `api.listBugs({ wallet, signature, message })` — admin must sign an `ADMIN_AUTH:{timestamp}` message
- List: id | description | wallet | ts | status (new/triaged/resolved)
- Status change buttons per row
- Notes textarea per row

### Stats dashboard
- Total tokens launched
- Total graduated
- Total volume (all-time)
- Total fees collected (platform/treasury/buyback)
- Charts: tokens launched per day, volume per day

All factory/hub/poolFactory writes use wagmi `useWriteContract` with abis from `lib/abis/`.

---

## Supporting additions

### `lib/api.ts` additions
```ts
export type Holder = {
  wallet: string;
  amount: string;        // wei
  pctOfSupply: number;   // 0-1
  isCreator: boolean;
};

// Add to api object:
getHolders: async (addr: string): Promise<Holder[]> =>
  MOCK_MODE ? mocks.mockHolders(addr) : http(`/api/token/${addr}/holders`),

uploadImage: async (file: File): Promise<{ url: string }> => {
  if (MOCK_MODE) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ url: reader.result as string });
      reader.readAsDataURL(file);
    });
  }
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${INDEXER_URL}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
},
```

### `lib/mocks.ts` additions
```ts
export async function mockHolders(addr: string): Promise<Holder[]> {
  // Generate 20 mock holders
  // First holder = creator with 5-15% of supply
  // Top 5 = "whales" with 3-8% each
  // Rest = small holders with <1% each
  // Returns array sorted by amount desc
}
```

### `lib/constants.ts` additions
```ts
export const MONORAIL_API = process.env.NEXT_PUBLIC_MONORAIL_API || 'https://pathfinder.monorail.io';
export const MONORAIL_PARTNER_ID = process.env.NEXT_PUBLIC_MONORAIL_PARTNER_ID || '1176408161626';
```

---

## Execution sequence

1. **lib additions first** (`api.ts`, `mocks.ts`, `constants.ts`) — small sed-inserts, diff-check each
2. `pages/token/[address].tsx` — biggest file, write in one heredoc
3. `pages/create.tsx`
4. `pages/swap.tsx`
5. `pages/admin.tsx`
6. `npx tsc --noEmit -p .` — must be clean
7. `npm run build` — must be clean, surface bundle sizes
8. Surface compile-clean + build output, **stop**. No dev server.

**Estimated time:** 2-4 hours of focused work. Pause for any design call you can't resolve from the contract alone.

**No dev server bouncing. King eyeballs the whole batch when complete.**
