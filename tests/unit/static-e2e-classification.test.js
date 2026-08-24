const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const classification = require('../../e2e/static-suite-classification.json');
const packageJson = require('../../package.json');

const stableCoreSpecs = [
  'auth-redirect-security.spec.js',
  'package-detail-image.spec.js',
  'package-routing-smoke.spec.js',
  'public-discovery-funnel.spec.js',
  'seo-canonicals.spec.js',
  'seo-noindex.spec.js',
  'seo-sitemap.spec.js',
  'start-wizard-hardening.spec.js',
  'suppliers.spec.js',
];

describe('static E2E classification', () => {
  test('keeps unstable specs explicit, explained and separate from focused auth', () => {
    const quarantined = Object.entries(classification.quarantined);

    expect(classification.focusedAuth).toBe('auth.spec.js');
    expect(quarantined).toHaveLength(30);
    expect(classification.quarantined[classification.focusedAuth]).toBeUndefined();

    for (const [file, reason] of quarantined) {
      expect(file).toMatch(/\.spec\.js$/);
      expect(reason.trim().length).toBeGreaterThanOrEqual(20);
      expect(fs.existsSync(path.join(root, 'e2e', file))).toBe(true);
    }
  });

  test('retains a meaningful blocking core and routes CI through the classified runner', () => {
    for (const file of stableCoreSpecs) {
      expect(fs.existsSync(path.join(root, 'e2e', file))).toBe(true);
      expect(classification.quarantined[file]).toBeUndefined();
    }

    expect(packageJson.scripts['test:e2e:static']).toBe('node scripts/run-static-e2e.mjs');

    const runner = fs.readFileSync(path.join(root, 'scripts/run-static-e2e.mjs'), 'utf8');
    expect(runner).toMatch(/readdirSync\(e2eDir/);
    expect(runner).toMatch(/blockingSpecs\.length < 10/);
    expect(runner).toMatch(/'--grep-invert'/);
    expect(runner).toMatch(/\.\.\.process\.argv\.slice\(2\)/);
  });
});
