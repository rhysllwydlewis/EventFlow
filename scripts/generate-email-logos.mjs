/**
 * Rasterises the EventFlow brand SVGs into the PNGs used by transactional email.
 *
 * Gmail, Outlook and most other mail clients do not render SVG, so the email
 * templates cannot use `public/assets/brand/*.svg` directly. This script is the
 * only thing that should produce `public/assets/email/*.png`; re-run it (and bump
 * `EMAIL_ASSET_VERSION` in `utils/emailComponents.js`) if the brand SVGs change.
 *
 * - eventflow-wordmark.png        gradient wordmark, for the light email header
 * - eventflow-wordmark-white.png  white wordmark, for dark-mode headers
 * - eventflow-mark-white.png      white "EF" mark, for the dark footer
 *
 * Usage: node scripts/generate-email-logos.mjs
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(here, '..', 'public', 'assets', 'brand');
const outDir = path.join(here, '..', 'public', 'assets', 'email');

// Rendered at roughly 4x the size the templates display them at, so they stay
// sharp on high-density screens. Display sizes live in scripts/generate-email-templates.mjs.
const OUTPUTS = [
  { source: 'eventflow-wordmark.svg', file: 'eventflow-wordmark.png', width: 736 },
  {
    source: 'eventflow-wordmark.svg',
    file: 'eventflow-wordmark-white.png',
    width: 736,
    white: true,
  },
  { source: 'eventflow-mark.svg', file: 'eventflow-mark-white.png', width: 176, white: true },
];

/** Replace the SVG's gradient fills with solid white. */
function toWhite(svg) {
  return svg.replace(/fill="url\(#[^)]+\)"/g, 'fill="#ffffff"');
}

/** Rasterise each brand SVG into its email PNG. */
async function main() {
  await mkdir(outDir, { recursive: true });
  for (const { source, file, width, white } of OUTPUTS) {
    let svg = await readFile(path.join(brandDir, source), 'utf8');
    if (white) {
      svg = toWhite(svg);
    }
    const png = await sharp(Buffer.from(svg), { density: 600 })
      .resize({ width })
      .png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 })
      .toBuffer();
    await writeFile(path.join(outDir, file), png);
    process.stdout.write(`${file} (${png.length} bytes)\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
