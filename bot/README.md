# Mon-Pad Telegram bot

Buy alerts + trending for **t.me/monpadtrending**. Standalone Node service — runs
on your droplet, watches Monad on-chain, posts to the group.

## What it does
- **Buy alerts** — posts any buy on a Mon-Pad token worth **≥ `MIN_BUY_USD`** ($100
  default). Green-square row scales with size; shows USD + MON, tokens received,
  buyer, txn, and a chart/trade link. Dedupes by tx so nothing double-posts.
- **Trending** — posts when a token *starts trending*: rolling **window volume**
  (`TREND_WINDOW_SEC`) crosses **`TREND_THRESHOLD_USD`**. A per-token cooldown
  (`TREND_COOLDOWN_SEC`) stops spam.
- **Paid boosts** — tokens listed in `boosts.json` (with an `until` timestamp) are
  force-trended and tagged **BOOSTED**. This is the hook for the paid service — see
  "Paid boosts" below for wiring payments.

> Pre-graduation curve buys are covered today. Buys on **graduated** tokens happen
> on the Uniswap V3 pool (not the curve) — that's a follow-up module (watch the
> pool's `Swap` events). Flagged in the code.

## Setup (droplet)
```bash
cd bot
npm install
cp .env.example .env      # fill in TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (+ your RPC)
# add the bot to the group as an admin (so it can post)
set -a; . ./.env; set +a
npm start
```

### Keep it running (pm2)
```bash
npm i -g pm2
pm2 start monpad-bot.mjs --name monpad-bot --update-env
pm2 save && pm2 startup
```

### Getting the chat id
If `@monpadtrending` doesn't work (private group), get the numeric id: add the bot,
post a message in the group, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (a `-100…`
number) into `TELEGRAM_CHAT_ID`.

## Paid boosts (on-chain — live)
Pay-to-trend runs through the **`MonPadBoost`** contract
(`0xf3f91D4d553A47c609830cb470302BB14b7D466C`, payments forwarded to treasury):

1. A project calls **`boost(tokenAddress)`** with MON attached (from a future
   "Boost" button on the site, or directly via the explorer). Minimum 1 MON.
2. The contract emits `Boosted(token, payer, amount, timestamp)`.
3. The bot watches that event and grants trend time =
   `amount / BOOST_MON_PER_HOUR` hours (10 MON/hour by default — your knob).
   Repeat payments **extend** an active boost.
4. The token posts as **🚀 BOOSTED — NOW TRENDING** and stays in the trending set
   until the paid time runs out.

Active boosts are cached in `boosts.json` (git-ignored) so restarts keep them; the
full history is reconstructable from the `Boosted` event log. You can also add a
manual entry to `boosts.json` (`[{ "token": "0x…", "until": <unix>, "by": "@h" }]`)
for comps/promos.

Set `BOOST_CONTRACT` and `BOOST_MON_PER_HOUR` in `.env`.

## State
`state.json` (git-ignored) holds the last scanned block so restarts resume without
double-posting. Delete it to re-baseline from `MAX_CATCHUP_BLOCKS` back.

## Buy alerts: 3D video + coloured buttons
Every buy alert is now a short 3D clip of Monshi (rigged model, coin rain, confetti, 3D "GREAT BUY / HUGE BUY / WHALE BUY" text) with a green **Buy on Monpad** button and a blue **Chart** button.

| Buy size | Video |
|---|---|
| under $1,000 | `assets/buy-small.mp4` (GREAT BUY) |
| $1,000 to $4,999 | `assets/buy-big.mp4` (HUGE BUY) |
| $5,000 and up | `assets/buy-whale.mp4` (WHALE BUY) |

- The first alert of each size uploads the file; Telegram's `file_id` is cached in `video-cache.json` (git-ignored) so later alerts send instantly. If a video ever fails to send, the alert falls back to plain text, so a buy is never missed.
- **Coloured buttons** use Telegram's button `style` (`success` green, `primary` blue, `danger` red; Bot API 9.4+). Set `BUTTON_STYLES=off` to turn them off.
- **Preview without any chain access:** `node monpad-bot.mjs --test-alert=whale --chat=<your chat id>` sends one sample alert (`small`, `big` or `whale`) and exits.
- **Re-render the videos** (after changing the scene in `video/scene.html`): `npm i --no-save playwright-core && node video/render.mjs` (needs `ffmpeg` and the repo's `node_modules`). Output is deterministic.

## Getting the bot running on the server
1. `git pull`, then `cd bot && npm install` (the bot needs Node 24).
2. Create `bot/.env` from `.env.example`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (the group's `-100…` id), `RPC_URL`, `FACTORY_V3` (or the new launcher addresses once deployed).
3. **Add the bot to the group as an admin** (a bot that is not in the group gets "chat not found").
4. `pm2 start monpad-bot.mjs --name monpad-bot --update-env && pm2 save`
5. Check with `pm2 logs monpad-bot`, and `--test-alert` to see the look.

Never paste the bot token into chats or commit it. If it was shared anywhere, revoke it in @BotFather (`/revoke`) and put the new one in `.env`.

## Monshi stickers (animated, transparent, no text)
Eight 3D Monshi stickers: `celebrate`, `wave`, `dance`, `facepalm`, `hype`, `angry`, `happy`, `sleepy` (`assets/stickers/monshi-*.webm`). Each is a 2-second seamless loop, 512x512, transparent background with a white outline, WebM/VP9, under 256 KB, which are Telegram's rules for video stickers.

- **Look at them first:** `TELEGRAM_BOT_TOKEN=... node stickers.mjs preview --chat=<your chat id>` sends them to one chat.
- **Publish a public pack:** `TELEGRAM_BOT_TOKEN=... node stickers.mjs publish --owner=<your telegram user id> [--name=monshi]`. The pack link is `t.me/addstickers/<name>_by_<botusername>`. Publishing is public, so only do it when you are happy with them.
- **Re-render or add poses:** poses live in `video/sticker.html` (`POSES`); `node video/render-stickers.mjs [pose ...]` renders them (`SHEET=1` makes a preview sheet instead). Needs `playwright-core` and `ffmpeg`.
