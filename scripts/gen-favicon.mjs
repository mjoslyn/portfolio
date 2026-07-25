// Render assets/img/favicon.svg out to the PNG + ICO variants the page links.
// Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick).
// Usage: node scripts/gen-favicon.mjs

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const SRC = resolve("assets/img/favicon.svg");
const OUT = (f) => resolve("assets/img", f);

const png = (size, file) => {
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), SRC, "-o", OUT(file)]);
  console.log(`wrote assets/img/${file} (${size}x${size})`);
};

// browser tab + PWA
png(32, "favicon-32.png");
// iOS home screen — it applies its own mask, so this stays a full-bleed square
png(180, "apple-touch-icon.png");

// multi-size .ico for legacy requests to /favicon.ico
const tmp = [16, 32, 48].map((s) => {
  const f = `/tmp/favicon-${s}.png`;
  execFileSync("rsvg-convert", ["-w", String(s), "-h", String(s), SRC, "-o", f]);
  return f;
});
execFileSync("magick", [...tmp, OUT("favicon.ico")]);
console.log("wrote assets/img/favicon.ico (16, 32, 48)");
