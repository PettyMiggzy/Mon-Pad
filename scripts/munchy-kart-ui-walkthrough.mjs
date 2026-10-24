/**
 * Click-through: buy car, equip, buy power-ups, fill 2 slots, start race.
 */
import { chromium } from 'playwright';

const base = process.env.MK_URL || 'http://localhost:3000/games/munchy-kart/index.html';
const log = (m) => console.log('UI_WALK:', m);

const save = {
  milk: 2000, cars: [1], car: 1,
  inv: { nitro: 0, shield: 0, magnet: 0, turbo: 0, ghost: 0, double: 0 },
  loadout: [null, null],
  up: { engine: 0, zap: 0, tires: 0 },
  best: 0, races: 0,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.evaluate((s) => localStorage.setItem('mk_save_v1', JSON.stringify(s)), save);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForTimeout(1500);

async function tapNorm(nx, ny) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny);
}

log('1. CARS — tap > once to preview Zoomer (car 2)');
await tapNorm(0.917, 0.5);
await page.waitForTimeout(500);

log('2. Tap BUY 250 MILK (center bottom car button)');
await tapNorm(0.5, 0.809);
await page.waitForTimeout(700);

let snap = await page.evaluate(() => JSON.parse(localStorage.getItem('mk_save_v1') || '{}'));
log(`   after car: cars=${JSON.stringify(snap.cars)} car=${snap.car} milk=${snap.milk}`);

log('3. Tap POWER-UPS tab');
await tapNorm(0.5, 0.131);
await page.waitForTimeout(600);

log('4. Buy Nitro (price button right)');
await tapNorm(0.778, 0.347);
await page.waitForTimeout(500);

log('5. Buy Shield');
await tapNorm(0.778, 0.425);
await page.waitForTimeout(500);

log('6. Scroll list and buy Double Chug');
await page.mouse.move(195, 500);
await page.mouse.wheel(0, 350);
await page.waitForTimeout(400);
await tapNorm(0.778, 0.72);
await page.waitForTimeout(500);

log('7. Equip Nitro → slot 1 (tap card left)');
await tapNorm(0.22, 0.347);
await page.waitForTimeout(400);

log('8. Equip Shield → slot 2');
await tapNorm(0.22, 0.425);
await page.waitForTimeout(400);

snap = await page.evaluate(() => JSON.parse(localStorage.getItem('mk_save_v1') || '{}'));
log(`   loadout=${JSON.stringify(snap.loadout)} inv=${JSON.stringify(snap.inv)}`);

log('9. Tap RACE (full-width footer, autopilot race)');
await tapNorm(0.5, 0.914);
await page.waitForTimeout(2500);

const inRace = await page.evaluate(() => window.MunchyKart?.game?.scene?.isActive('race'));
log(`   race scene active: ${inRace}`);

await page.screenshot({ path: '/opt/cursor/artifacts/screenshots/munchy-item5-ui-race.png' });
log('   screenshot: munchy-item5-ui-race.png');

await browser.close();

const ok = inRace && snap.loadout?.[0] && snap.loadout?.[1];
if (!ok) process.exit(1);
