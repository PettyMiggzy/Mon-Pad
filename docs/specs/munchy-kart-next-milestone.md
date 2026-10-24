# Munchy Kart: next milestone brief (for Cursor)

Repo path: `public/games/munchy-kart/` (Phaser 3, `game.js` ~290 lines, scenes `Boot`, `Garage`, `Race`; 720x1280 portrait, `Phaser.Scale.FIT`). Save lives in `localStorage` key `mk_save_v1`. Catalog arrays: `CARS`, `BOOSTS`, `UPGRADES`. Zap is `Race.zap()`, cooldown from `save.up.zap`. Currently decor candles are green (`candleG`) and hazards red (`candleR`).

Rules: no secrets or keys in client code. Keep assets small (the site ships them to phones). Keep it working inside the Telegram WebApp wrapper.

## Phase 1: client only (no backend)

1. **Desktop shows the mobile version.** On screens wider than ~600px render the game inside a centered phone frame (9:16, rounded bezel, dark page around it, optional side panel with title, controls help and link to monpad.net). Touch controls stay on mobile; desktop also supports keyboard (arrows/A-D steer, Space zap, N nitro). Acceptance: 1920x1080 browser shows a phone-shaped game, no stretched canvas; real phone fills the screen.
2. **Zap is a green candle.** The projectile is a green candle (the good candle), visually the opposite of the red-candle hazard. Muzzle flash at the car, trail, and a hit effect on rivals/hazards. Acceptance: a player can tell at a glance green = mine, red = bad.
3. **Better animations.** Shooting recoil on the car, projectile spawn/trail/impact particles, rival spin-out/explosion when zapped, milk pickup pop and counter bump, nitro flame and speed lines, screen shake on hits, shield bubble. Keep 60 fps on a mid phone; use particle emitters, not many sprites.
4. **Loadout screen** (rework `Garage`): tabs for Cars, Power-ups, Upgrades. Players spend **milk** here. Show owned/equipped state, price, a stat bar preview per car, and an equip button. Power-ups equipped before a race: nitro, shield, magnet, plus new ones (see 5). A "slots" limit (e.g. 2 power-ups per race) makes choices matter.
5. **More power-ups** (data-driven in `BOOSTS`): e.g. Triple Zap (spread shot), Rapid Fire, Slow-mo rivals, Milk Doubler, Rocket Start. Each has a price, a visible in-race effect, and a duration/limited charges.
6. **More cars + upgrades.** Extend `CARS` (new Meshy kart models need the same angle: seen from behind) and `UPGRADES` (engine, zap, tires, plus e.g. armor, magnet range). Keep prices on a curve so a new player earns the first car in ~3 races.
7. **The game plays itself.** *Per Sam: it literally plays itself.* A race runs fully on autopilot: the kart steers toward milk, dodges red candles, fires green-candle zaps at rivals, and uses nitro/shield/magnet on its own. The player's choices are the **loadout** (car, power-ups, upgrades), which is what decides the result. The player can watch, and may get optional taps (e.g. cheer or trigger a saved power-up), but nothing requires input. Consequences for the design:
   - The autopilot's skill must be tuned so a better loadout wins more often, but with randomness so races stay exciting. Expose a few constants (steer lookahead, zap accuracy, reaction delay) so the balance can be tuned without a rewrite.
   - Races must be **deterministic from a seed** (seeded RNG for track, hazards and rival behaviour), so a result can be replayed and verified on a server later. This also makes PvP and anti-cheat much easier.
   - Add "race again" auto-queue / idle mode, a spectator-friendly camera, and a results screen that explains why you won or lost (which power-up fired, which hazard hit), so loadout choices feel meaningful.
   - Keep a manual-play toggle only if Sam wants it. Default is autonomous.

## Phase 2: server (needed before anything real is at stake)
- Move milk, owned cars and upgrades from `localStorage` to a server record keyed by wallet or Telegram user id. A client-only balance is forgeable, so it must not be the source of truth for anything that costs real money.
- Leaderboard and anti-cheat: the server verifies runs (seed + input log replay, or sanity bounds on score/time).
- **Spend MONSHI (real token):** never trust the client. Flow: user sends MONSHI to a game address (or signs a permit), the server verifies the transaction on-chain, then credits in-game currency. Design the refund/chargeback story before shipping. Needs a decision from Sam on token sink (burn vs treasury) and legal review.

## Phase 3: PvP
- **First version: async head-to-head.** Because races are seeded and autonomous, two players' loadouts can be raced on the same seed on a server and the result replayed by anyone. No realtime connection needed. No realtime server needed, works on mobile data, easy to ship, and still gives "beat my friend" bragging.
- **Later: realtime.** Needs a server (WebSocket rooms), deterministic track from a shared seed, lag compensation for zaps. Treat as its own project.
- Wager/entry fees in PvP are gambling in many jurisdictions: do not add stakes without legal review.

## Order of work
Phase 1 items 1-3 first (visible polish), then item 7 (autopilot, seeded and deterministic) together with 4-6 (loadout and content), since the loadout is the whole game once it plays itself. Open one PR per item; screenshots or a short recording in each. Do not touch contracts, the Monpad docs page, or `pages/*` except a link to the game.
