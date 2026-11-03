// Copies the landing images from ../source into src/assets at web sizes.
// The originals are never modified. Run: npm run images
import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../source');
const ICONS = resolve(here, '../../design/icons');
const OUT = resolve(here, '../src/assets');
const PUBLIC = resolve(here, '../public');

// name → { file, widths, crop? } ; crop = fraction of the height removed from the bottom
const images = {
  'city-cathedral': { file: '01-main-beautiful.jpg', widths: [2400, 1600, 1000, 600] },
  'city-skyline': { file: '02-unifranz-view.webp', widths: [1600, 1000, 600] },
  'city-perspective': { file: '03-eldeber-view.webp', widths: [1200, 800, 500] },
  'city-aerial': { file: '04-wikimedia-aerial.jpg', widths: [960, 640, 400] },
  'city-sign': { file: '05-facebook-with-sign.jpg', widths: [1600, 1000, 600], cropBottom: 0.18 },
  'piyo-cutout': { file: '06-piyo-animal-logo.png', widths: [800, 400], png: true },
  // the app icon artwork (rhea head, transparent) from the design folder
  'app-icon': { file: 'icon_no_background.png', dir: 'icons', widths: [512, 256, 128], png: true, trim: true },
};

await mkdir(OUT, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

for (const [name, spec] of Object.entries(images)) {
  const input = join(spec.dir === 'icons' ? ICONS : SRC, spec.file);
  await stat(input); // throws if a source is missing
  const meta = await sharp(input).metadata();
  for (const w of spec.widths) {
    let img = sharp(input);
    if (spec.trim) img = img.trim();
    if (spec.cropBottom) {
      const h = Math.round(meta.height * (1 - spec.cropBottom));
      img = img.extract({ left: 0, top: 0, width: meta.width, height: h });
    }
    img = img.resize({ width: Math.min(w, meta.width), withoutEnlargement: true });
    if (spec.png) {
      await img.png({ compressionLevel: 9, palette: false }).toFile(join(OUT, `${name}-${w}.png`));
    } else {
      await img.webp({ quality: 82, effort: 5 }).toFile(join(OUT, `${name}-${w}.webp`));
    }
  }
  console.log(`${name}: ${spec.widths.length} sizes from ${spec.file} (${meta.width}×${meta.height})`);
}

// Open Graph card 1200×630 from the hero photo, and a JPEG copy of the hero for the WebGL seam texture.
// The photo is used as shot: the owner prefers its natural greens; the brand colour lives in the UI only.
const heroSrc = join(SRC, images['city-cathedral'].file);
await sharp(heroSrc)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(join(PUBLIC, 'og.jpg'));
await sharp(heroSrc)
  .resize({ width: 2048 })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(join(PUBLIC, 'hero-2048.jpg'));
console.log('public/og.jpg and public/hero-2048.jpg written');

// Favicons and the web-app icons: the same composition as the Android launcher icon (BRANDING.md): the head
// 80/72 of the visible square tall, top at 6/72, on the brand green. Rounded square (18 % radius) for the
// browser; iOS masks its own, so the touch icon stays square.
const BRAND = '#2a6a47';
const headSrc = await sharp(join(ICONS, 'icon_no_background.png')).trim().png().toBuffer();
async function appIcon(size, { rounded }) {
  const top = Math.round((size * 6) / 72);
  let head = sharp(headSrc).resize({ height: Math.round((size * 80) / 72) });
  const m = await head.toBuffer({ resolveWithObject: true });
  const w = m.info.width, h = m.info.height;
  head = sharp(m.data);
  if (h > size - top) head = head.extract({ left: 0, top: 0, width: w, height: size - top });
  const layers = [{ input: await head.png().toBuffer(), top, left: Math.round((size - w) / 2) }];
  if (rounded) {
    const r = Math.round(size * 0.18);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
    layers.push({ input: mask, blend: 'dest-in' });
  }
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND } }).composite(layers).png({ compressionLevel: 9 });
}
for (const [file, size, rounded] of [
  ['favicon-32.png', 32, true],
  ['favicon-48.png', 48, true],
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]) {
  await (await appIcon(size, { rounded })).toFile(join(PUBLIC, file));
}
console.log('favicons written to public/ (32, 48, 192, 512, apple-touch-icon 180)');
