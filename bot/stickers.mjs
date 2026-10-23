#!/usr/bin/env node
// Monshi's animated stickers: preview them in a chat, or publish them as a Telegram sticker pack.
//
//   TELEGRAM_BOT_TOKEN=... node bot/stickers.mjs preview --chat=<chat id>
//   TELEGRAM_BOT_TOKEN=... node bot/stickers.mjs publish --owner=<your telegram user id> [--name=monshi] [--title="Monshi"]
//
// `preview` sends each sticker to one chat (your DM) so you can look at them first.
// `publish` creates a PUBLIC sticker pack owned by --owner (link: t.me/addstickers/<name>_by_<botusername>) from
// bot/assets/stickers/*.webm. The stickers are made by bot/video/render-stickers.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = process.env.TG_API || 'https://api.telegram.org';
if (!TOKEN) { console.error('Set TELEGRAM_BOT_TOKEN'); process.exit(1); }
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets/stickers');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const cmd = process.argv[2];

// one emoji per pose so each sticker shows up when someone types it
const EMOJI = { celebrate: '🎉', wave: '👋', dance: '🕺', facepalm: '🤦', hype: '🙌', angry: '😡', happy: '😺', sleepy: '😴' };
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.webm')).sort();
const poseOf = (f) => f.replace(/^monshi-/, '').replace(/\.webm$/, '');
if (!files.length) { console.error('No stickers in', DIR, '- run node bot/video/render-stickers.mjs'); process.exit(1); }

async function call(method, form) {
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, { method: 'POST', body: form });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || res.status}`);
  return j.result;
}
const blob = (f) => new Blob([fs.readFileSync(path.join(DIR, f))], { type: 'video/webm' });

if (cmd === 'preview') {
  const chat = arg('chat'); if (!chat) { console.error('--chat=<id> required'); process.exit(1); }
  for (const f of files) {
    const form = new FormData();
    form.append('chat_id', chat); form.append('emoji', EMOJI[poseOf(f)] || '😺');
    form.append('sticker', blob(f), f);
    await call('sendSticker', form);
    console.log('sent', f);
  }
} else if (cmd === 'publish') {
  const owner = arg('owner'); if (!owner) { console.error('--owner=<telegram user id> required'); process.exit(1); }
  const me = await (await fetch(`${API}/bot${TOKEN}/getMe`)).json();
  const name = `${arg('name') || 'monshi'}_by_${me.result.username}`;
  const title = arg('title') || 'Monshi';
  const stickers = files.map((f) => ({ sticker: `attach://${poseOf(f)}`, format: 'video', emoji_list: [EMOJI[poseOf(f)] || '😺'] }));
  const form = new FormData();
  form.append('user_id', owner); form.append('name', name); form.append('title', title);
  form.append('stickers', JSON.stringify(stickers));
  for (const f of files) form.append(poseOf(f), blob(f), f);
  await call('createNewStickerSet', form);
  console.log(`published: https://t.me/addstickers/${name}`);
} else {
  console.error('usage: stickers.mjs preview --chat=<id> | publish --owner=<user id>');
  process.exit(1);
}
