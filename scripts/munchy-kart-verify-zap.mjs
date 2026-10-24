/** Smoke check: green-candle zap replaces beam (not served from public/). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const js = readFileSync(join(process.cwd(), 'public/games/munchy-kart/game.js'), 'utf8');
const need = ['zapBolts', 'candleG', 'muzzleFlash', 'zapTrail', 'zapImpactFx', 'resolveZapHit'];
const forbid = ['this.beam.clear().lineStyle(16, 0x39ff88'];
const missing = need.filter((s) => !js.includes(s));
const bad = forbid.filter((s) => js.includes(s));
if (missing.length || bad.length) {
  console.error('FAIL missing:', missing.join(', '), 'forbidden:', bad.join(', '));
  process.exit(1);
}
console.log('OK munchy-kart green candle zap:', need.length, 'checks');
