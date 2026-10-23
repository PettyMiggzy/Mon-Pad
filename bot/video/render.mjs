#!/usr/bin/env node
// Renders the 3D "buy" videos for the Telegram bot: bot/assets/buy-{small,big,whale}.mp4
//
//   npm i --no-save playwright-core        (once; Chromium is already on most dev boxes)
//   node bot/video/render.mjs [small|big|whale ...]
//
// Needs: ffmpeg on PATH, the repo's node_modules (three), public/models/monshi.glb, public/fonts/RussoOne.json.
// Deterministic: every run produces the same frames.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'bot/assets');
const FPS = 30;
const SIZE = Number(process.env.SIZE || 720);
const tiers = process.argv.slice(2).length ? process.argv.slice(2) : ['small', 'big', 'whale'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.ttf': 'font/ttf' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = decodeURIComponent(url.pathname);
  if (file === '/') file = '/bot/video/scene.html';
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const exe = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
fs.mkdirSync(OUT, { recursive: true });

for (const tier of tiers) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`http://localhost:${port}/bot/video/scene.html?tier=${tier}&size=${SIZE}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  const duration = await page.evaluate(() => window.DURATION);
  const frames = Math.round(duration * FPS);
  const dir = fs.mkdtempSync(path.join(OUT, `.frames-${tier}-`));
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.setT(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) });
  }
  await page.close();
  const out = path.join(OUT, `buy-${tier}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
    '-vf', `scale=${SIZE}:${SIZE},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', '-an', out]);
  if (process.env.KEEP_FRAMES) console.log('frames kept in', dir);
  else fs.rmSync(dir, { recursive: true, force: true });
  console.log(tier, '->', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
}
await browser.close();
server.close();
