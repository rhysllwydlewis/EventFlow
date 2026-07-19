'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const E2E_DIR = path.join(ROOT, 'e2e');
const CLASSIFICATION_PATH = path.join(E2E_DIR, 'backend-suite-classification.json');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('backend Playwright quarantine retirement', () => {
  test('classifies every backend spec exactly once as blocking', () => {
    const classification = JSON.parse(fs.readFileSync(CLASSIFICATION_PATH, 'utf8'));
    const blocking = classification.blocking || [];
    const quarantined = Object.keys(classification.quarantined || {});
    const classified = [...blocking, ...quarantined];
    const backendSpecs = fs
      .readdirSync(E2E_DIR)
      .filter(name => name.endsWith('.spec.js'))
      .filter(name => read(path.join('e2e', name)).includes('@backend'))
      .sort();

    expect(quarantined).toEqual([]);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...blocking].sort()).toEqual(backendSpecs);
  });

  test('keeps all eight repaired specifications in the blocking suite', () => {
    const classification = JSON.parse(fs.readFileSync(CLASSIFICATION_PATH, 'utf8'));
    expect(classification.blocking).toEqual(
      expect.arrayContaining([
        'admin-feature-flags.spec.js',
        'customer-enquiry-flow.spec.js',
        'packages.spec.js',
        'public-discovery-funnel.spec.js',
        'supplier-dashboard-improvements.spec.js',
        'supplier-onboarding.spec.js',
        'supplier-reviews.spec.js',
        'supplier-verification-flow.spec.js',
      ])
    );
  });

  test('mounts fixture routes only for full backend browser mode', () => {
    const staticRoutes = read('routes/static.js');
    expect(staticRoutes).toContain("process.env.NODE_ENV === 'test'");
    expect(staticRoutes).toContain("process.env.E2E_MODE === 'full'");
    expect(staticRoutes).toContain("router.use('/__e2e', require('./e2e-test-support'))");
  });

  test('requires both the test environment and the private suite header', () => {
    const supportRoute = read('routes/e2e-test-support.js');
    expect(supportRoute).toContain("process.env.NODE_ENV !== 'test'");
    expect(supportRoute).toContain("const HEADER_NAME = 'x-eventflow-e2e'");
    expect(supportRoute).toContain("const HEADER_VALUE = 'backend-suite'");
    expect(supportRoute).toContain('req.get(HEADER_NAME) !== HEADER_VALUE');
  });

  test('uses run-scoped data and explicit cleanup for every fixture collection', () => {
    const supportRoute = read('routes/e2e-test-support.js');
    expect(supportRoute).toContain('e2eRunId: runId');
    expect(supportRoute).toContain("router.post('/cleanup'");
    expect(supportRoute).toContain('dbUnified.deleteMany');
  });
});
