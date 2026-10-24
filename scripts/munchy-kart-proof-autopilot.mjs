/**
 * Proof: deterministic autopilot + screenshots (desktop / phone).
 * Run: npm run dev & node scripts/munchy-kart-proof-autopilot.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.MK_URL || 'http://localhost:3000/games/munchy-kart/index.html';
const outDir = '/opt/cursor/artifacts';
const shotDir = join(outDir, 'screenshots');
mkdirSync(shotDir, { recursive: true });

const save = {
  milk: 500, cars: [1], car: 1,
  inv: { nitro: 3, shield: 0, magnet: 0 },
  up: { engine: 1, zap: 2, tires: 1 },
  best: 0, races: 0,
};

async function runSeed(page, seed) {
  return page.evaluate(async (s) => {
    const r = await window.MunchyKart.runDeterministicAutopilot(s);
    return JSON.stringify(r);
  }, seed >>> 0);
}

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.evaluate((s) => localStorage.setItem('mk_save_v1', JSON.stringify(s)), save);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas', { timeout: 120000 });
await page.waitForFunction(() => window.MunchyKart?.runDeterministicAutopilot, null, { timeout: 60000 });

const seedA = 42424242;
const seedB = 987654321;

const a1 = JSON.parse(await runSeed(page, seedA));
const a2 = JSON.parse(await runSeed(page, seedA));
const b1 = JSON.parse(await runSeed(page, seedB));

console.log('seed', seedA, 'run1', JSON.stringify(a1));
console.log('seed', seedA, 'run2', JSON.stringify(a2));
console.log('seed', seedB, 'run1', JSON.stringify(b1));
console.log('same-seed-identical', JSON.stringify(a1) === JSON.stringify(a2));
console.log('different-seeds-differ', JSON.stringify(a1) !== JSON.stringify(b1));

if (JSON.stringify(a1) !== JSON.stringify(a2)) {
  console.error('FAIL same seed produced different results');
  process.exit(1);
}
if (JSON.stringify(a1) === JSON.stringify(b1)) {
  console.error('FAIL different seeds produced identical results');
  process.exit(1);
}
console.log('OK deterministic autopilot proof');

await page.evaluate((s) => {
  window.MunchyKart.onFinish = () => {};
  window.MunchyKart.game.scene.start('race', { seed: s, autopilot: true, skipPersist: true });
}, seedA);
await page.waitForTimeout(8000);
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(500);
await page.screenshot({ path: join(shotDir, 'munchy-item4-desktop.png') });
console.log('wrote', join(shotDir, 'munchy-item4-desktop.png'));

await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate((s) => {
  window.MunchyKart.game.scene.start('race', { seed: s, autopilot: true, skipPersist: true });
}, seedA);
await page.waitForTimeout(6000);
await page.screenshot({ path: join(shotDir, 'munchy-item4-phone.png') });
console.log('wrote', join(shotDir, 'munchy-item4-phone.png'));

await browser.close();
