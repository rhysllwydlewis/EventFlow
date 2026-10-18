'use strict';

/**
 * Contract between the customer dashboard's Wedding Website app and the server.
 *
 * The app sends photos as base64 data URLs inside JSON. Two server limits decide whether a
 * save works, and the client has to stay under both:
 *   - routes/wedding-theme-media.js drops any single image over MAX_IMAGE_CHARS characters
 *   - server.js rejects a request body over the JSON limit for /api/me/plans
 * When the client budget drifted above the first, photos were silently discarded on save.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const widget = read('public/assets/js/pages/customer-wedding-website.js');
const themeMediaRoute = read('routes/wedding-theme-media.js');
const server = read('server.js');

const numberFrom = (source, pattern, label) => {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not find ${label}`);
  }
  return Number(match[1].replace(/_/g, ''));
};

const targetChars = numberFrom(
  widget,
  /const TARGET_IMAGE_CHARS = ([\d_]+);/,
  'TARGET_IMAGE_CHARS in the widget'
);
const maxGallery = numberFrom(widget, /const MAX_GALLERY = (\d+);/, 'MAX_GALLERY in the widget');
const serverMaxImageChars = numberFrom(
  themeMediaRoute,
  /const MAX_IMAGE_CHARS = ([\d_]+);/,
  'MAX_IMAGE_CHARS in wedding-theme-media.js'
);
const serverMaxGallery = numberFrom(
  themeMediaRoute,
  /const MAX_GALLERY_ITEMS = (\d+);/,
  'MAX_GALLERY_ITEMS in wedding-theme-media.js'
);

describe('Wedding Website app / server photo contract', () => {
  test('a shrunk photo is always under the per-image size the server keeps', () => {
    expect(targetChars).toBeLessThan(serverMaxImageChars);
  });

  test('the gallery limit matches the server', () => {
    expect(maxGallery).toBe(serverMaxGallery);
  });

  test('a full gallery plus the cover fits in the JSON body limit for /api/me/plans', () => {
    const limitMb = numberFrom(
      server,
      /'\/api\/me\/plans',[\s\S]*?express\.json\(\{ limit: '(\d+)mb' \}\)/,
      'the 10mb JSON parser that lists /api/me/plans'
    );
    const worstCaseChars = (maxGallery + 1) * targetChars;
    expect(worstCaseChars).toBeLessThan(limitMb * 1024 * 1024);
  });

  test('photos are sent with the theme request, not duplicated in the website request', () => {
    const payload = widget.slice(
      widget.indexOf('function draftPayload()'),
      widget.indexOf('function themePayload()')
    );
    expect(payload).not.toMatch(/coverImageUrl|galleryImages/);
  });
});

describe('Wedding Website app is a single module', () => {
  const removed = [
    'customer-wedding-widget-',
    'customer-wedding-preview-publish-hardener',
    'wedding-dashboard-modal-polish',
    'wedding-password-dashboard',
    'wedding-publish-mop-up',
    'wedding-theme-media-customiser',
    'wedding-mongodb-authority',
    'wedding-theme-media-polish',
  ];

  const sourceFiles = dir =>
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'vendor' ? [] : sourceFiles(rel);
      }
      return /\.(js|html|css)$/.test(entry.name) ? [rel] : [];
    });

  test('nothing loads the enhancer layers that were folded into the app', () => {
    const offenders = sourceFiles('public').filter(file => {
      const text = read(file);
      return removed.some(name => text.includes(name));
    });
    expect(offenders).toEqual([]);
  });

  test('the enhancer layer files are gone', () => {
    const leftovers = sourceFiles('public').filter(file =>
      removed.some(name => path.basename(file).startsWith(name))
    );
    expect(leftovers).toEqual([]);
  });

  test('the dashboard page loads the app script and stylesheet with a version', () => {
    const html = read('public/dashboard-customer.html');
    expect(html).toMatch(/customer-wedding-website\.js\?v=[\d.]+/);
    expect(html).toMatch(/customer-wedding-website\.css\?v=[\d.]+/);
  });

  test('the app never falls back to window.prompt for copying', () => {
    expect(widget).not.toMatch(/window\.prompt/);
  });
});
