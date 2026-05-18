# Mini Sparkline on TokenCard — Frontend Claude Contract

**Target:** ~30 min. Adds pump.fun-tier visual life to homepage grid.

## Visual
- 7-day price trend line, ~60px tall, full width of card
- Renders BETWEEN symbol/name row and stats rows (MC / 24h Vol)
- Hand-rolled SVG — no recharts overhead for a 60-line widget
- Color: green `var(--ok, #4ADE80)` if final > start, red `var(--err, #F87171)` if final < start, muted gray if flat
- Stroke width: 1.5
- Smooth Catmull-Rom curve through points (or polyline if Catmull is too much code — polyline is fine)
- Subtle gradient fill under line (same color, 0.1 alpha) — pump.fun energy
- Padding inside SVG: 4px each side

## Data
- New optional field on `TokenSummary` type: `sparkline?: number[]` — ~30 price points (last 7 days, ~4 points/day)
- Add to `mocks.ts`: generate plausible random-walk series for each of the 18 SAMPLE tokens. Mix it up — some up-trending, some down-trending, some flat — so homepage looks varied
- TokenCard reads `token.sparkline ?? []` — if empty, hide sparkline section entirely (no empty SVG)

## Implementation order
1. Sed-add `sparkline?: number[]` to `TokenSummary` in `lib/api.ts` (one-line additive, diff-check)
2. Edit `lib/mocks.ts` SAMPLE generation to attach sparkline array per token (random walks: up/down/flat mix)
3. Add a `<Sparkline>` subcomponent INSIDE `TokenCard.tsx` (don't make a separate file — only used here)
4. Render between name/symbol row and stats rows
5. `npx tsc --noEmit -p .` clean
6. `npm run build` clean
7. NO dev server. Stop here. Surface both clean outputs to King.

## Design polish (optional, your call)
- Tiny dot at last point of line ("current price" indicator)
- Pulsing glow on the dot if you can keep it cheap

**Surface diff for `api.ts` first, then proceed.**

---

## Session standing rule (applies to ALL contracts from here)
- **DO NOT** run `npm run dev`
- **DO NOT** `pkill` anything
- **DO NOT** suggest King restart his dev server or refresh the browser
- Dev server stays stale between batches. King will spin it up himself when the full feature set is done.
- Verification per task = `npx tsc --noEmit -p .` clean **+** `npm run build` clean. That's the entire bar.
