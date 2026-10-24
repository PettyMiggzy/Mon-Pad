/** Smoke check for race animation hooks (not served from public/). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const js = readFileSync(join(process.cwd(), 'public/games/munchy-kart/game.js'), 'utf8');
const need = ['zapRecoil', 'bumpMilkHud', 'shieldGfx', 'nitroFx', 'rivalBoom', 'milkPop', 'fxGfx'];
const missing = need.filter((s) => !js.includes(s));
if (missing.length) {
  console.error('FAIL missing:', missing.join(', '));
  process.exit(1);
}
console.log('OK munchy-kart race animations:', need.length, 'checks');
