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
