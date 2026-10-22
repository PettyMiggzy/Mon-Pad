#!/usr/bin/env node
/**
 * Monpad Telegram games — /meow (daily milk roll), /milk (your stats), /top (leaderboard),
 * plus random "Flash Meow" drops where the first few to answer get double milk.
 *
 * Standalone: no dependencies, Node 18+. Runs as its own process so it never fights the
 * buy bot. Use a SEPARATE bot token if the old /meow bot is still alive anywhere
 * (two processes polling one token steal each other's updates).
 *
 *   GAMES_BOT_TOKEN   token from @BotFather (falls back to TELEGRAM_BOT_TOKEN)
 *   GAMES_CHAT_ID     the group id/@name used for Flash Meow drops (optional)
 *   SITE_URL          for the Monshi pictures and links (default https://www.monpad.net)
 *   FLASH_MIN_HOURS / FLASH_MAX_HOURS   gap between drops (default 6 / 14). 0 = off.
 *   TG_API            override the Telegram API base (used by the smoke test)
 */
import fs from 'node:fs';

const TOKEN = process.env.GAMES_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const API = (process.env.TG_API || 'https://api.telegram.org') + '/bot' + TOKEN;
const SITE = (process.env.SITE_URL || 'https://www.monpad.net').replace(/\/$/, '');
const FLASH_CHAT = process.env.GAMES_CHAT_ID || '';
const FLASH_MIN = Number(process.env.FLASH_MIN_HOURS ?? '6');
const FLASH_MAX = Number(process.env.FLASH_MAX_HOURS ?? '14');
const FLASH_WINDOW_MS = 90_000;
const FLASH_WINNERS = 3;
const STATE_FILE = new URL('./games-state.json', import.meta.url);

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const day = (d = new Date()) => d.toISOString().slice(0, 10);

// ── game rules (pure, so they can be tested) ────────────────────────────────
export function rollMilk(rand = Math.random) {
  const r = rand();
  if (r < 0.01) return { ml: 1000, tier: 'golden' };
  if (r < 0.10) return { ml: 151 + Math.floor(rand() * 150), tier: 'rare' };
  if (r < 0.40) return { ml: 51 + Math.floor(rand() * 100), tier: 'good' };
  return { ml: 5 + Math.floor(rand() * 46), tier: 'common' };
}

const TITLES = [
  [0, 'Stray Kitten'], [500, 'Alley Cat'], [2000, 'Couch Lord'], [6000, 'Milk Baron'],
  [15000, 'Cream Cartel'], [40000, 'Monshi’s Inner Circle'],
];
export const titleFor = (total) => TITLES.filter(([min]) => total >= min).pop()[1];

const LINES = {
  common: ['laps it up quietly.', 'gets a small saucer.', 'steals a sip off the counter.'],
  good: ['hits the good bowl.', 'gets the fresh carton.', 'is purring loud enough to wake the block.'],
  rare: ['finds a whole jug.', 'raids the fridge at 3am.', 'gets the cream off the top.'],
  golden: ['FOUND THE GOLDEN MILK.', 'IS NOW A LEGEND.'],
};
const pick = (a, rand = Math.random) => a[Math.floor(rand() * a.length)];

const FLASH_CAPTIONS = [
  'Monshi just knocked a glass off the table and looked you dead in the eye.',
  'Monshi is sitting in a box that is way too small. He refuses to leave.',
  'Zoomies at 3am. Monshi has no idea why either.',
  'Monshi is judging your portfolio from the top of the fridge.',
  'Monshi found the milk. Type /meow before he drinks it all.',
];
const FLASH_IMAGES = ['/meshy/monshi-mascot.png', '/meshy/monchi.png', '/meshy/hero.png'];

// ── state ───────────────────────────────────────────────────────────────────
let state = { chats: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* first run */ }
const save = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error('save failed', e.message); } };
const chatOf = (id) => (state.chats[id] ||= { users: {}, flash: null });
const userOf = (chat, u) => {
  const rec = (chat.users[u.id] ||= { name: '', total: 0, last: '', streak: 0, best: 0, plays: 0 });
  rec.name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || String(u.id);
  return rec;
};

export function playMeow(chat, user, now = new Date(), rand = Math.random) {
  const rec = userOf(chat, user);
  const today = day(now);
  const flash = chat.flash && now.getTime() < chat.flash.until ? chat.flash : null;
  const flashBonus = flash && !flash.claimed.includes(String(user.id)) && flash.claimed.length < FLASH_WINNERS;
  if (rec.last === today && !flashBonus) return { ok: false, rec };
  const roll = rollMilk(rand);
  let ml = roll.ml;
  if (flashBonus) { ml *= 2; flash.claimed.push(String(user.id)); }
  if (rec.last !== today) {
    const yesterday = day(new Date(now.getTime() - 86_400_000));
    rec.streak = rec.last === yesterday ? rec.streak + 1 : 1;
    rec.last = today;
  }
  rec.total += ml; rec.plays += 1; rec.best = Math.max(rec.best, ml);
  return { ok: true, rec, ml, tier: roll.tier, flashBonus: !!flashBonus };
}

const board = (chat, n = 10) =>
  Object.values(chat.users).sort((a, b) => b.total - a.total).slice(0, n);

// ── Telegram ────────────────────────────────────────────────────────────────
async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`${method}: ${d.description || r.status}`);
  return d.result;
}
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

export function reply(msg, now = new Date(), rand = Math.random) {
  const text = (msg.text || '').trim();
  const m = /^\/(meow|milk|top|meowhelp)(?:@\w+)?(?:\s|$)/i.exec(text);
  if (!m || !msg.from || msg.from.is_bot) return null;
  const cmd = m[1].toLowerCase();
  const chat = chatOf(msg.chat.id);
  const who = `<b>${esc([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || 'cat')}</b>`;

  if (cmd === 'meow') {
    const r = playMeow(chat, msg.from, now, rand);
    if (!r.ok) return `${who} already got milk today. Come back tomorrow. You have ${r.rec.total} ml (${titleFor(r.rec.total)}).`;
    const tag = r.tier === 'golden' ? '🥇' : r.tier === 'rare' ? '✨' : '🥛';
    const flash = r.flashBonus ? ' ⚡ <b>Flash Meow bonus x2!</b>' : '';
    return `${tag} ${who} ${pick(LINES[r.tier], rand)} <b>+${r.ml} ml</b>${flash}\nTotal: ${r.rec.total} ml · ${titleFor(r.rec.total)} · 🔥 ${r.rec.streak}-day streak`;
  }
  if (cmd === 'milk') {
    const rec = chat.users[msg.from.id];
    if (!rec) return `${who} hasn't had milk yet. Type /meow.`;
    const rank = Object.values(chat.users).sort((a, b) => b.total - a.total).findIndex((u) => u === rec) + 1;
    return `🥛 ${who}\n${rec.total} ml · ${titleFor(rec.total)}\nRank #${rank} · best roll ${rec.best} ml · 🔥 ${rec.streak}-day streak`;
  }
  if (cmd === 'top') {
    const rows = board(chat);
    if (!rows.length) return 'Nobody has had milk yet. Type /meow.';
    return '🏆 <b>Milk leaderboard</b>\n' + rows.map((u, i) => `${i + 1}. ${esc(u.name)} — ${u.total} ml`).join('\n');
  }
  return '/meow — your daily milk roll\n/milk — your stats\n/top — leaderboard\nWatch for ⚡ Flash Meow drops: first 3 to /meow get double.';
}

async function flashDrop() {
  if (!FLASH_CHAT) return;
  const chat = chatOf(FLASH_CHAT);
  chat.flash = { until: Date.now() + FLASH_WINDOW_MS, claimed: [] };
  save();
  const photo = SITE + pick(FLASH_IMAGES);
  const caption = `⚡ <b>FLASH MEOW</b> ⚡\n${pick(FLASH_CAPTIONS)}\nFirst ${FLASH_WINNERS} to type /meow in the next 90 seconds get <b>double milk</b>.`;
  try { await tg('sendPhoto', { chat_id: FLASH_CHAT, photo, caption, parse_mode: 'HTML' }); }
  catch { await say(FLASH_CHAT, caption).catch((e) => console.error('flash failed', e.message)); }
}

function scheduleFlash() {
  if (!FLASH_CHAT || FLASH_MIN <= 0) return;
  const hours = FLASH_MIN + Math.random() * Math.max(0, FLASH_MAX - FLASH_MIN);
  setTimeout(async () => { await flashDrop(); scheduleFlash(); }, hours * 3_600_000);
}

async function main() {
  if (!TOKEN) throw new Error('Set GAMES_BOT_TOKEN (or TELEGRAM_BOT_TOKEN)');
  console.log('monpad-games running');
  scheduleFlash();
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const out = u.message && reply(u.message);
        if (out) { await say(u.message.chat.id, out, { reply_to_message_id: u.message.message_id }).catch((e) => console.error('send failed', e.message)); save(); }
      }
    } catch (e) {
      console.error('poll failed:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
