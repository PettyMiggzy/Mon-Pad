/**
 * Proof: loadout UI screenshots + autopilot spill benchmark (10 seeds).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const base = process.env.MK_URL || 'http://localhost:3000/games/monshi-kart/index.html';
const outDir = '/opt/cursor/artifacts';
const shotDir = join(outDir, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const save = {
  milk: 1200, cars: [1, 2], car: 1,
  inv: { nitro: 2, shield: 1, magnet: 1, turbo: 0, ghost: 1, double: 0 },
  loadout: ['shield', 'nitro'],
  up: { engine: 0, zap: 1, tires: 0 },
  best: 0, races: 0,
};

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.evaluate((s) => localStorage.setItem('mk_save_v1', JSON.stringify(s)), save);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas', { timeout: 120000 });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const g = window.MunchyKart.game.scene.getScene('garage');
  g.tab = 'powerups';
  g.draw();
});
await page.waitForTimeout(400);

await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: join(shotDir, 'munchy-item5-desktop.png') });
console.log('wrote', join(shotDir, 'munchy-item5-desktop.png'));

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: join(shotDir, 'munchy-item5-phone.png') });
console.log('wrote', join(shotDir, 'munchy-item5-phone.png'));

await browser.close();

const bench = spawnSync('node', ['scripts/munchy-kart-benchmark-spills.mjs'], { encoding: 'utf8', cwd: process.cwd() });
console.log(bench.stdout);
if (bench.status !== 0) {
  console.error(bench.stderr || 'benchmark failed');
  process.exit(bench.status || 1);
}
