// Mon-Pad Telegram bot — buy alerts + trending, for t.me/monpadtrending
//
// Standalone Node service (run on your droplet). Watches Mon-Pad curves on
// Monad for buys and posts an alert for any buy >= MIN_BUY_USD. Also detects
// when a token starts "trending" (rolling window volume crosses a threshold)
// and posts it, and supports PAID BOOSTS (boosts.json) that force-trend a token.
//
//   node bot/monpad-bot.mjs
//   (or pm2 start bot/monpad-bot.mjs --name monpad-bot)
//
// Requires Node 18+ (global fetch). Config via env — see bot/.env.example.
// NEVER hard-code the bot token / RPC token here; keep them in the environment.

import { createPublicClient, http, parseAbiItem, formatEther } from 'viem';
import fs from 'node:fs';

// ── Config ───────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;              // e.g. @monpadtrending or -100...
const RPC_URL            = process.env.RPC_URL || 'https://rpc.monad.xyz';
const FACTORY_V3         = (process.env.FACTORY_V3 || '0x45Fb501E1167FbBfEBf42206A3C9945F13C70aaF').toLowerCase();
const WMON               = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const SITE               = process.env.SITE_URL || 'https://www.monpad.net';
const EXPLORER           = 'https://monadscan.com';

const MIN_BUY_USD        = Number(process.env.MIN_BUY_USD || '100');       // announce buys >= this
const POLL_MS            = Number(process.env.POLL_MS || '6000');          // chain poll cadence
const CHUNK              = BigInt(process.env.GETLOGS_CHUNK || '99');       // getLogs is 100-block capped
const MAX_CATCHUP        = BigInt(process.env.MAX_CATCHUP_BLOCKS || '2000'); // on first run / after downtime
const TOKENS_REFRESH_MS  = Number(process.env.TOKENS_REFRESH_MS || '120000'); // re-scan factory for new launches
const TREND_WINDOW_SEC   = Number(process.env.TREND_WINDOW_SEC || '3600');    // rolling window for "trending"
const TREND_THRESHOLD_USD= Number(process.env.TREND_THRESHOLD_USD || '500');  // window volume to be "trending"
const TREND_CHECK_MS     = Number(process.env.TREND_CHECK_MS || '60000');
const TREND_COOLDOWN_SEC = Number(process.env.TREND_COOLDOWN_SEC || '10800'); // re-announce a token at most this often
const MON_USD_FALLBACK   = Number(process.env.MON_USD_FALLBACK || '0');       // used only if DexScreener is down
const BOOST_CONTRACT     = (process.env.BOOST_CONTRACT || '').toLowerCase();  // MonPadBoost (pay-to-trend)
const BOOST_MON_PER_HOUR = Number(process.env.BOOST_MON_PER_HOUR || '10');    // pricing: MON paid per hour of boost
const ADMIN_ID           = process.env.ADMIN_ID || '';                        // Telegram id allowed to run admin actions
const STATE_FILE         = new URL('./state.json', import.meta.url);
const BOOSTS_FILE        = new URL('./boosts.json', import.meta.url);

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('FATAL: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (see bot/.env.example)');
  process.exit(1);
}

// ── Chain ────────────────────────────────────────────────────────────────
const chain = {
  id: 143, name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const client = createPublicClient({ chain, transport: http(RPC_URL, { timeout: 15_000, retryCount: 2 }) });

const TRADE_EVENT = parseAbiItem(
  'event Trade(address indexed token, address indexed trader, bool isBuy, uint256 monAmount, uint256 tokenAmount, uint256 virtualMonReserve, uint256 virtualTokenReserve, uint256 realMonReserve, uint256 realTokenReserve, uint256 priceX18, uint256 tradedAt)'
);
const BOOSTED_EVENT = parseAbiItem(
  'event Boosted(address indexed token, address indexed payer, uint256 amount, uint256 timestamp)'
);
const factoryAbi = [
  parseAbiItem('function allCounts() view returns (uint256, uint256)'),
  parseAbiItem('function allTokens(uint256) view returns (address)'),
  parseAbiItem('function allCurves(uint256) view returns (address)'),
];
const erc20Abi = [
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function name() view returns (string)'),
];
const curveAbi = [
  parseAbiItem('function graduated() view returns (bool)'),
  parseAbiItem('function priceWeiPerToken() view returns (uint256)'),
];

// ── State ────────────────────────────────────────────────────────────────
function loadJson(url, fallback) { try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; } }
function saveJson(url, obj) { try { fs.writeFileSync(url, JSON.stringify(obj)); } catch (e) { console.error('save failed', e.message); } }

const state = loadJson(STATE_FILE, { lastBlock: null });
const curves = new Map();      // curveAddr(lower) -> { token, curve, symbol, name }
const recentTrades = [];       // { token, usd, mon, time } rolling window for trending
const trendedAt = new Map();   // token(lower) -> unix seconds last announced trending
const seenTx = new Set();      // txHash:logIndex dedupe (buys)

// ── Telegram ─────────────────────────────────────────────────────────────
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) console.error('telegram error:', method, j.description || res.status);
  return j;
}
function send(text, extra = {}) {
  return tg('sendMessage', { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '?';
const fmtUsd = (n) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
const fmtMon = (n) => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 2 });

// ── MON/USD (DexScreener, 60s cache) ──────────────────────────────────────
let monUsd = MON_USD_FALLBACK, monUsdAt = 0;
async function getMonUsd() {
  if (monUsd && Date.now() - monUsdAt < 60_000) return monUsd;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${WMON}`);
    const d = await r.json();
    const pairs = (d.pairs || []).filter((p) => p.baseToken?.address?.toLowerCase() === WMON && p.priceUsd);
    const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best) { monUsd = Number(best.priceUsd); monUsdAt = Date.now(); }
  } catch (e) { console.error('mon/usd fetch failed:', e.message); }
  return monUsd;
}

// ── Token registry (from the factory) ─────────────────────────────────────
async function refreshTokens() {
  try {
    const counts = await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allCounts' });
    const n = Number(counts[0]);
    for (let i = 0; i < n; i++) {
      const curve = (await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allCurves', args: [BigInt(i)] })).toLowerCase();
      if (curves.has(curve)) continue;
      const token = (await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allTokens', args: [BigInt(i)] }));
      const [symbol, name] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
        client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => ''),
      ]);
      curves.set(curve, { token, curve, symbol, name });
    }
  } catch (e) { console.error('refreshTokens failed:', e.message); }
}

// ── Buy alerts ─────────────────────────────────────────────────────────────
function emojiRow(usd) {
  // one 🟢 per ~$50, capped, so bigger buys look bigger.
  const n = Math.max(3, Math.min(48, Math.floor(usd / 50)));
  return '🟢'.repeat(n);
}
async function announceBuy(info, mon, usd, tokensOut, trader, tx) {
  const line = [
    `🚀 <b>${esc(info.name || info.symbol)}</b> ($${esc(info.symbol)}) BUY`,
    emojiRow(usd),
    ``,
    `💵 <b>${fmtUsd(usd)}</b>  (${fmtMon(mon)} MON)`,
    `🪙 Got: ${fmtMon(tokensOut)} $${esc(info.symbol)}`,
    `👤 <a href="${EXPLORER}/address/${trader}">${short(trader)}</a> · <a href="${EXPLORER}/tx/${tx}">txn</a>`,
    ``,
    `📈 <a href="${SITE}/token/${info.token}">Chart / Trade on Mon-Pad</a>`,
  ].join('\n');
  await send(line);
}

// ── Trending ───────────────────────────────────────────────────────────────
function loadBoosts() {
  // boosts.json: [{ "token": "0x..", "until": <unix seconds>, "by": "@handle" }]
  const now = Math.floor(Date.now() / 1000);
  return loadJson(BOOSTS_FILE, []).filter((b) => b && b.token && Number(b.until) > now)
    .map((b) => ({ token: b.token.toLowerCase(), until: Number(b.until), by: b.by || '' }));
}

// Grant (or extend) a boost from an on-chain payment: amount MON → hours of trend
// time at BOOST_MON_PER_HOUR. Persists to boosts.json and posts a confirmation.
async function grantBoost(tokenAddr, amountMon, payer) {
  const now = Math.floor(Date.now() / 1000);
  const hours = amountMon / BOOST_MON_PER_HOUR;
  const addSec = Math.max(0, Math.round(hours * 3600));
  if (addSec === 0) return;
  const tokenLower = tokenAddr.toLowerCase();
  const raw = loadJson(BOOSTS_FILE, []);
  const existing = raw.find((b) => b?.token?.toLowerCase() === tokenLower && Number(b.until) > now);
  const base = existing ? Math.max(now, Number(existing.until)) : now;
  const until = base + addSec;
  if (existing) existing.until = until;
  else raw.push({ token: tokenLower, until, by: short(payer) });
  saveJson(BOOSTS_FILE, raw);

  const info = [...curves.values()].find((c) => c.token.toLowerCase() === tokenLower);
  const label = info ? `<b>${esc(info.name || info.symbol)}</b> ($${esc(info.symbol)})` : `<code>${esc(tokenAddr)}</code>`;
  const link = info ? `${SITE}/token/${info.token}` : `${EXPLORER}/address/${tokenAddr}`;
  trendedAt.set(tokenLower, now); // this post counts as the trending post; avoid an instant duplicate
  const mins = Math.round(addSec / 60);
  const dur = mins >= 60 ? `${(mins / 60).toFixed(mins % 60 ? 1 : 0)}h` : `${mins}m`;
  await send([
    `🚀🔥 <b>BOOST PURCHASED — NOW TRENDING</b>`,
    ``,
    label,
    `⏱ trending for <b>${dur}</b>  (paid ${fmtMon(amountMon)} MON)`,
    `👤 <a href="${EXPLORER}/address/${payer}">${short(payer)}</a>`,
    ``,
    `📈 <a href="${link}">Trade on Mon-Pad</a>`,
  ].join('\n'));
}

async function scanBoosts(from, to) {
  if (!BOOST_CONTRACT) return;
  for (let start = from; start <= to; start += CHUNK + 1n) {
    const end = start + CHUNK > to ? to : start + CHUNK;
    let logs;
    try { logs = await client.getLogs({ address: BOOST_CONTRACT, event: BOOSTED_EVENT, fromBlock: start, toBlock: end }); }
    catch (e) { console.error(`boost getLogs ${start}-${end} failed:`, e.shortMessage || e.message); continue; }
    for (const lg of logs) {
      const key = `boost:${lg.transactionHash}:${lg.logIndex}`;
      if (seenTx.has(key)) continue; seenTx.add(key);
      const amountMon = Number(formatEther(lg.args.amount ?? 0n));
      try { await grantBoost(lg.args.token, amountMon, lg.args.payer); }
      catch (e) { console.error('grantBoost failed:', e.message); }
    }
  }
}
function windowVolumeUsd(tokenLower, sinceSec) {
  let v = 0;
  for (const t of recentTrades) if (t.token === tokenLower && t.time >= sinceSec) v += t.usd;
  return v;
}
async function checkTrending() {
  const now = Math.floor(Date.now() / 1000);
  const since = now - TREND_WINDOW_SEC;
  // prune old trades
  while (recentTrades.length && recentTrades[0].time < since) recentTrades.shift();

  const boosts = loadBoosts();
  const boostByToken = new Map(boosts.map((b) => [b.token, b]));

  // Candidates: organic (window volume >= threshold) + all active boosts.
  const candidates = new Set(boosts.map((b) => b.token));
  for (const info of curves.values()) {
    if (windowVolumeUsd(info.token.toLowerCase(), since) >= TREND_THRESHOLD_USD) candidates.add(info.token.toLowerCase());
  }

  for (const tokenLower of candidates) {
    const last = trendedAt.get(tokenLower) || 0;
    if (now - last < TREND_COOLDOWN_SEC) continue; // cooldown so we don't spam
    const info = [...curves.values()].find((c) => c.token.toLowerCase() === tokenLower);
    if (!info) continue;
    const vol = windowVolumeUsd(tokenLower, since);
    const boost = boostByToken.get(tokenLower);
    trendedAt.set(tokenLower, now);
    const head = boost ? `🚀🔥 <b>BOOSTED &amp; TRENDING</b>` : `🔥 <b>NOW TRENDING</b>`;
    const line = [
      `${head}`,
      ``,
      `<b>${esc(info.name || info.symbol)}</b> ($${esc(info.symbol)})`,
      `📊 ${fmtUsd(vol)} volume / ${Math.round(TREND_WINDOW_SEC / 60)}m`,
      boost && boost.by ? `⭐ boosted by ${esc(boost.by)}` : '',
      ``,
      `📈 <a href="${SITE}/token/${info.token}">Trade on Mon-Pad</a>`,
    ].filter(Boolean).join('\n');
    await send(line);
  }
}

// ── Scan loop ───────────────────────────────────────────────────────────────
async function scanRange(from, to) {
  const usd = await getMonUsd();
  for (let start = from; start <= to; start += CHUNK + 1n) {
    const end = start + CHUNK > to ? to : start + CHUNK;
    let logs;
    try {
      logs = await client.getLogs({ event: TRADE_EVENT, fromBlock: start, toBlock: end });
    } catch (e) { console.error(`getLogs ${start}-${end} failed:`, e.shortMessage || e.message); continue; }
    for (const lg of logs) {
      const info = curves.get(lg.address.toLowerCase());
      if (!info) continue;                    // not one of our (current-factory) tokens
      const a = lg.args;
      const key = `${lg.transactionHash}:${lg.logIndex}`;
      if (seenTx.has(key)) continue; seenTx.add(key);
      const mon = Number(formatEther(a.monAmount ?? 0n));
      const dollars = mon * usd;
      const tokensOut = Number(formatEther(a.tokenAmount ?? 0n));
      const time = Number(a.tradedAt ?? 0n) || Math.floor(Date.now() / 1000);
      if (a.isBuy) recentTrades.push({ token: info.token.toLowerCase(), usd: dollars, mon, time });
      if (a.isBuy && dollars >= MIN_BUY_USD) {
        try { await announceBuy(info, mon, dollars, tokensOut, a.trader, lg.transactionHash); }
        catch (e) { console.error('announce failed:', e.message); }
      }
    }
  }
  if (seenTx.size > 5000) { // keep the dedupe set bounded
    const keep = [...seenTx].slice(-2000); seenTx.clear(); keep.forEach((k) => seenTx.add(k));
  }
}

async function tick() {
  try {
    const head = await client.getBlockNumber();
    let from = state.lastBlock != null ? BigInt(state.lastBlock) + 1n : (head > MAX_CATCHUP ? head - MAX_CATCHUP : 0n);
    if (from > head) return;
    await scanRange(from, head);
    await scanBoosts(from, head);
    state.lastBlock = head.toString();
    saveJson(STATE_FILE, state);
  } catch (e) { console.error('tick failed:', e.message); }
}

// ── Boot ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`monpad-bot → chat ${TELEGRAM_CHAT_ID} | factory ${FACTORY_V3} | min buy $${MIN_BUY_USD}`);
  console.log(BOOST_CONTRACT ? `boost contract ${BOOST_CONTRACT} @ ${BOOST_MON_PER_HOUR} MON/hour` : 'boost contract: (not set — paid trending disabled)');
  await refreshTokens();
  console.log(`tracking ${curves.size} tokens`);
  await getMonUsd();
  console.log(`MON/USD = $${monUsd}`);

  setInterval(refreshTokens, TOKENS_REFRESH_MS);
  setInterval(tick, POLL_MS);
  setInterval(() => { checkTrending().catch((e) => console.error('trending failed:', e.message)); }, TREND_CHECK_MS);
  await tick();
  console.log('bot running.');
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
