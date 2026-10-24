/** Mean red-candle hits (spills) over N seeded autopilot runs. */
import { chromium } from 'playwright';

const base = process.env.MK_URL || 'http://localhost:3000/games/munchy-kart/index.html';
const save = {
  milk: 500, cars: [1], car: 1,
  inv: { nitro: 0, shield: 0, magnet: 0, turbo: 0, ghost: 0, double: 0 },
  loadout: [null, null],
  up: { engine: 1, zap: 2, tires: 1 },
  best: 0, races: 0,
};

const seeds = [42424242, 987654321, 135791113, 246813579, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.evaluate((s) => localStorage.setItem('mk_save_v1', JSON.stringify(s)), save);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.MunchyKart?.runDeterministicAutopilot, null, { timeout: 60000 });

const rows = [];
for (const seed of seeds) {
  const r = await page.evaluate(async (s) => window.MunchyKart.runDeterministicAutopilot(s), seed);
  rows.push({ seed, spills: r.spills, milk: r.milk });
  console.log('seed', seed, 'spills', r.spills, 'milk', r.milk);
}
await browser.close();

const avg = rows.reduce((a, b) => a + b.spills, 0) / rows.length;
console.log('AUTOPILOT_SPILL_AVG_10', avg.toFixed(2));
console.log('AUTOPILOT_SPILL_MAX', Math.max(...rows.map((r) => r.spills)));
if (avg >= 5) process.exit(1);
