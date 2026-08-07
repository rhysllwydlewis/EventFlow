# EventFlow Test Audit

The autonomous test audit runs EventFlow's meaningful quality checks in sequence and creates a plain-English green/red report. It is designed to show the current testing baseline without fixing product behaviour, weakening tests, changing coverage thresholds, or touching Railway deployment settings.

## Local commands

```bash
npm run test:audit:quick
npm run test:audit
npm run test:audit:full
npm run test:audit:ci
```

- `test:audit:quick` runs linting, formatting, smoke Jest tests, Jest CI, and static Playwright where practical.
- `test:audit` adds the full Jest regression and local security-header checks.
- `test:audit:full` runs every practical local check, including full/backend Playwright, visual regression, a11y, local go-live audit, and production dependency audit.
- `test:audit:ci` uses the default audit set and exits non-zero if checks fail, so it is suitable for diagnostic CI jobs.

All modes continue after failures. Raw logs are written under `test-audit/logs/`, while the readable report is written to `test-audit/TEST_AUDIT_REPORT.md`. Machine-readable output is written to `results.json`, individual failures to `failing-tests.json`, `failing-tests.md`, and `failing-tests.csv`, and pass totals to `passing-summary.md`.

## GitHub Actions

Use the manual **EventFlow Test Audit** workflow from the Actions tab. It checks out the repository, installs the Node 22.x version pinned in `.node-version`, installs Chromium for Playwright, runs `npm run test:audit:full`, and uploads the entire `test-audit` folder as an artifact with `if: always()`.

This workflow is diagnostic only. It does not deploy, does not change Railway, and is not a required deployment gate.

## Reading the report

Status meanings:

- **PASS**: the command exited successfully.
- **FAIL**: the command exited unsuccessfully and should be triaged.
- **WARNING**: the command found something important, but the audit classifies it as advisory rather than a product test failure.
- **SKIPPED**: the check was not selected for the current mode or was unsafe/unavailable in the current environment.

The green list shows checks that passed. The red list shows failing or warning checks with likely categories and next actions. Individual failing tests are extracted from Jest and Playwright JSON output where possible; if a runner only exposes suite-level output, the report says so honestly. Skipped checks are explicitly listed so they are never mistaken for passes.

## Live checks

Live checks are opt-in only with:

```bash
node scripts/test-audit.mjs --full --live
```

Live checks must remain read-only. They must never submit forms, mutate data, send email, call Stripe, upload files, create accounts, alter database records, or trigger third-party side effects.

## After the first report

Use the recommended fix order in the report to create focused follow-up PRs. Do not update snapshots, weaken assertions, lower coverage thresholds, or delete tests just to make the audit green.
