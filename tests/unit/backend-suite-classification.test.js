'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const e2eDir = path.join(root, 'e2e');

function backendSpecs() {
  return fs
    .readdirSync(e2eDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.spec.js'))
    .filter(entry => fs.readFileSync(path.join(e2eDir, entry.name), 'utf8').includes('@backend'))
    .map(entry => entry.name)
    .sort();
}

describe('backend Playwright suite classification', () => {
  test('every backend spec is exactly blocking or quarantined', () => {
    const classification = JSON.parse(
      fs.readFileSync(path.join(e2eDir, 'backend-suite-classification.json'), 'utf8')
    );
    const blocking = new Set(classification.blocking);
    const quarantined = new Set(Object.keys(classification.quarantined));
    const actual = backendSpecs();

    expect(classification.blocking.length).toBeGreaterThanOrEqual(8);
    expect(blocking.size).toBe(classification.blocking.length);
    expect([...blocking].filter(file => quarantined.has(file))).toEqual([]);
    expect([...blocking, ...quarantined].sort()).toEqual(actual);
  });

  test('each quarantine entry records specific repair work', () => {
    const classification = JSON.parse(
      fs.readFileSync(path.join(e2eDir, 'backend-suite-classification.json'), 'utf8')
    );

    for (const [file, reason] of Object.entries(classification.quarantined)) {
      expect(file).toMatch(/\.spec\.js$/);
      expect(reason.length).toBeGreaterThanOrEqual(40);
      expect(reason).not.toMatch(/flaky|temporar|skip for now/i);
    }
  });
});
