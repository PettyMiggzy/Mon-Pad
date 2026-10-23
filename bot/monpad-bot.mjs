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
const GRAD_BACKFILL      = BigInt(process.env.GRAD_BACKFILL_BLOCKS || '500'); // rescan a newly-graduated pool over the discovery gap
const TOKENS_REFRESH_MS  = Number(process.env.TOKENS_REFRESH_MS || '120000'); // re-scan factory for new launches
const TREND_WINDOW_SEC   = Number(process.env.TREND_WINDOW_SEC || '3600');    // rolling window for "trending"
const TREND_THRESHOLD_USD= Number(process.env.TREND_THRESHOLD_USD || '500');  // window volume to be "trending"
const TREND_CHECK_MS     = Number(process.env.TREND_CHECK_MS || '60000');
const TREND_COOLDOWN_SEC = Number(process.env.TREND_COOLDOWN_SEC || '10800'); // re-announce a token at most this often
const MON_USD_FALLBACK   = Number(process.env.MON_USD_FALLBACK || '0');       // used only if DexScreener is down
// MonPadBoostMonshi — MONSHI-paid, tiered pay-to-trend (70% burn / 30% treasury).
// Trend duration comes from the on-chain event; pricing/tiers live in the contract.
const BOOST_CONTRACT     = (process.env.BOOST_CONTRACT || '0xE50Ab41eAE60309d06a6aaA699f5E5786D78e4DA').toLowerCase();
const ADMIN_ID           = process.env.ADMIN_ID || '';                        // Telegram id allowed to run admin actions
// DexScreener per-token enrichment (keyless read API; Monad chainId 'monad')
const DS_TTL_MS      = Number(process.env.DS_CACHE_TTL_MS || '60000');        // cache a listed pair
const DS_NEG_TTL_MS  = Number(process.env.DS_NEG_CACHE_TTL_MS || '300000');   // cache "not listed yet"
const CURVE_TTL_MS   = Number(process.env.CURVE_PRICE_TTL_MS || '15000');     // cache on-chain curve price
const TOTAL_SUPPLY   = 1_000_000_000;                                         // fixed 1e9 supply (matches V3_TOTAL_SUPPLY)
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
  'event Boosted(address indexed token, address indexed payer, uint256 tierId, uint256 amount, uint32 durationSec, uint256 burned, uint256 toTreasury, uint256 timestamp)'
);
const factoryAbi = [
  parseAbiItem('function allCounts() view returns (uint256, uint256)'),
  parseAbiItem('function allTokens(uint256) view returns (address)'),
  parseAbiItem('function allCurves(uint256) view returns (address)'),
];
const erc20Abi = [
  parseAbiItem('function symbol() view returns (string)'),
  parseAbiItem('function name() view returns (string)'),
  parseAbiItem('function balanceOf(address) view returns (uint256)'),
];
const curveAbi = [
  parseAbiItem('function graduated() view returns (bool)'),
  parseAbiItem('function priceWeiPerToken() view returns (uint256)'),
];
// Graduated tokens trade on their official Uniswap V3 pool (Swap events), not the curve.
const OFFICIAL_V3_FACTORY = (process.env.UNIV3_FACTORY || '0x204fAca1764B154221e35c0d20aBb3c525710498').toLowerCase();
const POOL_FEE = Number(process.env.UNIV3_FEE || '10000'); // 1% tier the graduator uses
const v3FactoryAbi = [ parseAbiItem('function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)') ];
const poolAbi = [ parseAbiItem('function token0() view returns (address)'), parseAbiItem('function token1() view returns (address)') ];
const V3_SWAP_EVENT = parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)');

// ── State ────────────────────────────────────────────────────────────────
function loadJson(url, fallback) { try { return JSON.parse(fs.readFileSync(url, 'utf8')); } catch { return fallback; } }
function saveJson(url, obj) { try { fs.writeFileSync(url, JSON.stringify(obj)); } catch (e) { console.error('save failed', e.message); } }

const state = loadJson(STATE_FILE, { lastBlock: null, seenTx: [] });
const curves = new Map();      // curveAddr(lower) -> { token, curve, symbol, name }
const gradPools = new Map();   // poolAddr(lower) -> { token, curve, symbol, name, tokenIsToken0 }
const recentTrades = [];       // { token, usd, mon, time } rolling window for trending
const trendedAt = new Map();   // token(lower) -> unix seconds last announced trending
// txHash:logIndex dedupe (buys/boosts). Restored from state.json so a crash/restart
// between announcing and persisting lastBlock does NOT replay alerts / re-grant boosts.
const seenTx = new Set(Array.isArray(state.seenTx) ? state.seenTx : []);
let gradInitialized = false;   // skip backfill spam on the very first pool discovery pass

// ── Telegram ─────────────────────────────────────────────────────────────
const TG_API = process.env.TG_API || 'https://api.telegram.org'; // override only for tests
async function tg(method, body) {
  const res = await fetch(`${TG_API}/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
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

// ── DexScreener per-token enrichment ──────────────────────────────────────
// Prefer DexScreener data when the token is listed (graduated Uni-V3 pool, or a
// future indexed curve); fall back to on-chain curve price before it's listed.
const dsCache = new Map();    // token(lower) -> { pair, at, ttl }
const priceCache = new Map(); // curve(lower) -> { mon, at }

async function fetchDexPair(token) {
  const key = token.toLowerCase();
  const hit = dsCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.pair;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const d = await r.json();
    const pairs = (d.pairs || []).filter((p) => p.chainId === 'monad' && p.baseToken?.address?.toLowerCase() === key && Number(p.priceUsd) > 0);
    const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
    dsCache.set(key, { pair, at: Date.now(), ttl: pair ? DS_TTL_MS : DS_NEG_TTL_MS });
    return pair;
  } catch {
    if (hit) return hit.pair;                 // serve stale on error
    dsCache.set(key, { pair: null, at: Date.now(), ttl: 10_000 });
    return null;
  }
}

async function curvePriceMon(curve) {
  const key = (curve || '').toLowerCase();
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < CURVE_TTL_MS) return hit.mon;
  try {
    const wei = await client.readContract({ address: curve, abi: curveAbi, functionName: 'priceWeiPerToken' });
    const mon = Number(formatEther(wei));
    priceCache.set(key, { mon, at: Date.now() });
    return mon;
  } catch { return hit ? hit.mon : 0; }
}

/** { source, listed, priceUsd, marketCapUsd, priceChangeH24, pairUrl } */
async function enrichToken(info) {
  const pair = await fetchDexPair(info.token);
  if (pair) {
    const priceUsd = Number(pair.priceUsd);
    return {
      source: 'dexscreener', listed: true, priceUsd,
      marketCapUsd: Number(pair.marketCap) || Number(pair.fdv) || priceUsd * TOTAL_SUPPLY,
      priceChangeH24: pair.priceChange?.h24 ?? null,
      liquidityUsd: Number(pair.liquidity?.usd) || 0, volumeH24: Number(pair.volume?.h24) || 0,
      pairUrl: pair.url || `https://dexscreener.com/monad/${pair.pairAddress}`,
    };
  }
  const priceUsd = (await curvePriceMon(info.curve)) * (await getMonUsd());
  return { source: 'curve', listed: false, priceUsd, marketCapUsd: priceUsd * TOTAL_SUPPLY, priceChangeH24: null, pairUrl: null };
}

// ── Token registry (from the factory) ─────────────────────────────────────
// Only scan NEW indices each cycle (from lastTokenCount up to the current count),
// instead of re-reading allCurves(0..n-1) every time — that grew unbounded with
// every launch and steadily raised RPC pressure. lastTokenCount only advances after
// the new indices are processed; a mid-loop RPC throw leaves it so the next cycle
// retries the same indices.
let lastTokenCount = 0;
async function refreshTokens() {
  try {
    const counts = await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allCounts' });
    const n = Number(counts[0]);
    for (let i = lastTokenCount; i < n; i++) {
      const curve = (await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allCurves', args: [BigInt(i)] })).toLowerCase();
      if (curves.has(curve)) continue;
      const token = (await client.readContract({ address: FACTORY_V3, abi: factoryAbi, functionName: 'allTokens', args: [BigInt(i)] }));
      const [symbol, name] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
        client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }).catch(() => ''),
      ]);
      curves.set(curve, { token, curve, symbol, name });
    }
    lastTokenCount = n;
  } catch (e) { console.error('refreshTokens failed:', e.message); }
}

// ── Buy alerts (tiered by USD size) ──────────────────────────────────────────
// A WHALE buy is WHALE_TOKENS tokens or more (default 10,000,000 = 1% of a 1B supply). Other sizes go by USD.
const WHALE_TOKENS = Number(process.env.WHALE_TOKENS || '10000000');
function buyTier(usd, tokens = 0) {
  if (tokens >= WHALE_TOKENS) return { emoji: '🐋', label: 'WHALE', unit: 150, min: 25 };
  if (usd >= 1000) return { emoji: '🦈', label: 'SHARK', unit: 80, min: 8 };
  if (usd >= 300)  return { emoji: '🐬', label: 'DOLPHIN', unit: 35, min: 3 };
  return { emoji: '🐟', label: 'FISH', unit: 12, min: 1 };
}

// Monshi's own spinning coin (custom emoji pack t.me/addemoji/monshi_spin_by_Monshizbot). The bigger the buy, the
// more of them the alert posts. MONSHI_EMOJI_ID overrides assets/emoji.json; with neither, plain emoji are used.
const EMOJI_CFG = loadJson(new URL('./assets/emoji.json', import.meta.url), {});
const MONSHI_EMOJI_ID = process.env.MONSHI_EMOJI_ID || EMOJI_CFG.id || '';
const MAX_WALL = 60;
function wallCount(usd, tier) {
  return Math.max(tier.min, Math.min(MAX_WALL, Math.floor(usd / tier.unit)));
}
function emojiWall(usd, tier) {
  const n = wallCount(usd, tier);
  if (MONSHI_EMOJI_ID) return `<tg-emoji emoji-id="${MONSHI_EMOJI_ID}">${EMOJI_CFG.placeholder || '🪙'}</tg-emoji>`.repeat(n);
  return tier.emoji.repeat(Math.min(40, n));
}

// Telegram button colours (Bot API 9.4+): "success" green, "primary" blue, "danger" red. BUTTON_STYLES=off disables.
const STYLES_ON = (process.env.BUTTON_STYLES || 'on') !== 'off';
const styled = (btn, style) => (STYLES_ON && style ? { ...btn, style } : btn);
const AI_URL = process.env.AI_URL || `${SITE}/ai`;

// Buttons: [Monadscan | DexScreener] green, [Trade with your AI], [Buy on Monpad] blue.
function buyButtons(info, enr, tx) {
  const row1 = [styled({ text: '🔎 Monadscan', url: tx ? `${EXPLORER}/tx/${tx}` : EXPLORER }, 'success')];
  if (enr?.listed && enr.pairUrl) row1.push(styled({ text: '📊 DexScreener', url: enr.pairUrl }, 'success'));
  return { reply_markup: { inline_keyboard: [
    row1,
    [{ text: '🤖 Trade with your AI', url: AI_URL }],
    [styled({ text: '🟣 Buy on Monpad', url: `${SITE}/token/${info.token}` }, 'primary')],
  ] } };
}

// Buy clips (bot/assets/buy-{small,big,whale}.mp4, made by bot/video/gif/render.py). The first send uploads
// the file; Telegram's file_id is cached in video-cache.json so every later alert is instant.
const ASSETS = new URL('./assets/', import.meta.url);
const VIDEO_CACHE = new URL('./video-cache.json', import.meta.url);
const videoCache = loadJson(VIDEO_CACHE, {});
const videoFor = (usd, tokens = 0) => (tokens >= WHALE_TOKENS ? 'whale' : usd >= 1000 ? 'big' : 'small');

async function sendBuyVideo(chatId, kind, caption, extra = {}) {
  const base = { chat_id: chatId, caption, parse_mode: 'HTML', ...extra };
  if (videoCache[kind]) {
    const r = await tg('sendAnimation', { ...base, animation: videoCache[kind] });
    if (r.ok) return r;
    delete videoCache[kind]; // stale file_id: fall through and upload again
  }
  const file = new URL(`buy-${kind}.mp4`, ASSETS);
  if (!fs.existsSync(file)) return { ok: false };
  const form = new FormData();
  for (const [k, v] of Object.entries(base)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  form.append('width', '1280'); form.append('height', '720'); form.append('duration', '5');
  form.append('animation', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), `buy-${kind}.mp4`);
  const res = await fetch(`${TG_API}/bot${TELEGRAM_BOT_TOKEN}/sendAnimation`, { method: 'POST', body: form });
  const j = await res.json().catch(() => ({}));
  if (j.ok) {
    const id = j.result?.animation?.file_id || j.result?.video?.file_id;
    if (id) { videoCache[kind] = id; saveJson(VIDEO_CACHE, videoCache); }
  } else console.error('telegram error: sendAnimation', j.description || res.status);
  return j;
}

// ── Alert extras: rank, holder position, socials, DEX PAID ─────────────────
const getJson = async (url, ms = 2500) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json() : null; } catch { return null; } };
const safeUrl = (u) => { const t = String(u || '').trim(); return /^https:\/\/[^\s"<>]+$/i.test(t) ? t : ''; };
const asX = (u) => { const t = String(u || '').trim(); if (!t) return ''; if (/^https?:/i.test(t)) return safeUrl(t); return /^@?[A-Za-z0-9_]{1,15}$/.test(t) ? `https://x.com/${t.replace(/^@/, '')}` : ''; };
const asTg = (u) => { const t = String(u || '').trim(); if (!t) return ''; if (/^https?:/i.test(t)) return safeUrl(t); return /^@?[A-Za-z0-9_]{4,32}$/.test(t) ? `https://t.me/${t.replace(/^@/, '')}` : ''; };

const socialCache = new Map(); // token(lower) -> { v, at }
async function tokenSocials(token) {
  const k = token.toLowerCase(); const hit = socialCache.get(k);
  if (hit && Date.now() - hit.at < 600_000) return hit.v;
  const d = await getJson(`${SITE}/api/token-meta?addresses=${token}`);
  const m = Array.isArray(d) ? d[0] : null;
  const v = { web: safeUrl(m?.website), x: asX(m?.twitter), tg: asTg(m?.telegram) };
  socialCache.set(k, { v, at: Date.now() });
  return v;
}
const paidCache = new Map();
async function isDexPaid(token) { // DexScreener "enhanced token info" order that was approved
  const k = token.toLowerCase(); const hit = paidCache.get(k);
  if (hit && Date.now() - hit.at < 900_000) return hit.v;
  const d = await getJson(`https://api.dexscreener.com/orders/v1/monad/${token}`);
  const v = Array.isArray(d) && d.some((o) => o?.type === 'tokenProfile' && o?.status === 'approved');
  paidCache.set(k, { v, at: Date.now() });
  return v;
}
// "New Holder" or "+X% Holder" from the buyer's balance in the block before the buy (needs a node with that state).
async function holderPosition(info, trader, tokensOut, block) {
  if (!block || !trader) return '';
  try {
    const prev = await client.readContract({ address: info.token, abi: erc20Abi, functionName: 'balanceOf', args: [trader], blockNumber: BigInt(block) - 1n });
    const p = Number(formatEther(prev));
    if (p <= 0) return 'New Holder';
    const pct = (tokensOut / p) * 100;
    return `Holder +${pct >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
  } catch { return ''; }
}
function trendRank(tokenLower) { // rank by volume in the trending window; 0 = not ranked
  const since = Math.floor(Date.now() / 1000) - TREND_WINDOW_SEC;
  const vol = new Map();
  for (const t of recentTrades) if (t.time >= since) vol.set(t.token, (vol.get(t.token) || 0) + t.usd);
  const ranked = [...vol.entries()].sort((a, b) => b[1] - a[1]).map(([tk]) => tk);
  const i = ranked.indexOf(tokenLower);
  return i >= 0 && i < 10 ? i + 1 : 0;
}
async function gatherExtras(info, trader, tokensOut, block) {
  const [position, socials, paid] = await Promise.all([holderPosition(info, trader, tokensOut, block), tokenSocials(info.token), isDexPaid(info.token)]);
  return { position, socials, paid, rank: trendRank(info.token.toLowerCase()) };
}

function fmtPrice(p) {
  if (!(p > 0)) return '—';
  if (p >= 1) return `$${p.toFixed(4)}`;
  const dec = Math.min(14, Math.max(4, 3 - Math.floor(Math.log10(p))));
  return `$${p.toFixed(dec)}`;
}

// Caption layout (Monpad version of a classic buy-bot alert):
//   🔥 #3 on Monpad Trending
//   🐋 WHALE BUY · Name ($SYM)
//   <spinning Monshi coins>          (more of them the bigger the buy)
//   Tokens / Amount / Position / MCap / Price / Liquidity
//   Tx · DS · WEB · X · TG          ✅ DEX PAID
function buyCaption(info, mon, usd, tokensOut, trader, enr, x = {}) {
  const tier = buyTier(usd, tokensOut);
  const lines = [];
  if (x.rank) lines.push(`🔥 <b>#${x.rank} on Monpad Trending</b>`);
  lines.push(`${tier.emoji} <b>${tier.label} BUY</b> · <b>${esc(info.name || info.symbol)}</b> ($${esc(info.symbol)})`);
  lines.push(emojiWall(usd, tier));
  lines.push(`<b>Tokens:</b> ${fmtMon(tokensOut)} (${esc(info.symbol)})`);
  lines.push(`<b>Amount:</b> ${fmtMon(mon)} MON (${fmtUsd(usd)})`);
  lines.push(`<b>Buyer:</b> <a href="${EXPLORER}/address/${trader}">${short(trader)}</a>${x.position ? `  ·  ${esc(x.position)}` : ''}`);
  if (enr && enr.marketCapUsd > 0) {
    let mc = `<b>MCap:</b> ${fmtUsd(enr.marketCapUsd)}`;
    if (enr.priceChangeH24 != null) mc += `  ${enr.priceChangeH24 >= 0 ? '▲' : '▼'} ${Math.abs(enr.priceChangeH24).toFixed(1)}%`;
    lines.push(mc);
  }
  if (enr && enr.priceUsd > 0) lines.push(`<b>Price:</b> ${fmtPrice(enr.priceUsd)}`);
  if (enr?.listed && enr.liquidityUsd > 0) lines.push(`<b>Liquidity:</b> ${fmtUsd(enr.liquidityUsd)}  ·  <b>24h Vol:</b> ${fmtUsd(enr.volumeH24 || 0)}`);
  const sc = x.socials || {};
  const links = [x.tx ? `<a href="${EXPLORER}/tx/${x.tx}">Tx</a>` : `<a href="${EXPLORER}/address/${trader}">Wallet</a>`];
  if (enr?.listed && enr.pairUrl) links.push(`<a href="${enr.pairUrl}">DS</a>`);
  links.push(`<a href="${SITE}/token/${info.token}">WEB</a>`);
  if (sc.x) links.push(`<a href="${sc.x}">X</a>`);
  if (sc.tg) links.push(`<a href="${sc.tg}">TG</a>`);
  if (sc.web) links.push(`<a href="${sc.web}">Site</a>`);
  lines.push(links.join(' · '));
  if (x.paid) lines.push('✅ <b>DEX PAID</b>');
  return lines.join('\n');
}

async function announceBuy(info, mon, usd, tokensOut, trader, tx, enr, block) {
  const x = { ...(await gatherExtras(info, trader, tokensOut, block).catch(() => ({}))), tx };
  const caption = buyCaption(info, mon, usd, tokensOut, trader, enr, x);
  const extra = buyButtons(info, enr, tx);
  const r = await sendBuyVideo(TELEGRAM_CHAT_ID, videoFor(usd, tokensOut), caption, extra);
  if (!r.ok) await send(caption, extra); // never lose an alert if the video fails
}

// node monpad-bot.mjs --test-alert=whale [--chat=<id>]   posts one sample alert and exits (no chain access needed)
async function runTestAlert(arg, chatArg) {
  const kind = (arg.split('=')[1] || 'small');
  const usd = { small: 120, big: 1800, whale: 8200 }[kind] ?? 120;
  const tokens = { small: 480_000, big: 2_600_000, whale: 12_500_000 }[kind] ?? 480_000;
  const chat = chatArg ? chatArg.split('=')[1] : TELEGRAM_CHAT_ID;
  const info = { name: 'Monshi Zoomies', symbol: 'ZOOM', token: '0x0000000000000000000000000000000000000001' };
  const enr = { marketCapUsd: 184000, priceChangeH24: 12.4, listed: true, priceUsd: 0.000184, liquidityUsd: 61200, volumeH24: 39500, pairUrl: 'https://dexscreener.com/monad' };
  const x = { tx: '0x' + 'ab'.repeat(32), rank: 3, position: kind === 'small' ? 'New Holder' : 'Holder +45%', paid: true, socials: { x: 'https://x.com/', tg: 'https://t.me/monshionmonad' } };
  const caption = buyCaption(info, usd / 0.02, usd, tokens, '0x5db7CA9d2CE3f414B3fd94EC0FcaF9F3Ab1A575f', enr, x);
  const extra = buyButtons(info, enr, '0x' + 'ab'.repeat(32));
  const r = await sendBuyVideo(chat, videoFor(usd, tokens), caption, extra);
  console.log(r.ok ? `sample ${kind} alert sent` : `failed: ${r.description || 'see log'}`);
}

// ── Trending ───────────────────────────────────────────────────────────────
function loadBoosts() {
  // boosts.json: [{ "token": "0x..", "until": <unix seconds>, "by": "@handle" }]
  const now = Math.floor(Date.now() / 1000);
  return loadJson(BOOSTS_FILE, []).filter((b) => b && b.token && Number(b.until) > now)
    .map((b) => ({ token: b.token.toLowerCase(), until: Number(b.until), by: b.by || '' }));
}

// Grant (or extend) a boost from an on-chain MONSHI payment. Duration comes from
// the contract event (tier). Persists to boosts.json and posts a confirmation.
async function grantBoost(tokenAddr, durationSec, monshiPaid, payer) {
  const now = Math.floor(Date.now() / 1000);
  const addSec = Math.max(0, Math.round(durationSec));
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
  const hrs = addSec / 3600;
  const dur = hrs >= 24 ? `${(hrs / 24).toFixed(hrs % 24 ? 1 : 0)}d` : `${Math.round(hrs)}h`;
  const burned = Math.round(monshiPaid * 0.7);
  await send([
    `🚀🔥 <b>BOOST PURCHASED — NOW TRENDING</b>`,
    ``,
    label,
    `⏱ trending for <b>${dur}</b>`,
    `🔥 ${fmtMon(monshiPaid)} MONSHI paid · ${fmtMon(burned)} burned`,
    `👤 <a href="${EXPLORER}/address/${payer}">${short(payer)}</a>`,
    ``,
    `📈 <a href="${link}">Trade on Mon-Pad</a>`,
  ].join('\n'));
}

// Returns the highest block fully scanned. On a getLogs failure we STOP and return
// the safe high-water so tick() does not advance past the unscanned range — a paid
// boost in a skipped chunk would otherwise be lost forever (MONSHI already burned).
async function scanBoosts(from, to) {
  if (!BOOST_CONTRACT) return to;
  let safe = from - 1n;
  for (let start = from; start <= to; start += CHUNK + 1n) {
    const end = start + CHUNK > to ? to : start + CHUNK;
    let logs;
    try { logs = await client.getLogs({ address: BOOST_CONTRACT, event: BOOSTED_EVENT, fromBlock: start, toBlock: end }); }
    catch (e) { console.error(`boost getLogs ${start}-${end} failed:`, e.shortMessage || e.message); return safe; }
    for (const lg of logs) {
      const key = `boost:${lg.transactionHash}:${lg.logIndex}`;
      if (seenTx.has(key)) continue; seenTx.add(key);
      const monshiPaid = Number(formatEther(lg.args.amount ?? 0n));
      const durationSec = Number(lg.args.durationSec ?? 0n);
      try { await grantBoost(lg.args.token, durationSec, monshiPaid, lg.args.payer); }
      catch (e) { console.error('grantBoost failed:', e.message); }
    }
    safe = end;
  }
  return safe;
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
    const enr = await enrichToken(info).catch(() => null);
    const head = boost ? `🚀🔥 <b>BOOSTED &amp; TRENDING</b>` : `🔥 <b>NOW TRENDING</b>`;
    const line = [
      `${head}`,
      ``,
      `<b>${esc(info.name || info.symbol)}</b> ($${esc(info.symbol)})`,
      enr && enr.marketCapUsd > 0 ? `💰 MC: <b>${fmtUsd(enr.marketCapUsd)}</b>${enr.listed ? '' : ' (curve)'}` : '',
      `📊 ${fmtUsd(vol)} volume / ${Math.round(TREND_WINDOW_SEC / 60)}m`,
      boost && boost.by ? `⭐ boosted by ${esc(boost.by)}` : '',
    ].filter(Boolean).join('\n');
    await send(line, buyButtons(info, enr, null));
  }
}

// ── Scan loop ───────────────────────────────────────────────────────────────
// Returns the highest block fully scanned (see scanBoosts). Stops at the first
// failed chunk so tick() won't advance lastBlock past dropped buy alerts.
async function scanRange(from, to) {
  const usd = await getMonUsd();
  let safe = from - 1n;
  for (let start = from; start <= to; start += CHUNK + 1n) {
    const end = start + CHUNK > to ? to : start + CHUNK;
    let logs;
    try {
      logs = await client.getLogs({ event: TRADE_EVENT, fromBlock: start, toBlock: end });
    } catch (e) { console.error(`getLogs ${start}-${end} failed:`, e.shortMessage || e.message); return safe; }
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
        try {
          const enr = await enrichToken(info).catch(() => null);
          await announceBuy(info, mon, dollars, tokensOut, a.trader, lg.transactionHash, enr, lg.blockNumber);
        } catch (e) { console.error('announce failed:', e.message); }
      }
    }
    safe = end;
  }
  if (seenTx.size > 5000) { // keep the dedupe set bounded
    const keep = [...seenTx].slice(-2000); seenTx.clear(); keep.forEach((k) => seenTx.add(k));
  }
  return safe;
}

// Resolve the official Uniswap V3 pool for each GRADUATED token, so we can watch
// its Swap events (post-graduation buys no longer hit the curve's Trade event).
async function refreshGradPools() {
  const tracked = new Set([...gradPools.values()].map((g) => g.token.toLowerCase()));
  const newlyAdded = [];
  for (const info of curves.values()) {
    if (tracked.has(info.token.toLowerCase())) continue;
    let graduated = false;
    try { graduated = await client.readContract({ address: info.curve, abi: curveAbi, functionName: 'graduated' }); } catch { continue; }
    if (!graduated) continue;
    try {
      const pool = (await client.readContract({ address: OFFICIAL_V3_FACTORY, abi: v3FactoryAbi, functionName: 'getPool', args: [info.token, WMON, POOL_FEE] })).toLowerCase();
      if (!pool || pool === '0x0000000000000000000000000000000000000000') continue;
      const t0 = await client.readContract({ address: pool, abi: poolAbi, functionName: 'token0' });
      const g = { ...info, tokenIsToken0: t0.toLowerCase() === info.token.toLowerCase() };
      gradPools.set(pool, g);
      newlyAdded.push([pool, g]);
      console.log(`[grad] watching Uni-V3 pool ${pool} for ${info.symbol}`);
    } catch { /* pool not created yet */ }
  }
  // A token graduates between ticks; tick() has already advanced lastBlock past the
  // graduation, so buys in the discovery gap were never scanned for this pool.
  // Backfill those (skip the very first pass so startup doesn't re-announce old buys).
  if (gradInitialized) {
    for (const [pool, g] of newlyAdded) await backfillGradPool(pool, g).catch((e) => console.error('grad backfill failed:', e.message));
  }
  gradInitialized = true;
}

// Process one Uniswap V3 Swap log for a graduated pool: record it for organic
// trending and announce if it clears MIN_BUY_USD. Deduped by tx:logIndex.
async function handleGradSwap(g, lg, usd) {
  const key = `grad:${lg.transactionHash}:${lg.logIndex}`;
  if (seenTx.has(key)) return; seenTx.add(key);
  const { amount0, amount1 } = lg.args;
  // Token side leaving the pool (negative) = a BUY; the other (positive) side is WMON in.
  let wmonIn = 0n, tokensOut = 0n;
  if (g.tokenIsToken0) { if (amount0 < 0n) { tokensOut = -amount0; wmonIn = amount1; } }
  else { if (amount1 < 0n) { tokensOut = -amount1; wmonIn = amount0; } }
  if (wmonIn <= 0n || tokensOut <= 0n) return; // sell or zero — skip
  const mon = Number(formatEther(wmonIn));
  const dollars = mon * usd;
  // Feed graduated buys into the trending window too, so a graduated token can cross
  // TREND_THRESHOLD_USD organically (curve tokens already do this via scanRange).
  recentTrades.push({ token: g.token.toLowerCase(), usd: dollars, mon, time: Math.floor(Date.now() / 1000) });
  if (dollars < MIN_BUY_USD) return;
  let buyer = lg.args.recipient;
  try { const tx = await client.getTransaction({ hash: lg.transactionHash }); if (tx?.from) buyer = tx.from; } catch {}
  try {
    const enr = await enrichToken(g).catch(() => null);
    await announceBuy(g, mon, dollars, Number(formatEther(tokensOut)), buyer, lg.transactionHash, enr, lg.blockNumber);
  } catch (e) { console.error('grad announce failed:', e.message); }
}

// One-time bounded rescan of a single newly-discovered pool over the recent window,
// to catch buys that landed in the graduation→discovery gap.
async function backfillGradPool(pool, g) {
  const head = await client.getBlockNumber();
  const from = head > GRAD_BACKFILL ? head - GRAD_BACKFILL : 0n;
  const usd = await getMonUsd();
  for (let start = from; start <= head; start += CHUNK + 1n) {
    const end = start + CHUNK > head ? head : start + CHUNK;
    let logs;
    try { logs = await client.getLogs({ address: pool, event: V3_SWAP_EVENT, fromBlock: start, toBlock: end }); }
    catch (e) { console.error(`grad backfill getLogs ${start}-${end} failed:`, e.shortMessage || e.message); continue; }
    for (const lg of logs) await handleGradSwap(g, lg, usd);
  }
}

// Scan graduated tokens' Uniswap V3 pools for buys (WMON in → token out).
// Returns the highest block fully scanned (see scanBoosts/scanRange).
async function scanGradPools(from, to) {
  if (gradPools.size === 0) return to;
  const addrs = [...gradPools.keys()];
  const usd = await getMonUsd();
  let safe = from - 1n;
  for (let start = from; start <= to; start += CHUNK + 1n) {
    const end = start + CHUNK > to ? to : start + CHUNK;
    let logs;
    try { logs = await client.getLogs({ address: addrs, event: V3_SWAP_EVENT, fromBlock: start, toBlock: end }); }
    catch (e) { console.error(`grad getLogs ${start}-${end} failed:`, e.shortMessage || e.message); return safe; }
    for (const lg of logs) {
      const g = gradPools.get(lg.address.toLowerCase());
      if (!g) continue;
      await handleGradSwap(g, lg, usd);
    }
    safe = end;
  }
  return safe;
}

async function tick() {
  try {
    const head = await client.getBlockNumber();
    let from = state.lastBlock != null ? BigInt(state.lastBlock) + 1n : (head > MAX_CATCHUP ? head - MAX_CATCHUP : 0n);
    if (from > head) return;
    const rangeSafe = await scanRange(from, head);       // pre-graduation curve buys (any pad token)
    const gradSafe  = await scanGradPools(from, head);   // graduated tokens' Uniswap V3 pool buys
    const boostSafe = await scanBoosts(from, head);      // paid boosts
    // Advance lastBlock only to the block ALL scanners fully covered. If any chunk
    // failed, its range is rescanned next tick (seenTx dedupes already-announced
    // events) rather than being skipped forever.
    const advanceTo = [rangeSafe, gradSafe, boostSafe].reduce((m, v) => (v < m ? v : m), head);
    if (advanceTo >= from) {
      state.lastBlock = advanceTo.toString();
      state.seenTx = [...seenTx].slice(-2000); // persist dedupe so a restart doesn't replay
      saveJson(STATE_FILE, state);
    }
  } catch (e) { console.error('tick failed:', e.message); }
}

// ── Boot ─────────────────────────────────────────────────────────────────
async function main() {
  const testArg = process.argv.find((a) => a.startsWith('--test-alert'));
  if (testArg) { await runTestAlert(testArg, process.argv.find((a) => a.startsWith('--chat='))); return; }
  console.log(`monpad-bot → chat ${TELEGRAM_CHAT_ID} | factory ${FACTORY_V3} | min buy $${MIN_BUY_USD}`);
  console.log(BOOST_CONTRACT ? `boost contract ${BOOST_CONTRACT} (MONSHI-paid, tiered)` : 'boost contract: (not set — paid trending disabled)');
  await refreshTokens();
  await refreshGradPools();
  console.log(`tracking ${curves.size} tokens, ${gradPools.size} graduated pools`);
  await getMonUsd();
  console.log(`MON/USD = $${monUsd}`);

  setInterval(refreshTokens, TOKENS_REFRESH_MS);
  setInterval(() => { refreshGradPools().catch((e) => console.error('gradPools failed:', e.message)); }, TOKENS_REFRESH_MS);
  setInterval(tick, POLL_MS);
  setInterval(() => { checkTrending().catch((e) => console.error('trending failed:', e.message)); }, TREND_CHECK_MS);
  await tick();
  console.log('bot running.');
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
