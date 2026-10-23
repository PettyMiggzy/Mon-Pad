#!/usr/bin/env node
// Renders the spinning Monshi coin custom emoji: bot/assets/emoji/monshi-spin.webm (100x100, WebM/VP9, transparent, 2 s loop).
//   npm i --no-save playwright-core && node bot/video/render-emoji.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'bot/assets/emoji'); const FPS = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => { const f = decodeURIComponent(new URL(req.url, 'http://x').pathname); const full = path.join(ROOT, f); if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${server.address().port}/bot/video/emoji.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const T = await page.evaluate(() => window.T); fs.mkdirSync(OUT, { recursive: true });
const dir = fs.mkdtempSync(path.join(OUT, '.f-'));
const n = Math.round(T * FPS);
for (let i = 0; i < n; i++) { await page.evaluate((t) => window.setT(t), i / FPS); await page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`), omitBackground: true }); }
const out = path.join(OUT, 'monshi-spin.webm');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%03d.png'), '-vf', 'scale=100:100:flags=lanczos,format=yuva420p',
  '-t', String(T), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0', '-an', '-r', String(FPS), out]);
console.log('emoji ->', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
if (!process.env.KEEP_FRAMES) fs.rmSync(dir, { recursive: true, force: true });
await browser.close(); server.close();
