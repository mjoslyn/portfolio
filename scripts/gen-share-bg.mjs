// Share-card backdrop: psychedelic multicolor gradient + print-fuzz.
// Same convention as gen-featured.mjs — coarse field -> CSV -> PNG, no deps.
// Output is the blurred color field that sits behind the social card text.

import { writeFileSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// coarse field (CSV) -> final png (2:1.05, matches 1200x630 OG ratio)
const GW = 200;
const GH = 105;
const PW = 1200;
const PH = 630;

const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

// Inigo Quilez cosine palette: color(t) = a + b * cos(2pi(c t + d))
function palette(t, a, b, c, d) {
  const r = a[0] + b[0] * Math.cos(2 * Math.PI * (c[0] * t + d[0]));
  const g = a[1] + b[1] * Math.cos(2 * Math.PI * (c[1] * t + d[1]));
  const bl = a[2] + b[2] * Math.cos(2 * Math.PI * (c[2] * t + d[2]));
  return [clamp8(r), clamp8(g), clamp8(bl)];
}

// plasma field -> palette index
function field(x, y, s) {
  const u = x / GW;
  const v = y / GH;
  let n = 0;
  n += Math.sin((u * s.f1 + s.p1) * Math.PI);
  n += Math.sin((v * s.f2 + s.p2) * Math.PI);
  n += Math.sin(((u + v) * s.f3 + s.p3) * Math.PI);
  n += Math.sin((Math.hypot(u - 0.5, v - 0.5) * s.f4 + s.p4) * Math.PI * 2);
  return (n / 4 + 1) / 2;
}

// seed tuned toward the site palette: magenta / cyan / amber sweep
const SEED = {
  f1: 3.0, f2: 2.4, f3: 4.8, f4: 4.2, p1: 0.3, p2: 0.6, p3: 0.15, p4: 0.5,
  a: [0.52, 0.42, 0.55], b: [0.48, 0.45, 0.5], c: [1.05, 1.15, 0.9], d: [0.0, 0.35, 0.6],
};

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

function csvToPng(name) {
  const csv = readFileSync(`assets/csv/${name}.csv`, "utf8").trim().split("\n");
  csv.shift();
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
    raw[py * (1 + PW * 3)] = 0;
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
        raw[off + k] = Math.max(0, Math.min(255, v));
      }
    }
  }
  const png = encodePng(PW, PH, raw);
  const path = `assets/img/${name}.png`;
  writeFileSync(path, png);
  return path;
}

// minimal PNG encoder (RGB, 8-bit)
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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, raw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeCSV("share-bg", SEED);
console.log("wrote", csvToPng("share-bg"));
