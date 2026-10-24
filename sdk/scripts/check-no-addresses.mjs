#!/usr/bin/env node
/** Fail CI if a literal 0x…40 hex address appears outside chain-config.ts */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../src');
const allow = new Set(['chain-config.ts']);
const re = /0x[a-fA-F0-9]{40}/g;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (name.endsWith('.ts')) files.push(p);
  }
  return files;
}

let failed = false;
for (const file of walk(root)) {
  const rel = file.slice(root.length + 1);
  if (allow.has(rel)) continue;
  const hits = readFileSync(file, 'utf8').match(re);
  if (hits?.length) {
    console.error(`${rel}: hardcoded address(es): ${[...new Set(hits)].join(', ')}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('ok: no hardcoded addresses outside chain-config.ts');
