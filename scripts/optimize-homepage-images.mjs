/**
 * Generate the right-sized WebP renditions the homepage uses.
 *
 * The homepage used to ship full-size JPEGs for small slots: six city cards of
 * up to 300 KB each (1600 px wide, shown at about 180-340 px), and collage
 * tiles of 1280 px shown at about 180 px. Together that was around 1.4 MB of
 * city images and 400 KB of collage images before anything below the fold had
 * been scrolled to.
 *
 * The JPEGs stay in the repo as the masters. Run this after replacing one of
 * them:
 *
 *   node scripts/optimize-homepage-images.mjs            # (re)generate
 *   node scripts/optimize-homepage-images.mjs --check    # fail if one is missing or stale
 *
 * `--check` (also asserted by tests/unit/homepage-image-renditions.test.js)
 * keeps the renditions in step with their masters.
 *
 * The renditions are referenced by plain path (no `?v=`) and static images are
 * cached for 7 days, so a returning visitor keeps an old copy after one is
 * regenerated. If a rendition's content changes noticeably, give it a new file
 * name (and update its references) rather than overwriting it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const IMAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/assets/images'
);

const CITIES = ['london', 'manchester', 'birmingham', 'cardiff', 'leeds', 'edinburgh'];

/**
 * Every rendition: master, output, target width and WebP quality.
 * Widths are for the largest slot at 2x density; nothing is ever enlarged.
 */
export const RENDITIONS = [
  // Homepage "Explore cities" cards: 2 / 3 / 6 columns, at most ~340 CSS px wide.
  ...CITIES.map(city => ({
    master: `cities/${city}.jpg`,
    output: `cities/${city}.webp`,
    width: 800,
    quality: 72,
  })),
  // Hero collage tiles and the lower homepage category cards: 180-300 CSS px.
  ...['venue', 'catering', 'entertainment', 'photography'].map(name => ({
    master: `collage-${name}.jpg`,
    output: `collage-${name}-640.webp`,
    width: 640,
    quality: 74,
  })),
  // Supplier-section photo and the "Decor & Styling" card.
  {
    master: 'hero-video-poster.jpg',
    output: 'hero-video-poster-960.webp',
    width: 960,
    quality: 74,
  },
];

const resolve = name => path.join(IMAGES_DIR, name);

/**
 * Whether a rendition exists, is a WebP, and has the dimensions its master
 * would produce today (the configured width, or the master's own width when
 * that is smaller). Dimensions rather than file times, which a git checkout
 * does not preserve.
 * @param {{master: string, output: string, width: number}} job Rendition.
 * @returns {Promise<boolean>} True when up to date.
 */
export async function isUpToDate(job) {
  if (!fs.existsSync(resolve(job.output)) || !fs.existsSync(resolve(job.master))) {
    return false;
  }
  const [output, master] = await Promise.all([
    sharp(resolve(job.output)).metadata(),
    sharp(resolve(job.master)).metadata(),
  ]);
  return output.format === 'webp' && output.width === Math.min(job.width, master.width);
}

/**
 * Write one rendition.
 * @param {{master: string, output: string, width: number, quality: number}} job Rendition.
 * @returns {Promise<{output: string, bytes: number, width: number, height: number}>} Result.
 */
export async function build(job) {
  const info = await sharp(resolve(job.master))
    .rotate()
    .resize({ width: job.width, withoutEnlargement: true })
    .webp({ quality: job.quality, effort: 6 })
    .toFile(resolve(job.output));
  return { output: job.output, bytes: info.size, width: info.width, height: info.height };
}

async function main() {
  const check = process.argv.includes('--check');
  const freshness = await Promise.all(RENDITIONS.map(job => isUpToDate(job)));
  const stale = RENDITIONS.filter((_job, index) => !freshness[index]);

  if (check) {
    if (stale.length > 0) {
      console.error(`Missing or stale renditions:\n  ${stale.map(j => j.output).join('\n  ')}`);
      console.error('Run: node scripts/optimize-homepage-images.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`All ${RENDITIONS.length} homepage image renditions are up to date.`);
    return;
  }

  let total = 0;
  for (const job of RENDITIONS) {
    const result = await build(job);
    total += result.bytes;
    console.log(
      `${result.output.padEnd(34)} ${String(result.width).padStart(4)}x${String(result.height).padEnd(4)} ${String(Math.round(result.bytes / 1024)).padStart(4)} KB`
    );
  }
  console.log(`Total ${Math.round(total / 1024)} KB across ${RENDITIONS.length} renditions.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
