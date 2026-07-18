// Generates src-tauri/icons/source.png (1024x1024) without any native deps:
// a rounded dark tile with a stylized waveform, encoded as PNG via zlib.
// Run: node scripts/gen-icon.mjs && pnpm tauri icon src-tauri/icons/source.png
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 1024, H = 1024;
const px = new Uint8Array(W * H * 4);

const bars = [0.18, 0.34, 0.62, 0.88, 0.62, 0.34, 0.18];
const barW = 56, gap = 40;
const totalW = bars.length * barW + (bars.length - 1) * gap;
const x0 = (W - totalW) / 2;

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r));
  const cy = Math.max(ry + r, Math.min(y, ry + rh - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= rx + r && x < rx + rw - r) || (y >= ry + r && y < ry + rh - r);
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!inRoundedRect(x, y, 64, 64, 896, 896, 200)) continue; // transparent corners
    // background: deep indigo gradient
    const t = y / H;
    let [r, g, b] = [30 + 20 * t, 27 + 14 * t, 75 + 60 * t];
    // waveform bars (soft mint)
    for (let bi = 0; bi < bars.length; bi++) {
      const bx = x0 + bi * (barW + gap);
      const bh = bars[bi] * 560;
      const by = (H - bh) / 2;
      if (inRoundedRect(x, y, bx, by, barW, bh, barW / 2)) {
        [r, g, b] = [167, 243, 208];
      }
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
}

// PNG encode
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
mkdirSync("src-tauri/icons", { recursive: true });
writeFileSync("src-tauri/icons/source.png", png);
console.log("wrote src-tauri/icons/source.png", png.length, "bytes");
