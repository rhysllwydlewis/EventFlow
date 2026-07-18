'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function allAssertionOptions(config) {
  return config.ci.assert.assertMatrix.flatMap(entry =>
    Object.values(entry.assertions).map(value => value[1])
  );
}

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
    expect(workflow).toMatch(/test:e2e:backend/);
    expect(workflow).toMatch(/PLAYWRIGHT_VIDEO: 'off'/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  test('backend suite quarantine is explicit, validated and preserves a substantial blocking suite', () => {
    const classification = JSON.parse(read('e2e/backend-suite-classification.json'));
    const runner = read('scripts/run-backend-e2e.mjs');

    expect(classification.blocking.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(classification.quarantined).length).toBeGreaterThan(0);
    expect(new Set(classification.blocking).size).toBe(classification.blocking.length);
    for (const [file, reason] of Object.entries(classification.quarantined)) {
      expect(classification.blocking).not.toContain(file);
      expect(reason.length).toBeGreaterThanOrEqual(40);
    }
    expect(runner).toMatch(/unclassified backend specs/);
    expect(runner).toMatch(/--include-quarantined/);
  });

  test('new third-party workflow actions are pinned to reviewed immutable commits', () => {
    const backend = read('.github/workflows/backend-e2e.yml');
    const audit = read('.github/workflows/test-audit.yml');
    const supplyChain = read('.github/workflows/supply-chain.yml');

    const mongoPin = /supercharge\/mongodb-github-action@[0-9a-f]{40}/i;
    expect(backend).toMatch(mongoPin);
    expect(audit).toMatch(mongoPin);
    expect(supplyChain).toMatch(/aquasecurity\/trivy-action@[0-9a-f]{40}/i);
    expect(supplyChain).toMatch(/anchore\/sbom-action@[0-9a-f]{40}/i);
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

  test('production synthetics require a real commit SHA and persist controlled outcomes only', () => {
    const synthetic = read('scripts/production-synthetic-check.mjs');

    expect(synthetic).toMatch(/commitShaPattern = \/\^\[0-9a-f\]\{40\}\$\/i/);
    expect(synthetic).toMatch(/'network_error'/);
    expect(synthetic).toMatch(/'invalid_response'/);
    expect(synthetic).not.toMatch(/error\.message/);
    expect(synthetic).not.toMatch(/status:\s*response\.status/);
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

  test('Lighthouse uses page-specific pessimistic regression baselines', () => {
    const desktop = JSON.parse(read('.lighthouserc.json'));
    const mobile = JSON.parse(read('.lighthouserc.mobile.json'));

    expect(desktop.ci.assert.assertMatrix).toHaveLength(3);
    expect(mobile.ci.assert.assertMatrix).toHaveLength(3);
    expect(JSON.stringify(desktop)).toContain('guides');
    expect(JSON.stringify(mobile)).toContain('suppliers$');

    for (const options of [...allAssertionOptions(desktop), ...allAssertionOptions(mobile)]) {
      expect(options.aggregationMethod).toBe('pessimistic');
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

  test('mutation testing exercises both property and provider-failure contracts', () => {
    const mutation = read('stryker.config.mjs');
    const workflow = read('.github/workflows/weekly-deep-quality.yml');

    expect(mutation).toMatch(/property-fuzz\.test\.js/);
    expect(mutation).toMatch(/external-service-failure-contracts\.test\.js/);
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/Focused mutation score/);
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
