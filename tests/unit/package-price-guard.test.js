'use strict';

/**
 * Guards for the one-price rule (utils/packagePrice.js), so the next writer or reader cannot drift:
 *
 *  - a server file that writes to the packages collection and sets a `price` key must build it with
 *    priceFields(), which stores the same text in `price` and `price_display`;
 *  - a browser file that reads a package's `price_display` must take it before `price`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ['node_modules', 'tests', 'coverage', '.git', 'e2e', 'data', 'public'].includes(entry.name)
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

describe('server writers of package prices', () => {
  // Files that write the packages collection with a price key but are not creating a price from
  // user input (each carries its reason).
  const EXEMPT = new Map([
    ['utils/packagePrice.js', 'defines priceFields'],
    ['scripts/sync-package-prices.js', 'repairs stored prices through priceFields'],
    [
      'services/subscriptionService.js',
      'its price keys are subscription plan prices; it only hides packages',
    ],
  ]);

  const WRITES_PACKAGES =
    /(insertOne|insertMany|updateOne|replaceOne|bulkWrite|write)\(\s*['"`]packages['"`]|collection\(\s*['"`]packages['"`]\)\s*\.(insert|update|replace)/;
  const PRICE_KEY = /(^|[\s{,])price\s*:/m;

  const files = walk(ROOT).filter(file => !file.includes(`${path.sep}node_modules${path.sep}`));

  test.each(files.map(file => [rel(file), file]))('%s', (name, file) => {
    if (EXEMPT.has(name)) {
      return;
    }
    const source = fs.readFileSync(file, 'utf8');
    if (!WRITES_PACKAGES.test(source) || !PRICE_KEY.test(source)) {
      return;
    }
    expect(source).toContain('priceFields');
  });
});

describe('browser readers of package prices', () => {
  const browserFiles = walk(path.join(ROOT, 'public'))
    .filter(file => rel(file).startsWith('public/assets/js/'))
    .filter(file => rel(file) !== 'public/assets/js/utils/package-price.js');

  // A line that reads both fields must read price_display first.
  const WRONG_ORDER = /\b(?:\w+\.)?price\s*(?:\|\||\?\?)\s*(?:\w+\.)?price_display\b/;

  test.each(browserFiles.map(file => [rel(file), file]))('%s', (name, file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const wrong = lines
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => WRONG_ORDER.test(line));
    expect(wrong).toEqual([]);
  });
});
