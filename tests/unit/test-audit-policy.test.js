'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const POLICY = path.join(ROOT, 'scripts/lib/test-audit-policy.mjs');
const AUDIT_SCRIPT = path.join(ROOT, 'scripts/test-audit.mjs');
const WORKFLOW = path.join(ROOT, '.github/workflows/test-audit.yml');
const CI_WORKFLOW = path.join(ROOT, '.github/workflows/ci.yml');

/** Evaluates an expression inside the ESM policy module and returns it as JSON. */
function evaluate(expression) {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import * as policy from ${JSON.stringify(`file://${POLICY}`)};
       console.log(JSON.stringify(${expression}));`,
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return JSON.parse(result.stdout);
}

describe('scheduled test audit policy', () => {
  describe('exit code', () => {
    test.each([
      ['ci', 1, true],
      ['full', 1, true],
      ['full', 7, true],
      ['ci', 0, false],
      ['full', 0, false],
      ['quick', 3, false],
      ['default', 3, false],
    ])('mode %s with %i failing checks fails the run: %s', (mode, failures, expected) => {
      expect(evaluate(`policy.shouldFailRun(${JSON.stringify(mode)}, ${failures})`)).toBe(expected);
    });

    test('the audit script exits non-zero through the shared policy, not a hard-coded mode', () => {
      const source = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
      expect(source).toContain('shouldFailRun(mode, summary.counts.fail)');
      // Regression: `full` mode used to be exempt, so the Sunday run reported
      // success with red checks and closed the open failure issue.
      expect(source).not.toMatch(/mode === 'ci' && (summary\.)?counts\.fail/);
    });
  });

  describe('timeouts', () => {
    const timeouts = () => evaluate('policy.CHECK_TIMEOUTS_MS');

    test('the Jest and Playwright checks get at least as long as the real CI jobs', () => {
      // ci.yml's Full Regression job has a 25 minute limit and takes about 11
      // minutes; the audit used to allow 4 to 5 minutes and timed out (exit 124)
      // on every run.
      const t = timeouts();
      expect(t['jest-ci']).toBeGreaterThanOrEqual(15 * 60 * 1000);
      expect(t['full-regression']).toBeGreaterThanOrEqual(25 * 60 * 1000);
      expect(t['playwright-static']).toBeGreaterThanOrEqual(10 * 60 * 1000);
    });

    test('every timed check in the audit script takes its limit from the policy', () => {
      const source = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
      const literal = source.match(/timeoutMs:\s*\d+/g);
      expect(literal).toBeNull();
      for (const id of Object.keys(timeouts())) {
        // Dot notation where the id is a valid identifier, brackets for ids like jest-ci.
        const access = /^[A-Za-z_$][\w$]*$/.test(id) ? `.${id}` : `['${id}']`;
        expect(source).toContain(`timeoutMs: CHECK_TIMEOUTS_MS${access}`);
      }
    });

    test('the workflow job limit leaves room for every check timing out once', () => {
      const worstCaseMinutes = Object.values(timeouts()).reduce((sum, ms) => sum + ms, 0) / 60000;
      const workflow = fs.readFileSync(WORKFLOW, 'utf8');
      const match = workflow.match(/timeout-minutes:\s*(\d+)/);
      expect(match).not.toBeNull();
      // 30 extra minutes covers lint, formatting, headers, npm audit and setup.
      expect(Number(match[1])).toBeGreaterThanOrEqual(worstCaseMinutes + 30);
    });

    test('the audit never gives the regression suite less time than the real CI job takes', () => {
      const ci = fs.readFileSync(CI_WORKFLOW, 'utf8');
      expect(ci).toMatch(/npm run test:full -- --runInBand/);
    });
  });

  test('worstCaseMs sums per-check limits and falls back to the default', () => {
    expect(evaluate('policy.worstCaseMs([{timeoutMs: 1000}, {}, {timeoutMs: 2000}], 500)')).toBe(
      3500
    );
  });
});
