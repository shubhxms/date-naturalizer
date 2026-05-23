import { build, context } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

// ---- minimal PNG (solid color with a tiny "D" glyph) generator ----
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
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng(size, fg, bg) {
  // 8-bit RGB image. Render a filled rounded square with a "D" silhouette.
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  // pixel buffer
  const radius = size * 0.18;
  const cx = size / 2;
  const cy = size / 2;
  const inset = size * 0.18;
  const dLeft = inset;
  const dRight = size - inset;
  const dTop = inset;
  const dBottom = size - inset;
  const stroke = Math.max(1, size * 0.12);
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // rounded square mask
      let r = bg[0],
        g = bg[1],
        b = bg[2];
      const inSquare = (() => {
        // squircle-ish via clamped distance to rounded rect
        const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
        const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
        return Math.sqrt(dx * dx + dy * dy) <= radius + 0.5;
      })();
      if (!inSquare) {
        raw[rowStart + 1 + x * 3] = 0;
        raw[rowStart + 2 + x * 3] = 0;
        raw[rowStart + 3 + x * 3] = 0;
        continue;
      }
      // "D" glyph: vertical bar + half-ellipse
      const inVerticalBar = x >= dLeft && x <= dLeft + stroke && y >= dTop && y <= dBottom;
      // half-ellipse outline (right side of D)
      const ex = (x - dLeft) / (dRight - dLeft); // 0..1
      const ey = (y - cy) / ((dBottom - dTop) / 2); // -1..1
      const ellipseDist = ex * ex + ey * ey;
      const inEllipseRing = ex >= 0 && ellipseDist >= 0.78 && ellipseDist <= 1.0 && x >= dLeft + stroke / 2;
      const isFg = inVerticalBar || inEllipseRing;
      if (isFg) {
        r = fg[0];
        g = fg[1];
        b = fg[2];
      }
      raw[rowStart + 1 + x * 3] = r;
      raw[rowStart + 2 + x * 3] = g;
      raw[rowStart + 3 + x * 3] = b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

async function ensureIcons() {
  const iconsDir = resolve(root, "icons");
  await mkdir(iconsDir, { recursive: true });
  const fg = [255, 255, 255];
  const bg = [37, 99, 235]; // accent blue
  for (const size of [16, 48, 128]) {
    const path = resolve(iconsDir, `${size}.png`);
    if (!existsSync(path)) {
      await writeFile(path, makePng(size, fg, bg));
    }
  }
}

async function clean() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
}

async function copyStatic() {
  await cp(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
  await cp(resolve(root, "src/content.css"), resolve(dist, "content.css"));
  await cp(resolve(root, "src/popup.html"), resolve(dist, "popup.html"));
  await cp(resolve(root, "src/popup.css"), resolve(dist, "popup.css"));
  await cp(resolve(root, "src/popup.js"), resolve(dist, "popup.js"));
  await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });
}

const esbuildOpts = {
  entryPoints: [resolve(root, "src/content.js")],
  bundle: true,
  format: "iife",
  target: ["chrome118"],
  minify: true,
  outfile: resolve(dist, "content.js"),
  legalComments: "none",
  logLevel: "info",
};

async function run() {
  await clean();
  await ensureIcons();
  await copyStatic();
  if (watch) {
    const ctx = await context(esbuildOpts);
    await ctx.watch();
    console.log("watching…");
  } else {
    await build(esbuildOpts);
    console.log("built →", dist);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
