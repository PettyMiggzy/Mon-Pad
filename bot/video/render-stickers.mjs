#!/usr/bin/env node
// Renders Monshi's animated Telegram stickers (transparent WebM/VP9, 512px, 2 s loop) into bot/assets/stickers/.
//
//   npm i --no-save playwright-core        (once)
//   node bot/video/render-stickers.mjs               # all poses
//   node bot/video/render-stickers.mjs wave dance    # some poses
//   SHEET=1 node bot/video/render-stickers.mjs       # contact sheet only (bot/assets/stickers/.sheet.png), no encode
//
// Telegram rules (core.telegram.org/stickers): WebM VP9, one side exactly 512 px, up to 3 s, up to 30 fps,
// under 256 KB, no audio, looped. No text on the stickers. A white outline is added so they read on any chat theme.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'bot/assets/stickers');
const FPS = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const f = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const full = path.join(ROOT, f);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://localhost:${server.address().port}/bot/video/sticker.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const all = await page.evaluate(() => Object.keys(window.POSES));
const poses = process.argv.slice(2).length ? process.argv.slice(2) : all;
const T = await page.evaluate(() => window.T);
fs.mkdirSync(OUT, { recursive: true });

// white outline: dilate the alpha, paint it white, put the character on top
const OUTLINE = '[0:v]format=rgba,split=2[fg][m];[m]alphaextract,' + Array(7).fill('dilation=coordinates=255').join(',') +
  '[mask];color=c=white:s=512x512:r=30,format=rgba[w];[w][mask]alphamerge[ring];[ring][fg]overlay=format=auto,format=yuva420p';

if (process.env.SHEET) {
  const frames = [];
  for (const name of poses) for (const f of [0.0, 0.25, 0.5, 0.75]) {
    await page.evaluate(([n, t]) => window.setPose(n, t), [name, f * T]);
    const file = path.join(OUT, `.s-${name}-${f}.png`); await page.screenshot({ path: file, omitBackground: true }); frames.push(file);
  }
  console.log(frames.join('\n'));
} else {
  const n = Math.round(T * FPS);
  for (const name of poses) {
    const dir = fs.mkdtempSync(path.join(OUT, `.f-${name}-`));
    for (let i = 0; i < n; i++) {
      await page.evaluate(([nm, t]) => window.setPose(nm, t), [name, i / FPS]);
      await page.screenshot({ path: path.join(dir, `f${String(i).padStart(3, '0')}.png`), omitBackground: true });
    }
    const out = path.join(OUT, `monshi-${name}.webm`);
    let crf = 34;
    for (;;) { // raise the compression until the file fits Telegram's 256 KB limit
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%03d.png'), '-filter_complex', OUTLINE,
        '-t', String(T), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', String(crf), '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-an', '-r', String(FPS), out]);
      const kb = fs.statSync(out).size / 1024;
      if (kb <= 250 || crf >= 55) { console.log(name, '->', out, kb.toFixed(0) + ' KB (crf ' + crf + ')'); break; }
      crf += 3;
    }
    if (!process.env.KEEP_FRAMES) fs.rmSync(dir, { recursive: true, force: true });
  }
}
await browser.close();
server.close();
