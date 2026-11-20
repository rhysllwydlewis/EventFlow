// Policy for the scheduled test audit (scripts/test-audit.mjs).
//
// Kept in its own module so tests/unit/test-audit-policy.test.js can check it
// without running the audit.

const MINUTE = 60 * 1000;

/**
 * Per-check time limits. These must be at least as generous as the matching
 * jobs in the normal CI workflows, otherwise the audit "fails" on every run
 * with exit code 124 (timeout) and never reports a real result.
 *
 * Reference runtimes from CI: the Full Regression job takes about 11 minutes
 * and has a 25 minute limit (.github/workflows/ci.yml); the e2e shards take a
 * few minutes each.
 */
export const CHECK_TIMEOUTS_MS = Object.freeze({
  smoke: 3 * MINUTE,
  'jest-ci': 20 * MINUTE,
  'full-regression': 30 * MINUTE,
  'playwright-static': 15 * MINUTE,
  'playwright-full': 20 * MINUTE,
  visual: 10 * MINUTE,
  a11y: 10 * MINUTE,
});

/**
 * Modes where a failing check must fail the workflow. `full` used to be left
 * out, so the Sunday run exited 0 with red checks, the workflow reported
 * "success", and the "Close recovered regression issue" step closed the open
 * failure issue even though nothing had recovered.
 */
export const FAILING_MODES = Object.freeze(['ci', 'full']);

export function shouldFailRun(mode, failCount) {
  return FAILING_MODES.includes(mode) && Number(failCount) > 0;
}

/**
 * The largest total time the audit can spend waiting on checks in a mode,
 * given the checks it will run. The workflow's `timeout-minutes` has to be
 * larger than this, or GitHub kills the job before the report is written.
 */
export function worstCaseMs(checks, defaultMs = 5 * MINUTE) {
  return checks.reduce((sum, check) => sum + (check.timeoutMs || defaultMs), 0);
}
