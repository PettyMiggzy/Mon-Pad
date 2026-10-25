/** Smoke check for desktop phone shell markup (no browser). Not served from public/. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const htmlPath = join(process.cwd(), 'public/games/monshi-kart/index.html');
const html = readFileSync(htmlPath, 'utf8');
const need = ['id="shell"', 'id="phone"', 'id="phone-notch"', 'min-width:768px', 'max-width:767px'];
const missing = need.filter((s) => !html.includes(s));
if (missing.length) {
  console.error('FAIL missing:', missing.join(', '));
  process.exit(1);
}
console.log('OK munchy-kart shell markup:', need.length, 'checks');
