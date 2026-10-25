import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const js = readFileSync(join(process.cwd(), 'public/games/monshi-kart/game.js'), 'utf8');
const need = ['POWERUPS', 'loadout', 'LOADOUT_SLOTS', 'POWER-UPS', 'applyLoadout', 'Berry Bolt', 'Ghost Sip', 'Double Chug'];
const missing = need.filter((s) => !js.includes(s));
if (missing.length) {
  console.error('FAIL missing:', missing.join(', '));
  process.exit(1);
}
if (!js.includes('id: 8,')) {
  console.error('FAIL expected 8 cars');
  process.exit(1);
}
if ((js.match(/id: '/g) || []).length < 6) {
  console.error('FAIL expected 6+ power-ups');
  process.exit(1);
}
console.log('OK munchy-kart loadout:', need.length, 'checks');
