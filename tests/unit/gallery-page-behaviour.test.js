'use strict';

/**
 * The Photos page (/gallery), driven the way a person would: which gallery opens, what each kind
 * of account sees, choosing files, uploading, deleting and the viewer. The scenarios live in
 * tests/helpers/gallery-page-scenarios.js and run in a child process (jsdom cannot be loaded inside
 * Jest here); each one is reported below as its own test.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const results = JSON.parse(
  execFileSync(process.execPath, [path.join(ROOT, 'tests/helpers/gallery-page-scenarios.js')], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  })
);

describe('the Photos page', () => {
  test('ran its scenarios', () => {
    expect(Object.keys(results).length).toBeGreaterThan(30);
  });

  Object.entries(results).forEach(([name, result]) => {
    test(name, () => {
      if (!result.ok) {
        throw new Error(result.error);
      }
    });
  });
});
