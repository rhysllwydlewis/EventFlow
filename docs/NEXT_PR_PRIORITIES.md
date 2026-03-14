# Next PR Priorities (Fix / Improve / Add)

This is a practical, execution-focused backlog to drive upcoming PRs.

## 1) Fix next (stability & risk)

### P0 — Reduce lint debt to zero warnings in touched areas ✅

- **Status:** Done in this PR batch.
- **Outcome:** Repository lint warnings reduced from 70 to 0.
- **Validation:** `npm run lint`

### P0 — Close optional-service production gaps ✅

- **Status:** Done in this PR batch.
- **Outcome:**
  - Added startup integration summary to make optional vs required services explicit.
  - Added production guardrails for missing critical configuration (`MONGODB_URI`, `JWT_SECRET`, `BASE_URL`) with controlled bypass via `ALLOW_DEGRADED_STARTUP=true`.
  - Extended `/api/health` to expose integration and guardrail status.
  - Reduced Redis adapter startup noise when Redis clustering is not configured.
- **Validation:** `npm run test:smoke`

### P1 — Address known `xlsx` security debt with migration plan ✅

- **Status:** Done in this PR batch.
- **Outcome:**
  - Added `DISABLE_XLSX_EXPORT=true` feature flag to `utils/export.js`.
  - When enabled, `exportToExcel()` falls back to CSV and `exportMiddleware` returns HTTP 400 for xlsx/excel.
  - Flag documented in `.env.example`.
  - Export tests updated (`tests/unit/export-xlsx-flag.test.js`).
- **Validation:** `npm run test -- --testPathPatterns=export-xlsx-flag`

## 2) Improve next (quality & maintainability)

### P1 — Complete API versioning follow-through

- **Why now:** roadmap marks API versioning complete, but still lists open tasks for docs and versioning tests.
- **Suggested PR scope:**
  - Add explicit API versioning tests and update API docs to show v1/v2 routing guarantees.
- **Acceptance criteria:**
  - Versioning contract tests in CI.
  - Docs include migration examples and deprecation behavior.

### P1 — Finish Sentry integration end-to-end ✅

- **Status:** Done in this PR batch.
- **Outcome:**
  - Backend `utils/sentry.js`: added `release` field (`eventflow@{version}`), replaced `console.*` with `logger`.
  - Frontend `public/assets/js/utils/sentry-browser-init.js` created: reads DSN from meta tag or `/api/v1/config`.
  - `/api/v1/config` now exposes `sentryDsn` (from `SENTRY_DSN_FRONTEND`) and `altchaSitekey`.
  - `sentry-browser-init.js` loaded on all 17 pages that carry `global-error-handler.js`.
  - Coverage tested by `tests/integration/sentry-frontend-coverage.test.js`.
- **Validation:** `npm run lint && npm test`

### P2 — Strengthen smoke/full regression governance

- **Why now:** remediation backlog indicates sustainment mode is active; this is the right time to harden guardrails.
- **Suggested PR scope:**
  - Keep smoke lane required and add a trend report for flaky/failing full-suite tests.
  - Add PR template checkbox for smoke command evidence.
- **Acceptance criteria:**
  - CI publishes smoke/full result summaries per PR.
  - Flake triage list auto-updated weekly.

## 3) Add next (product capability)

### P2 — Dashboard analytics widgets (already partially prepared)

- **Why now:** roadmap shows export utilities complete and Chart.js installed; widgets/date filtering remain open.
- **Suggested PR scope:**
  - Add 2 high-value widgets first: conversion funnel + supplier response time.
  - Include date-range filtering and empty/loading/error states.
- **Acceptance criteria:**
  - Widget data contracts tested.
  - Lighthouse/UX remains stable on dashboard pages.

### P2 — PWA install prompt completion

- **Why now:** service worker work is done, but install prompt integration is still unchecked.
- **Suggested PR scope:**
  - Add install banner with dismissal persistence and eligibility checks.
- **Acceptance criteria:**
  - Install prompt appears only when installable and not previously dismissed.

### P3 — Media UX upgrades (lightbox/zoom/carousel)

- **Why now:** explicitly listed as medium-priority future work; useful for conversion once core reliability items above are done.
- **Suggested PR scope:**
  - Ship one component at a time (lightbox first), with keyboard/touch support and perf budgets.
- **Acceptance criteria:**
  - Accessibility checks pass.
  - No measurable regression on mobile page performance.

## Recommended PR sequence (next 6 PRs)

1. **PR-A:** Lint warning reduction batch #1 + no-new-warnings policy for changed files.
2. **PR-B:** Integration health visibility + production env guardrails.
3. **PR-C:** API versioning contract tests + docs update.
4. **PR-D:** Sentry full integration + source maps.
5. **PR-E:** Dashboard widget slice 1 (conversion + response-time cards).
6. **PR-F:** PWA install prompt.

## Definition of readiness for each PR

- Problem statement tied to one backlog item.
- Before/after command evidence.
- Risk and rollback note.
- Tests attached to changed contract area.
