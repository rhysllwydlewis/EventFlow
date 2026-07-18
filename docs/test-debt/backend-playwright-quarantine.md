# Backend Playwright quarantine

PR #1354 introduced a real-server, MongoDB-backed browser gate and exposed historical backend test debt that the previous static harness did not execute truthfully.

This pull request increases the blocking set from 10 to 12 spec files:

- `start-wizard-journey.spec.js` now establishes a same-origin document before localStorage access and tests the current wizard journey.
- `suppliers.spec.js` now tests current supplier-directory, API and logged-out intent contracts without `networkidle` races.
- superseded `websocket.spec.js` has been removed; `websocket-v2.spec.js` remains the current blocking socket contract.

Every remaining quarantined file is declared in `e2e/backend-suite-classification.json`; the runner refuses to start when any `@backend` spec is unclassified.

## Remaining repair checklist

- [ ] `admin-feature-flags.spec.js` — authenticate properly, change and restore flags, and assert the current registration validation/rate-limit contract.
- [ ] `customer-enquiry-flow.spec.js` — rebuild fixtures and selectors around the current enquiry journey and remove live-page `networkidle` waits.
- [ ] `packages.spec.js` — replace legacy price controls and persistent-service `networkidle` assumptions with current deterministic contracts.
- [ ] `public-discovery-funnel.spec.js` — align the marketplace new-listing logged-out flow with the current redirect and intent contract.
- [ ] `supplier-dashboard-improvements.spec.js` — replace removed onboarding cards and legacy dashboard selectors with current UI contracts.
- [ ] `supplier-onboarding.spec.js` — test the current account-first supplier onboarding rather than a retired full-profile registration form.
- [ ] `supplier-reviews.spec.js` — create current supplier/review fixtures and remove obsolete profile resources and `networkidle` waits.
- [ ] `supplier-verification-flow.spec.js` — replace source-literal checks with current verification API behaviour.

## Removal criteria

A file may leave quarantine only when its assertions represent the current product, it passes repeatedly against the real server and MongoDB replica set, and it is moved into the `blocking` array in the same change.

Run the complete diagnostic set with:

```bash
npm run test:e2e:backend -- --include-quarantined --project=chromium
```
