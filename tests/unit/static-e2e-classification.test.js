const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const classification = require('../../e2e/static-suite-classification.json');
const packageJson = require('../../package.json');

const stableCoreSpecs = [
  'auth-redirect-security.spec.js',
  'homepage-carousel-image-resolution.spec.js',
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

  test('retains a meaningful blocking core and validates it before each run', () => {
    for (const file of stableCoreSpecs) {
      expect(fs.existsSync(path.join(root, 'e2e', file))).toBe(true);
      expect(classification.quarantined[file]).toBeUndefined();
    }

    expect(packageJson.scripts['test:e2e:static']).toContain(
      'validate-static-e2e-classification.mjs'
    );
    expect(packageJson.scripts['test:e2e:static']).toContain(
      '--config=playwright-static.config.js'
    );

    const config = fs.readFileSync(path.join(root, 'playwright-static.config.js'), 'utf8');
    expect(config).toMatch(/testIgnore:/);
    expect(config).toMatch(/grepInvert:\s*\/@backend\|@visual\//);
  });
});
