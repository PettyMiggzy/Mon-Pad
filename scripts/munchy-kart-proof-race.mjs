/**
 * Proof helper: race screenshots + WebM + Phaser FPS (4x CPU throttle).
 * Run: node scripts/munchy-kart-proof-race.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.MK_URL || 'http://localhost:3000/games/monshi-kart/index.html';
const outDir = '/opt/cursor/artifacts';
const shotDir = join(outDir, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const save = {
  milk: 500, cars: [1], car: 1,
  inv: { nitro: 5, shield: 5, magnet: 0 },
  up: { engine: 0, zap: 3, tires: 0 },
  best: 0, races: 0,
};

async function raceSession(page, w, h, shotName) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(base, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate((s) => localStorage.setItem('mk_save_v1', JSON.stringify(s)), save);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 120000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const g = window.MunchyKart?.game;
    if (g && !g.scene.isActive('race')) g.scene.start('race');
  });
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(450);
  }
  await page.keyboard.press('n');
  await page.waitForTimeout(1200);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shotDir, shotName) });
  console.log('wrote', join(shotDir, shotName));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  recordVideo: { dir: join(outDir, 'videos'), size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

await raceSession(page, 1440, 900, 'munchy-item3-desktop.png');
await raceSession(page, 390, 844, 'munchy-item3-phone.png');

await page.waitForTimeout(3000);
const fps = await page.evaluate(() => {
  const g = window.MunchyKart?.game;
  if (!g || !g.loop) return { actual: null, target: null };
  return { actual: g.loop.actualFps, target: g.loop.targetFps };
});
console.log('FPS (4x CPU throttle, Phaser loop):', JSON.stringify(fps));

await context.close();
await browser.close();

const vdir = join(outDir, 'videos');
const webm = readdirSync(vdir).find((f) => f.endsWith('.webm'));
if (webm) {
  copyFileSync(join(vdir, webm), join(outDir, 'munchy-item3-race-animations.webm'));
  console.log('wrote', join(outDir, 'munchy-item3-race-animations.webm'));
}
