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

## Paid boosts
`boosts.json` is the source of truth (git-ignored). Each entry:
```json
[{ "token": "0x…", "until": 1737000000, "by": "@handle" }]
```
`until` is a unix timestamp; the boost is active until then. To monetize, wire ONE
of these to append/refresh entries (all out of scope of this MVP, documented so we
can pick one):
- **On-chain**: watch a boost wallet for MON payments that carry the token address,
  then add a boost for N hours proportional to the amount.
- **Bot command**: an admin-only `/boost <token> <hours>` after payment is confirmed.
- **Site checkout**: a "Boost" button on the token page that takes payment and
  writes the boost row (e.g. to Supabase, which the bot reads instead of the file).

## State
`state.json` (git-ignored) holds the last scanned block so restarts resume without
double-posting. Delete it to re-baseline from `MAX_CATCHUP_BLOCKS` back.
