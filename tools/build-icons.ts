/**
 * The app's icons (favicon, home screen, roadmap 5.3), from the hammerfest.fr site's own favicon
 * (`assets-src/site-archive/hammerfest.fr/favicon.ico`, a 16 x 16 ice cube). The pixel art is
 * scaled up pixel for pixel, so it stays sharp, into `public/icons/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = join(import.meta.dirname, '..');
const ICO = join(ROOT, 'assets-src/site-archive/hammerfest.fr/favicon.ico');
const OUT = join(ROOT, 'public/icons');
/** The sizes the manifest (192, 512), iOS (180) and the browser tab (32) ask for. */
const SIZES = [32, 180, 192, 512];

/** The first image of an `.ico` with an 8-bit palette BMP inside: RGBA, top row first. */
function readIco(buf: Buffer): { w: number; h: number; rgba: Uint8Array } {
  const offset = buf.readUInt32LE(6 + 12);
  const w = buf.readInt32LE(offset + 4);
  const h = buf.readInt32LE(offset + 8) / 2; // the height counts the AND mask too
  const bpp = buf.readUInt16LE(offset + 14);
  if (bpp !== 8) throw new Error(`favicon: ${bpp} bits per pixel, only 8 is read`);
  const colors = buf.readUInt32LE(offset + 32) || 256;
  const palette = offset + buf.readUInt32LE(offset);
  const pixels = palette + colors * 4;
  const xorRow = Math.ceil(w / 4) * 4;
  const mask = pixels + xorRow * h;
  const andRow = Math.ceil(w / 32) * 4;

  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = h - 1 - y; // bottom-up
    for (let x = 0; x < w; x++) {
      const c = palette + buf[pixels + row * xorRow + x] * 4;
      const transparent = (buf[mask + row * andRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      const o = (y * w + x) * 4;
      rgba[o] = buf[c + 2];
      rgba[o + 1] = buf[c + 1];
      rgba[o + 2] = buf[c];
      rgba[o + 3] = transparent ? 0 : 255;
    }
  }
  return { w, h, rgba };
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** An RGBA PNG, `rgba` scaled `k` times with nearest neighbour. */
function png(src: { w: number; h: number; rgba: Uint8Array }, k: number): Buffer {
  const w = src.w * k;
  const h = src.h * k;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const line = y * (w * 4 + 1);
    raw[line] = 0; // no filter
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / k) * src.w + Math.floor(x / k)) * 4) | 0;
      raw.set(src.rgba.subarray(s, s + 4), line + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** `src` centred on a square of `size`, scaled by the largest whole factor that fits. */
function icon(src: { w: number; h: number; rgba: Uint8Array }, size: number): Buffer {
  const k = Math.floor(size / src.w);
  if (k * src.w === size) return png(src, k);
  const pad = (size - k * src.w) >> 1;
  const big = { w: size, h: size, rgba: new Uint8Array(size * size * 4) };
  for (let y = 0; y < src.h * k; y++) {
    for (let x = 0; x < src.w * k; x++) {
      const s = (Math.floor(y / k) * src.w + Math.floor(x / k)) * 4;
      big.rgba.set(src.rgba.subarray(s, s + 4), ((y + pad) * size + x + pad) * 4);
    }
  }
  return png(big, 1);
}

const ico = readFileSync(ICO);
const img = readIco(ico);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'favicon.ico'), ico);
for (const size of SIZES) writeFileSync(join(OUT, `icon-${size}.png`), icon(img, size));
console.log(`icons: ${SIZES.join(', ')} px from the site's favicon -> public/icons/`);
