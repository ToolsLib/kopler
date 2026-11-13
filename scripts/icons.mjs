import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// A code-generated app mark keeps all artwork local and reproducible.
function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const out = Buffer.alloc(data.length + 8);
  out.writeUInt32BE(bytes.length); data.copy(out, 4); out.writeUInt32BE(crc32(data), out.length - 4);
  return out;
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const bar = (u > .25 && u < .35 && v > .23 && v < .77);
    const arms = u > .35 && u < .76 && Math.abs(Math.abs(v - .5) - (u - .35) * .72) < .055;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const color = bar || arms ? [247, 244, 235, 255] : [70, 92, 72, 255];
    color.forEach((value, i) => { raw[offset + i] = value; });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('src-tauri/icons', { recursive: true });
for (const size of [32, 128, 256, 512]) writeFileSync(`src-tauri/icons/${size}x${size}.png`, png(size));
const image = png(256);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(image.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([ico, image]));
const icnsImage = png(512);
const icns = Buffer.alloc(16); icns.write('icns'); icns.writeUInt32BE(16 + icnsImage.length, 4); icns.write('ic09', 8); icns.writeUInt32BE(8 + icnsImage.length, 12);
writeFileSync('src-tauri/icons/icon.icns', Buffer.concat([icns, icnsImage]));
