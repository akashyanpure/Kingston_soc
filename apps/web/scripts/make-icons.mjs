// Generates the PWA icons in public/icons (no dependencies): a teal square with a
// stepped "SOC" grade-bar mark. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const TEAL = [0x17, 0x70, 0x8c];
const LIGHT = [0xcf, 0xe8, 0xef];
const MID = [0x6f, 0xb4, 0xc9];
const WHITE = [0xf2, 0xf2, 0xf3];

// Mark on a 16-unit grid: three bars (G/F/P pills) + a tick block, inside a 60% safe zone.
const rects = [
  { x: 4, y: 4.5, w: 8, h: 1.6, c: WHITE },
  { x: 4, y: 7.2, w: 6, h: 1.6, c: LIGHT },
  { x: 4, y: 9.9, w: 4, h: 1.6, c: MID },
];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const u = size / 16;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = TEAL;
      for (const r of rects) if (x >= r.x * u && x < (r.x + r.w) * u && y >= r.y * u && y < (r.y + r.h) * u) col = r.c;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

writeFileSync(join(out, 'icon-192.png'), png(192));
writeFileSync(join(out, 'icon-512.png'), png(512));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180));
writeFileSync(
  join(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="${hex(TEAL)}"/>` +
    rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${hex(r.c)}"/>`).join('') +
    '</svg>\n',
);
console.log('icons written to', out);
