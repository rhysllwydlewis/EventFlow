# Backend Playwright quarantine

PR #1354 introduced a real-server, MongoDB-backed browser gate and exposed historical backend test debt that the previous static harness did not execute truthfully.

## Current status

The quarantine has been retired. All 20 current `@backend` Playwright specifications are now in the blocking MongoDB-backed suite, and `e2e/backend-suite-classification.json` contains no quarantined entries.

The final repair batch replaced historical page assumptions with deterministic current-product contracts for:

- administrator feature flags, including authenticated mutation, live feature enforcement and state restoration;
- customer enquiries from clean public supplier profiles;
- clean package URLs, legacy redirects and public package eligibility;
- supplier and marketplace discovery funnels;
- the current supplier dashboard shell and mobile layout;
- account-first supplier onboarding;
- approved-only review visibility across both public review readers;
- the complete supplier verification lifecycle.

The suite uses test-only, header-protected fixture endpoints that are mounted only when `NODE_ENV=test`. Each specification receives isolated MongoDB records identified by a unique run ID and removes its fixtures after execution. No fixture route is loaded in production.

## Classification invariant

Every `@backend` file must appear exactly once in the `blocking` array. The runner refuses to start when a file is missing, duplicated, stale or reintroduced into quarantine without an explicit repository change.

Run the complete blocking suite with:

```bash
npm run test:e2e:backend -- --project=chromium
```

A future test may be quarantined only when a tracked issue documents the current failure, the classification includes a specific reason and the blocking suite retains truthful coverage for the affected product area.
