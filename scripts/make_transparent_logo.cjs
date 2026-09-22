// Removes the near-black background from new_logo.png -> transparent logo.
// Run: node scripts/make_transparent_logo.cjs
const fs = require('fs');
const zlib = require('zlib');

function readPNG(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8, w, h, bitDepth, colorType, idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }
  console.log(`image ${w}x${h} bitDepth=${bitDepth} colorType=${colorType}`);
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('need 8-bit RGB/RGBA, got ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 2 ? 3 : 4;
  const stride = w * ch;
  const px = Buffer.alloc(w * h * 4);
  let p2 = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[p2++];
    const cur = Buffer.alloc(stride);
    raw.copy(cur, 0, p2, p2 + stride); p2 += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b2 = i >= stride ? 0 : prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b2) & 255;
      else if (f === 3) v = (v + ((a + b2) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(a, b2, c)) & 255;
      cur[i] = v;
    }
    cur.copy(prev);
    for (let x = 0; x < w; x++) {
      const r = cur[x * ch], g = cur[x * ch + 1], bl = cur[x * ch + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      // soft key: black -> transparent, keep glow opaque
      let alpha = Math.round(Math.min(255, Math.max(0, (lum - 6) * (255 / 26))));
      // un-premultiply-ish lift for dark glow edges
      const o = (y * w + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = alpha;
    }
  }
  return { w, h, px };
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function crc32(buf) {
  const t = crc32.table || (crc32.table = (() => {
    const tt = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tt[n] = c;
    }
    return tt;
  })());
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function writePNG(p, w, h, px) {
  const ch = 4, stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(p, out);
  console.log('wrote', p, out.length, 'bytes');
}
const { w, h, px } = readPNG('new_logo.png');
writePNG('ios/Yooh/Yooh/Assets.xcassets/YoohLogo.imageset/logo.png', w, h, px);
