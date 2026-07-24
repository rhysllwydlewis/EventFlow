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

  test('executes the fixture mount only in explicit full test mode', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalE2EMode = process.env.E2E_MODE;

    process.env.NODE_ENV = 'test';
    process.env.E2E_MODE = 'full';
    jest.resetModules();
    jest.doMock('../../routes/e2e-test-support', () => {
      const express = require('express');
      return express.Router();
    });
    jest.doMock('../../routes/public-listing-seo', () => {
      const express = require('express');
      return () => express.Router();
    });

    try {
      jest.isolateModules(() => {
        const staticRoutes = require('../../routes/static');
        expect(staticRoutes).toBeDefined();
      });
    } finally {
      jest.dontMock('../../routes/e2e-test-support');
      jest.dontMock('../../routes/public-listing-seo');
      jest.resetModules();
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalE2EMode === undefined) delete process.env.E2E_MODE;
      else process.env.E2E_MODE = originalE2EMode;
    }
  });

  test('requires both the test environment and the private suite header', () => {
    const supportRoute = read('routes/e2e-test-support.js');
    expect(supportRoute).toContain("process.env.NODE_ENV !== 'test'");
    expect(supportRoute).toContain("const HEADER_NAME = 'x-eventflow-e2e'");
    expect(supportRoute).toContain("const HEADER_VALUE = 'backend-suite'");
    expect(supportRoute).toContain('req.get(HEADER_NAME) !== HEADER_VALUE');
  });

  test('tags every full-mode browser and request context with the private header', () => {
    const config = read('playwright.config.js');
    expect(config).toContain("e2eMode === 'full'");
    expect(config).toContain("'x-eventflow-e2e': 'backend-suite'");
    expect(config).toContain('extraHTTPHeaders: fullBackendHeaders');
  });

  test('keeps test-only fixture code outside application patch coverage', () => {
    const coverageGate = read('scripts/check-changed-coverage.mjs');
    expect(coverageGate).toContain("file === 'routes/e2e-test-support.js'");
  });

  test('uses run-scoped data and explicit cleanup for every fixture collection', () => {
    const supportRoute = read('routes/e2e-test-support.js');
    expect(supportRoute).toContain('e2eRunId: runId');
    expect(supportRoute).toContain("router.post('/cleanup'");
    expect(supportRoute).toContain('dbUnified.deleteMany');
  });
});
