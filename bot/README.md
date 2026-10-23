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

## Buy alerts: Monshi candle-climb clip + coloured buttons
Every buy alert is a short 2D clip of the real Monshi art climbing a glowing green candle (no text, seamless loop), with the Monshi coin spinning above. It has a green **Buy on Monpad** button and a blue **Chart** button.

| Buy size | Video |
|---|---|
| under $1,000 | `assets/buy-small.mp4` (slow climb) |
| $1,000 and up | `assets/buy-big.mp4` (faster, shake, pulse ring) |
| **10,000,000 tokens or more** (a WHALE) | `assets/buy-whale.mp4` (fastest, bigger coin, purple ring, coin shower) |

A whale is decided by **tokens bought**, not dollars (`WHALE_TOKENS`, default 10,000,000 = 1% of a 1B supply).

- The first alert of each size uploads the file; Telegram's `file_id` is cached in `video-cache.json` (git-ignored) so later alerts send instantly. If a video ever fails to send, the alert falls back to plain text, so a buy is never missed.
- **Coloured buttons** use Telegram's button `style` (`success` green, `primary` blue, `danger` red; Bot API 9.4+). Set `BUTTON_STYLES=off` to turn them off.
- **Preview without any chain access:** `node monpad-bot.mjs --test-alert=whale --chat=<your chat id>` sends one sample alert (`small`, `big` or `whale`) and exits.
- **Re-render the clips:** `cd video/gif && python3 render.py small|big|whale` (needs Pillow, numpy, `ffmpeg`; the cutout is `cat.png`, made from the reference art by `cut.py`, the coin frames are in `coin/`). Copy the resulting `buy-*.mp4` into `assets/`.

## Getting the bot running on the server
1. `git pull`, then `cd bot && npm install` (the bot needs Node 24).
2. Create `bot/.env` from `.env.example`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (the group's `-100…` id), `RPC_URL`, `FACTORY_V3` (or the new launcher addresses once deployed).
3. **Add the bot to the group as an admin** (a bot that is not in the group gets "chat not found").
4. `pm2 start monpad-bot.mjs --name monpad-bot --update-env && pm2 save`
5. Check with `pm2 logs monpad-bot`, and `--test-alert` to see the look.

Never paste the bot token into chats or commit it. If it was shared anywhere, revoke it in @BotFather (`/revoke`) and put the new one in `.env`.

## Spinning Monshi emoji wall (scales with the buy)
The alert's emoji row uses Monshi's own **spinning coin** custom emoji (pack: https://t.me/addemoji/serchunge14), and the bigger the buy, the more of them it posts:

| Tier | Coins per alert |
|---|---|
| Fish (under $300) | 1 + 1 per $12 |
| Dolphin ($300+) | at least 3, then 1 per $35 |
| Shark ($1,000+) | at least 8, then 1 per $80 |
| Whale (10M+ tokens) | at least 25, then 1 per $150 (max 60) |

- The emoji id lives in `assets/emoji.json` (or `MONSHI_EMOJI_ID`). With no id, the row falls back to normal emoji.
- Telegram only shows custom emoji from a bot under certain conditions. They worked in a private chat; if they show as plain 🪙 in the group, the group needs the pack set as its emoji pack, or the bot needs a Fragment username. See the notes in the PR.

## Alert layout
```
🔥 #3 on Monpad Trending              (shown when the token is in the top 10 by volume in the trending window)
🐋 WHALE BUY · Monshi Zoomies ($ZOOM)
<spinning Monshi coins, more for bigger buys>
Tokens: 12,500,000 (ZOOM)
Amount: 410 MON ($8.2k)
Buyer: 0x5db7…A575  ·  New Holder    (or "Holder +45%", from the buyer's balance in the block before the buy)
MCap: $184.0k  ▲ 12.4%
Price: $0.000184
Liquidity: $61.2k  ·  24h Vol: $39.5k  (when DexScreener lists the pair)
Tx · DS · WEB · X · TG                (X / TG come from the token's saved socials on the site)
✅ DEX PAID                            (when the token has an approved DexScreener profile)

[ 🔎 Monadscan ] [ 📊 DexScreener ]    green
[ 📈 Get Monpad Trending ]
[ 🟣 Buy on Monpad ]                  blue
```
Each piece is fetched with a short timeout and left out if unavailable, so an alert is never delayed or lost. Holder position needs an RPC node that keeps recent state (your Alchemy URL does). `GET_TRENDING_URL` sets where "Get Monpad Trending" points.
