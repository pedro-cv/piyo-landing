// Copies the landing images from the original photos into src/assets and public/ at web sizes.
// The originals are never modified and are not in this repo. Run (maintainers):
//   SOURCE_DIR=<photos> ICONS_DIR=<icon artwork> npm run images
// Quality settings were chosen by SSIM against a lossless resize: each output matches or beats
// what it replaced (see README §Images).
import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SOURCE_DIR ? resolve(process.env.SOURCE_DIR) : resolve(here, '../../source');
const ICONS = process.env.ICONS_DIR ? resolve(process.env.ICONS_DIR) : resolve(here, '../../design/icons');
const OUT = resolve(here, '../src/assets');
const PUBLIC = resolve(here, '../public');

// name → { file, widths, cropBottom?, format } ; cropBottom = fraction of the height removed from the bottom.
// format: 'photo' (WebP q82), 'cutout' (WebP q90, lossless alpha), 'icon' (lossless WebP).
const images = {
  'city-skyline': { file: '02-unifranz-view.webp', widths: [1600, 1000, 600] },
  'city-perspective': { file: '03-eldeber-view.webp', widths: [1200, 800, 500] },
  'city-aerial': { file: '04-wikimedia-aerial.jpg', widths: [960, 640, 400] },
  'city-sign': { file: '05-facebook-with-sign.jpg', widths: [1600, 1000, 600], cropBottom: 0.18 },
  'piyo-cutout': { file: '06-piyo-animal-logo.png', widths: [800, 400], format: 'cutout' },
  // the app icon artwork (rhea head, transparent), at the sizes it is shown: 28/32 px (header, footer)
  // and 56 px (Manifesto badge), each at 1x/2x/3x.
  'app-icon': { file: 'icon_no_background.png', dir: 'icons', widths: [168, 112, 96, 64, 56, 32], format: 'icon', trim: true },
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
    const file = join(OUT, `${name}-${w}.webp`);
    if (spec.format === 'icon') await img.webp({ lossless: true, effort: 6 }).toFile(file);
    else if (spec.format === 'cutout') await img.webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(file);
    else await img.webp({ quality: 82, effort: 5 }).toFile(file);
  }
  console.log(`${name}: ${spec.widths.length} sizes from ${spec.file} (${meta.width}×${meta.height})`);
}

// Open Graph card 1200×630 (JPEG: social crawlers) and the hero, which is also the WebGL seam texture.
// The photo is used as shot: the owner prefers its natural greens; the brand colour lives in the UI only.
// The hero covers the full viewport height, so a portrait screen only ever shows a 9:16 centre slice:
// phones get that slice (sharper and lighter), landscape screens the full frame. WebP q84 matches the
// SSIM of the former mozjpeg q82 JPEG.
const heroSrc = join(SRC, '01-main-beautiful.jpg');
await sharp(heroSrc)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(join(PUBLIC, 'og.jpg'));
const heroMeta = await sharp(heroSrc).metadata();
const sliceW = Math.round((heroMeta.height * 9) / 16);
for (const w of [2048, 1280]) {
  await sharp(heroSrc).resize({ width: w }).webp({ quality: 84, effort: 6 }).toFile(join(PUBLIC, `hero-${w}.webp`));
}
for (const w of [1080, 720]) {
  await sharp(heroSrc)
    .extract({ left: Math.round((heroMeta.width - sliceW) / 2), top: 0, width: sliceW, height: heroMeta.height })
    .resize({ width: w })
    .webp({ quality: 84, effort: 6 })
    .toFile(join(PUBLIC, `hero-portrait-${w}.webp`));
}
console.log('public/og.jpg, hero-{2048,1280}.webp and hero-portrait-{1080,720}.webp written');

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
  // Palette PNG: about a third of the truecolour size, SSIM ≥ 0.997 on these flat icons.
  const flat = await sharp({ create: { width: size, height: size, channels: 4, background: BRAND } }).composite(layers).png().toBuffer();
  return sharp(flat).png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 });
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
