'use strict';

/**
 * Runs the real scripts/test-audit.mjs end to end with the checks' commands replaced by canned
 * results, and asserts on what it writes. The audit's `main()` used to be one 200-line function
 * with no tests; it was split into small functions and this keeps the whole flow honest:
 * running, parsing, classifying, summarising, and the six output files.
 *
 * Every check is run as `timeout -k 10s <N>s bash -lc "<command>"`, so a fake `timeout` first on
 * PATH intercepts them and answers by command.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');

const FAKE_TIMEOUT = `#!/bin/bash
shift 3
cmd="$3"
case "$cmd" in
  pgrep*) exit 0 ;;
  *"run lint"*) echo "lint: 0 errors"; exit 0 ;;
  *"format:check"*) echo "[warn] src/a.js"; echo "[warn] Code style issues found in the above file."; exit 1 ;;
  *"test:smoke"*)
    mkdir -p test-audit
    echo '{"numPassedTestSuites":54,"numPassedTests":567,"numTotalTests":567,"testResults":[]}' > test-audit/jest-smoke.json
    echo "smoke ok"; exit 0 ;;
  *"test:ci"*)
    mkdir -p test-audit
    cat > test-audit/jest-ci.json <<'JSON'
{"numPassedTestSuites":10,"numPassedTests":100,"numTotalTests":102,"testResults":[{"name":"/x/tests/unit/a.test.js","assertionResults":[{"status":"passed","fullName":"ok"},{"status":"failed","fullName":"a fails","failureMessages":["expect(received).toBe(expected) // Object.is equality"]},{"status":"failed","title":"needs env","failureMessages":["Error: missing required environment variable JWT_SECRET"]}]}]}
JSON
    echo "FAIL tests/unit/a.test.js"; exit 1 ;;
  *"test:full"*) echo "starting full regression"; exit 124 ;;
  *"test:e2e:static"*)
    mkdir -p test-results playwright-report
    echo report > playwright-report/index.html; echo trace > test-results/trace.txt
    cat > test-results/playwright-static.json <<'JSON'
{"suites":[{"file":"e2e/a.spec.js","specs":[{"title":"ok one","tests":[{"outcome":"expected","results":[{"status":"passed"}]}]},{"title":"broken one","tests":[{"outcome":"unexpected","results":[{"status":"failed","error":{"message":"Timeout 30000ms exceeded locating chromium"}}]}]}],"suites":[{"file":"e2e/b.spec.js","specs":[{"title":"nested ok","tests":[{"outcome":"expected","results":[{"status":"passed"}]}]}]}]}]}
JSON
    echo "2 passed 1 failed"; exit 1 ;;
  *"test:headers"*) echo "headers ok"; exit 0 ;;
  *"audit:golive:live"*) echo "live ok"; exit 0 ;;
  *"audit:golive"*) echo "golive ok"; exit 0 ;;
  *"npm audit"*) echo "found 2 vulnerabilities"; exit 1 ;;
  *) echo "unhandled fake command: $cmd"; exit 0 ;;
esac
`;

/** Runs the audit in a scratch directory and returns everything it produced. */
function runAudit(args) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'test-audit-'));
  fs.mkdirSync(path.join(work, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(work, 'bin'));
  fs.mkdirSync(path.join(work, '.github/workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'scripts/test-audit.mjs'),
    path.join(work, 'scripts/test-audit.mjs')
  );
  for (const file of fs.readdirSync(path.join(ROOT, 'scripts/lib'))) {
    if (file.startsWith('test-audit-')) {
      fs.copyFileSync(path.join(ROOT, 'scripts/lib', file), path.join(work, 'scripts/lib', file));
    }
  }
  for (const file of ['ci.yml', 'e2e.yml', 'visual-regression.yml']) {
    fs.copyFileSync(
      path.join(ROOT, '.github/workflows', file),
      path.join(work, '.github/workflows', file)
    );
  }
  fs.writeFileSync(path.join(work, 'bin/timeout'), FAKE_TIMEOUT, { mode: 0o755 });

  const run = spawnSync(process.execPath, ['scripts/test-audit.mjs', ...args], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(work, 'bin')}:${process.env.PATH}`, CI: 'true' },
  });
  const out = path.join(work, 'test-audit');
  const read = file => fs.readFileSync(path.join(out, file), 'utf8');
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    files: fs.readdirSync(out).sort(),
    logs: fs.readdirSync(path.join(out, 'logs')).sort(),
    report: read('TEST_AUDIT_REPORT.md'),
    results: JSON.parse(read('results.json')),
    failing: JSON.parse(read('failing-tests.json')),
    failingMd: read('failing-tests.md'),
    failingCsv: read('failing-tests.csv'),
    passing: read('passing-summary.md'),
    artifacts: fs.existsSync(path.join(out, 'artifacts'))
      ? fs.readdirSync(path.join(out, 'artifacts', 'playwright-static'))
      : [],
    cleanup: () => fs.rmSync(work, { recursive: true, force: true }),
  };
}

describe('scripts/test-audit.mjs end to end', () => {
  describe('ci mode', () => {
    let audit;
    beforeAll(() => {
      audit = runAudit(['--ci']);
    });
    afterAll(() => audit.cleanup());

    test('fails the run, because checks failed', () => {
      expect(audit.status).toBe(1);
      expect(audit.stderr).toBe('');
    });

    test('writes every output file and a log per check', () => {
      expect(audit.files).toEqual(
        expect.arrayContaining([
          'TEST_AUDIT_REPORT.md',
          'artifacts',
          'failing-tests.csv',
          'failing-tests.json',
          'failing-tests.md',
          'logs',
          'passing-summary.md',
          'results.json',
        ])
      );
      expect(audit.logs).toEqual([
        'format-check.log',
        'full-regression.log',
        'jest-ci.log',
        'lint.log',
        'playwright-static.log',
        'security-headers.log',
        'smoke.log',
      ]);
    });

    test('prints the report it wrote', () => {
      expect(audit.stdout).toContain(audit.report.slice(0, 200));
    });

    test('gives each check the right status and category', () => {
      const byId = Object.fromEntries(audit.results.results.map(r => [r.id, r]));
      expect(Object.keys(byId)).toHaveLength(7);
      expect(Object.fromEntries(Object.entries(byId).map(([id, r]) => [id, r.status]))).toEqual({
        lint: 'PASS',
        'format-check': 'FAIL',
        smoke: 'PASS',
        'jest-ci': 'FAIL',
        'full-regression': 'FAIL',
        'playwright-static': 'FAIL',
        'security-headers': 'PASS',
      });
      expect(byId['format-check'].likelyCategory).toBe('Formatting/style issue');
      expect(byId['full-regression'].likelyCategory).toBe(
        'Audit runner timeout / incomplete result'
      );
      expect(byId.lint.likelyCategory).toBe('');
      expect(byId.lint.failureReason).toBe('');
    });

    test('flags the check that hit its time limit as incomplete', () => {
      const full = audit.results.results.find(r => r.id === 'full-regression');
      expect(full.exitCode).toBe(124);
      expect(full.timedOut).toBe(true);
      expect(full.incomplete).toBe(true);
      expect(full.notes).toMatch(/timed out before this check could complete/);
      expect(audit.results.results.find(r => r.id === 'lint').timedOut).toBe(false);
    });

    test('extracts individual failing tests from the Jest and Playwright output and classifies them', () => {
      expect(audit.failing.map(f => [f.runner, f.name, f.category])).toEqual([
        ['Jest', 'a fails', 'Stale test expectation'],
        ['Jest', 'needs env', 'Environment/config issue'],
        ['Playwright', 'broken one', 'Environment/config issue'],
      ]);
      expect(audit.failingCsv.split('\n')[0]).toBe(
        '"Test runner","Test file","Test name","Failure message","Likely category","Suggested next action"'
      );
      expect(audit.failingCsv.trim().split('\n')).toHaveLength(4);
      expect(audit.failingMd).toContain('| Playwright | e2e/a.spec.js | broken one |');
    });

    test('summarises passing totals from the machine-readable output', () => {
      expect(audit.results.passingSummaries).toEqual(
        expect.arrayContaining([
          { id: 'smoke', passedTestSuites: 54, passedTests: 567, totalTests: 567 },
          { id: 'jest-ci', passedTestSuites: 10, passedTests: 100, totalTests: 102 },
          { id: 'playwright-static', passed: 2 },
          { id: 'lint' },
        ])
      );
      expect(audit.passing).toContain('"passedTests": 567');
    });

    test('copies the artifact directories a check names', () => {
      expect(audit.artifacts.sort()).toEqual(['playwright-report', 'test-results']);
      const check = audit.results.results.find(r => r.id === 'playwright-static');
      expect(check.notes).toMatch(/Artifacts copied: artifacts\/playwright-static\//);
    });

    test('reports the summary, tables and recommendation', () => {
      expect(audit.report).toContain('- Total checks run: 7');
      expect(audit.report).toContain('- Passing checks: 3');
      expect(audit.report).toContain('- Failing checks: 4');
      expect(audit.report).toContain('- Overall status: RED — one or more checks failed');
      expect(audit.report).toContain('- Most serious issue: Formatting');
      expect(audit.report).toContain('Mode: ci\n');
      expect(audit.report).toContain('Environment: GitHub Actions/CI');
      expect(audit.report).toMatch(/\| Code quality \| `npm run lint` \| PASS \|/);
      expect(audit.report).toMatch(/\| Formatting \| `npm run format:check` \| FAIL \|/);
      expect(audit.report).toContain('### Full Jest regression');
      expect(audit.report).toContain('- Exit code: 124');
      expect(audit.report).toContain('## Workflow / CI Findings');
    });

    test('lists what it did not run, including the read-only live checks', () => {
      const ids = audit.results.skipped.map(s => s.id);
      expect(ids).toContain('go-live-audit-live');
      expect(ids).toContain('playwright-full');
      expect(audit.results.skipped.every(s => s.status === 'SKIPPED')).toBe(true);
      expect(audit.report).toContain('Live checks require explicit --live');
      expect(audit.results.allChecks).toHaveLength(
        audit.results.results.length + audit.results.skipped.length
      );
    });
  });

  describe('modes', () => {
    test('quick mode runs fewer checks and does not fail the run', () => {
      const audit = runAudit(['--quick']);
      try {
        expect(audit.results.results.length).toBeLessThan(7);
        expect(audit.status).toBe(0);
        expect(audit.report).toContain('Mode: quick\n');
      } finally {
        audit.cleanup();
      }
    });

    test('--live adds the live check and stops listing it as skipped', () => {
      const audit = runAudit(['--ci', '--live']);
      try {
        expect(audit.results.results.map(r => r.id)).toContain('go-live-audit-live');
        expect(audit.results.skipped.map(s => s.id)).not.toContain('go-live-audit-live');
        expect(audit.report).toContain('Mode: ci + live\n');
      } finally {
        audit.cleanup();
      }
    });

    test('a warning-only check is reported as a warning while a real failure still fails full mode', () => {
      const audit = runAudit(['--full']);
      try {
        const npmAudit = audit.results.results.find(r => r.id === 'npm-audit');
        expect(npmAudit.status).toBe('WARNING');
        expect(audit.results.results.some(r => r.status === 'FAIL')).toBe(true);
        // full mode fails the run when any check fails (see test-audit-policy.test.js)
        expect(audit.status).toBe(1);
      } finally {
        audit.cleanup();
      }
    });
  });
});
