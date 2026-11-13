'use strict';

/**
 * The homepage's right-sized image renditions (scripts/optimize-homepage-images.mjs).
 *
 * Before these existed the homepage shipped six 1600 px city JPEGs of up to
 * 300 KB for cards shown at 180-340 px, and 1280 px collage JPEGs for tiles shown
 * at ~180 px. These tests keep the generated files present, genuinely small,
 * and in step with their JPEG masters.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '../..');
const IMAGES = path.join(ROOT, 'public/assets/images');

const CITIES = ['london', 'manchester', 'birmingham', 'cardiff', 'leeds', 'edinburgh'];
const COLLAGE = ['venue', 'catering', 'entertainment', 'photography'];

const RENDITIONS = [
  ...CITIES.map(city => ({
    master: `cities/${city}.jpg`,
    output: `cities/${city}.webp`,
    maxWidth: 800,
    maxBytes: 90 * 1024,
  })),
  ...COLLAGE.map(name => ({
    master: `collage-${name}.jpg`,
    output: `collage-${name}-640.webp`,
    maxWidth: 640,
    maxBytes: 60 * 1024,
  })),
  {
    master: 'hero-video-poster.jpg',
    output: 'hero-video-poster-960.webp',
    maxWidth: 960,
    maxBytes: 60 * 1024,
  },
];

describe('homepage image renditions', () => {
  test('the generator reports every rendition present and in step with its master', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/optimize-homepage-images.mjs'), '--check'],
      { encoding: 'utf8' }
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/All 11 homepage image renditions are up to date/);
  });

  test.each(RENDITIONS.map(job => [job.output, job]))(
    '%s is a WebP no wider than its slot and much smaller than its master',
    async (_name, job) => {
      const output = path.join(IMAGES, job.output);
      const master = path.join(IMAGES, job.master);

      const meta = await sharp(output).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBeLessThanOrEqual(job.maxWidth);

      const size = fs.statSync(output).size;
      expect(size).toBeLessThanOrEqual(job.maxBytes);
      // The catering tile is already tiny (an 8 KB, 198 px master): it only has
      // to not be bigger. Everything else must save at least half.
      const masterSize = fs.statSync(master).size;
      expect(size).toBeLessThan(job.output.includes('catering') ? masterSize : masterSize / 2);
    }
  );

  test('the six city renditions together are a fraction of the 1.4 MB of JPEGs they replace', () => {
    const jpegs = CITIES.reduce(
      (sum, city) => sum + fs.statSync(path.join(IMAGES, `cities/${city}.jpg`)).size,
      0
    );
    const webps = CITIES.reduce(
      (sum, city) => sum + fs.statSync(path.join(IMAGES, `cities/${city}.webp`)).size,
      0
    );
    expect(jpegs).toBeGreaterThan(1.2 * 1024 * 1024);
    expect(webps).toBeLessThan(400 * 1024);
  });

  test('a rendition keeps its master aspect ratio (cards crop with background-size: cover)', async () => {
    for (const city of CITIES) {
      const [master, output] = await Promise.all([
        sharp(path.join(IMAGES, `cities/${city}.jpg`)).metadata(),
        sharp(path.join(IMAGES, `cities/${city}.webp`)).metadata(),
      ]);
      expect(output.width / output.height).toBeCloseTo(master.width / master.height, 1);
    }
  });
});
