/** Smoke check for desktop phone shell markup (no browser). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const need = ['id="shell"', 'id="phone"', 'id="phone-notch"', 'min-width:768px', 'max-width:767px'];
const missing = need.filter((s) => !html.includes(s));
if (missing.length) {
  console.error('FAIL missing:', missing.join(', '));
  process.exit(1);
}
console.log('OK munchy-kart shell markup:', need.length, 'checks');
