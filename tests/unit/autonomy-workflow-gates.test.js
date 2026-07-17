'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('autonomous quality workflow contracts', () => {
  test('explicit backend Playwright mode wins inside CI', () => {
    const config = read('playwright.config.js');

    expect(config).toMatch(/e2eMode !== 'full'/);
    expect(config).toMatch(/url: 'http:\/\/localhost:3000\/api\/ready'/);
    expect(config).toMatch(/PLAYWRIGHT_ALL_BROWSERS/);
  });

  test('backend browser validation uses a real MongoDB replica set', () => {
    const workflow = read('.github/workflows/backend-e2e.yml');

    expect(workflow).toMatch(/mongodb-replica-set: rs0/);
    expect(workflow).toMatch(/E2E_MODE: full/);
    expect(workflow).toMatch(/Mongo-backed browser journeys/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  test('deployment validation waits for the exact intended commit and readiness', () => {
    const workflow = read('.github/workflows/deploy.yml');
    const metadata = read('scripts/write-deployment-metadata.mjs');

    expect(workflow).toMatch(/EXPECTED_SHA/);
    expect(workflow).toMatch(/deployment\.json/);
    expect(workflow).toMatch(/reported.*EXPECTED_SHA/s);
    expect(workflow).toMatch(/\/api\/ready/);
    expect(metadata).toMatch(/RAILWAY_GIT_COMMIT_SHA/);
  });

  test('scheduled monitors own issue creation and recovery closure', () => {
    for (const file of [
      '.github/workflows/test-audit.yml',
      '.github/workflows/staging-resilience.yml',
      '.github/workflows/production-synthetics.yml',
    ]) {
      const workflow = read(file);
      expect(workflow).toMatch(/schedule:/);
      expect(workflow).toMatch(/issues: write/);
      expect(workflow).toMatch(/actions\/github-script@/);
      expect(workflow).toMatch(/state: 'closed'/);
    }
  });

  test('new executable lines and dependency deltas are blocking PR gates', () => {
    const coverage = read('.github/workflows/coverage-gate.yml');
    const dependencyReview = read('.github/workflows/dependency-review.yml');

    expect(coverage).toMatch(/PATCH_COVERAGE_MIN: '80'/);
    expect(coverage).toMatch(/check-changed-coverage\.mjs/);
    expect(dependencyReview).toMatch(/fail-on-severity: high/);
    expect(dependencyReview).toMatch(/warn-only: false/);
  });

  test('high-risk paths retain human ownership and action pin migration remains visible', () => {
    const owners = read('.github/CODEOWNERS');
    const weekly = read('.github/workflows/weekly-deep-quality.yml');

    expect(owners).toMatch(/\.github\/workflows\/ @rhysllwydlewis/);
    expect(owners).toMatch(/services\/\*payment\* @rhysllwydlewis/);
    expect(owners).toMatch(/db\*\.js @rhysllwydlewis/);
    expect(weekly).toMatch(/ACTION_PIN_ENFORCEMENT: warn/);
    expect(weekly).toMatch(/audit:action-pins/);
  });
});
