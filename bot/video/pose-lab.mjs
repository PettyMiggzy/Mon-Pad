// Developer tool: render a contact sheet of arbitrary bone rotations to find good sticker poses.
//   node bot/video/pose-lab.mjs out.png '{"name":{"RightForeArm":[0,0,-1]}, ...}'
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => { const f = decodeURIComponent(new URL(req.url, 'http://x').pathname); const full = path.join(ROOT, f); if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res); });
await new Promise((r) => server.listen(0, r));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 512, height: 512 } });
await pg.goto(`http://localhost:${server.address().port}/bot/video/sticker.html`);
await pg.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const cfgs = JSON.parse(process.argv[3]); const outDir = path.dirname(process.argv[2]);
let i = 0; for (const [name, cfg] of Object.entries(cfgs)) { await pg.evaluate((c) => window.custom(c), cfg); await pg.screenshot({ path: path.join(outDir, `.lab-${String(i++).padStart(2, '0')}-${name}.png`), omitBackground: true }); }
await b.close(); server.close(); console.log('rendered', i);
