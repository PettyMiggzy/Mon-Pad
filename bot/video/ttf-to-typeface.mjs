#!/usr/bin/env node
// Converts public/fonts/RussoOne-Regular.ttf into the "typeface.json" format three.js TextGeometry reads,
// for the glyphs the buy video needs (A-Z, 0-9, space, a few symbols).
//   npm i --no-save opentype.js@1 && node bot/video/ttf-to-typeface.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const font = opentype.loadSync(path.join(ROOT, 'public/fonts/RussoOne-Regular.ttf'));
const upm = font.unitsPerEm;
const k = 1000 / upm; // typeface resolution = 1000
const chars = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$!+-.,%';
const r = (n) => Math.round(n * k);
const glyphs = {};
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  let o = '';
  for (const c of g.path.commands) {
    if (c.type === 'M') o += `m ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'L') o += `l ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'Q') o += `q ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} `;
    else if (c.type === 'C') o += `b ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} `;
    else if (c.type === 'Z') o += 'z ';
  }
  const bb = g.getBoundingBox();
  glyphs[ch] = { ha: r(g.advanceWidth), x_min: r(bb.x1 || 0), x_max: r(bb.x2 || 0), o: o.trim() };
}
const out = {
  glyphs, familyName: 'Russo One', ascender: r(font.ascender), descender: r(font.descender),
  underlinePosition: -100, underlineThickness: 50, boundingBox: { yMin: r(font.descender), xMin: 0, yMax: r(font.ascender), xMax: 1000 },
  resolution: 1000, original_font_information: {},
};
fs.writeFileSync(path.join(ROOT, 'bot/video/RussoOne-buy.typeface.json'), JSON.stringify(out));
console.log('glyphs:', Object.keys(glyphs).length);
