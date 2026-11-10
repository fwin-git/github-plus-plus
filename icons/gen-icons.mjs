// Deterministic, dependency-free icon generator.
// Draws a book glyph on a rounded blue tile and writes RGBA PNGs.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 128];

// ---- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Scene ------------------------------------------------------------------
// Coordinates are normalized [0,1]. Painter's algorithm; last hit wins.

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r));
  const cy = Math.max(ry + r, Math.min(y, ry + rh - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Returns [r,g,b,a] (0-255) for a normalized point, or null for transparent.
function scene(x, y) {
  let color = null;
  // Tile: rounded square with a subtle vertical gradient.
  if (inRoundedRect(x, y, 0.02, 0.02, 0.96, 0.96, 0.21)) {
    color = [Math.round(lerp(0x2f, 0x17, y)), Math.round(lerp(0x81, 0x5c, y)), Math.round(lerp(0xf7, 0xcf, y)), 255];
  } else {
    return null;
  }
  // Book cover (white, rounded).
  if (inRoundedRect(x, y, 0.26, 0.22, 0.48, 0.56, 0.055)) color = [255, 255, 255, 255];
  // Spine band: tile-colored vertical carve near the left edge of the cover.
  if (x >= 0.335 && x <= 0.365 && y >= 0.22 && y <= 0.78 && inRoundedRect(x, y, 0.26, 0.22, 0.48, 0.56, 0.055)) {
    color = [Math.round(lerp(0x2f, 0x17, y)), Math.round(lerp(0x81, 0x5c, y)), Math.round(lerp(0xf7, 0xcf, y)), 255];
  }
  // Bookmark ribbon with a notched tail.
  const rb = { x0: 0.55, x1: 0.645, y0: 0.22, y1: 0.545 };
  if (x >= rb.x0 && x <= rb.x1 && y >= rb.y0 && y <= rb.y1) {
    const mid = (rb.x0 + rb.x1) / 2;
    const notchDepth = 0.055;
    const tail = rb.y1 - notchDepth * (1 - Math.abs(x - mid) / ((rb.x1 - rb.x0) / 2));
    if (y <= tail) color = [255, 211, 61, 255];
  }
  return color;
}

function render(size) {
  const SS = 4; // supersampling grid per axis
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = scene((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += c[3];
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      // Premultiply-ish: average color only over covered samples to avoid dark fringes.
      const covered = a / 255;
      buf[i] = covered ? Math.round(r / covered) : 0;
      buf[i + 1] = covered ? Math.round(g / covered) : 0;
      buf[i + 2] = covered ? Math.round(b / covered) : 0;
      buf[i + 3] = Math.round(alpha);
    }
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePNG(size, render(size));
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
