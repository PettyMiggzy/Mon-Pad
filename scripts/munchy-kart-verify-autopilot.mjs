/** Smoke check for seeded autopilot hooks (not served from public/). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const js = readFileSync(join(process.cwd(), 'public/games/munchy-kart/game.js'), 'utf8');
const need = [
  'mulberry32',
  'AUTOPILOT',
  'autopilotThink',
  'runDeterministicAutopilot',
  'syncSim',
  'fixedStep',
  'MSG_MAX_W',
  'autopilot: true',
];
const missing = need.filter((s) => !js.includes(s));
if (missing.length) {
  console.error('FAIL missing:', missing.join(', '));
  process.exit(1);
}
console.log('OK munchy-kart autopilot:', need.length, 'checks');
