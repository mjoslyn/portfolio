// Featured-image pipeline: psychedelic multicolor gradient + print-fuzz.
// Step 1 writes a coarse color field to CSV. Step 2 reads the CSV and
// converts it to a PNG (bilinear upscale, halftone + grain print fuzz).
// No third-party deps: PNG encoded by hand via Node's built-in zlib.

import { writeFileSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---- coarse field resolution (what lands in the CSV) ----
const GW = 160;
const GH = 100;
// ---- final png resolution ----
const PW = 960;
const PH = 600;

// Inigo Quilez cosine palette: color(t) = a + b * cos(2pi(c t + d))
function palette(t, a, b, c, d) {
  const r = a[0] + b[0] * Math.cos(2 * Math.PI * (c[0] * t + d[0]));
  const g = a[1] + b[1] * Math.cos(2 * Math.PI * (c[1] * t + d[1]));
  const bl = a[2] + b[2] * Math.cos(2 * Math.PI * (c[2] * t + d[2]));
  return [clamp8(r), clamp8(g), clamp8(bl)];
}
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

// plasma field -> palette index, per project seed
function field(x, y, s) {
  const u = x / GW;
  const v = y / GH;
  let n = 0;
  n += Math.sin((u * s.f1 + s.p1) * Math.PI);
  n += Math.sin((v * s.f2 + s.p2) * Math.PI);
  n += Math.sin(((u + v) * s.f3 + s.p3) * Math.PI);
  n += Math.sin((Math.hypot(u - 0.5, v - 0.5) * s.f4 + s.p4) * Math.PI * 2);
  return (n / 4 + 1) / 2; // 0..1
}

const SEEDS = {
  fenton: {
    f1: 3.2, f2: 2.1, f3: 4.4, f4: 5.0, p1: 0.2, p2: 0.7, p3: 0.1, p4: 0.4,
    a: [0.5, 0.5, 0.55], b: [0.5, 0.45, 0.5], c: [1.0, 1.1, 0.9], d: [0.0, 0.15, 0.3],
  },
  ellicottville: {
    f1: 2.4, f2: 3.6, f3: 3.0, f4: 4.2, p1: 0.5, p2: 0.1, p3: 0.6, p4: 0.9,
    a: [0.55, 0.5, 0.45], b: [0.45, 0.5, 0.5], c: [0.9, 1.0, 1.2], d: [0.1, 0.4, 0.7],
  },
  reconstructing: {
    f1: 3.8, f2: 2.8, f3: 5.2, f4: 3.4, p1: 0.9, p2: 0.3, p3: 0.8, p4: 0.2,
    a: [0.5, 0.45, 0.55], b: [0.5, 0.5, 0.45], c: [1.1, 0.8, 1.0], d: [0.3, 0.6, 0.0],
  },
};

// ---- step 1: field -> CSV ----
function writeCSV(name, s) {
  const rows = ["x,y,r,g,b"];
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const t = field(x, y, s);
      const [r, g, b] = palette(t, s.a, s.b, s.c, s.d);
      rows.push(`${x},${y},${r},${g},${b}`);
    }
  }
  const path = `assets/csv/${name}.csv`;
  writeFileSync(path, rows.join("\n"));
  return path;
}

// ---- step 2: CSV -> PNG ----
function csvToPng(name) {
  const csv = readFileSync(`assets/csv/${name}.csv`, "utf8").trim().split("\n");
  csv.shift(); // header
  const grid = new Array(GW * GH);
  for (const line of csv) {
    const [x, y, r, g, b] = line.split(",").map(Number);
    grid[y * GW + x] = [r, g, b];
  }
  const sample = (gx, gy) => {
    gx = Math.max(0, Math.min(GW - 1, gx));
    gy = Math.max(0, Math.min(GH - 1, gy));
    return grid[gy * GW + gx];
  };

  const raw = Buffer.alloc(PH * (1 + PW * 3));
  for (let py = 0; py < PH; py++) {
    raw[py * (1 + PW * 3)] = 0; // filter byte: none
    for (let px = 0; px < PW; px++) {
      const fx = (px / PW) * (GW - 1);
      const fy = (py / PH) * (GH - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const dx = fx - x0, dy = fy - y0;
      const c00 = sample(x0, y0), c10 = sample(x0 + 1, y0);
      const c01 = sample(x0, y0 + 1), c11 = sample(x0 + 1, y0 + 1);
      let rgb = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const top = c00[k] * (1 - dx) + c10[k] * dx;
        const bot = c01[k] * (1 - dx) + c11[k] * dx;
        rgb[k] = top * (1 - dy) + bot * dy;
      }
      // print fuzz: halftone modulation + film grain
      const halftone =
        Math.sin(px * 0.9) * Math.sin(py * 0.9) * 10 +
        Math.sin((px + py) * 0.45) * 6;
      const grain = (Math.random() - 0.5) * 34;
      const off = py * (1 + PW * 3) + 1 + px * 3;
      for (let k = 0; k < 3; k++) {
        let v = rgb[k] + halftone + grain;
        v = Math.max(0, Math.min(255, v));
        raw[off + k] = v;
      }
    }
  }
  const png = encodePng(PW, PH, raw);
  const path = `assets/img/${name}.png`;
  writeFileSync(path, png);
  return path;
}

// ---- minimal PNG encoder (RGB, 8-bit) ----
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
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Optional CLI filter: `node scripts/gen-featured.mjs loop-builder` regenerates
// only the named seed(s); no args regenerates everything.
const only = process.argv.slice(2);
for (const [name, s] of Object.entries(SEEDS)) {
  if (only.length && !only.includes(name)) continue;
  writeCSV(name, s);
  const p = csvToPng(name);
  console.log("wrote", p);
}
