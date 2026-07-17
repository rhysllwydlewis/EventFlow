# Availability, quote/booking foundations and blocking browser gates

## Status

This pull request is a **draft foundation**, not a completed availability-aware marketplace or quote-to-booking release.

The code currently provides:

- blocking browser workflow gates;
- feature flags that default the incomplete commercial journeys to disabled;
- defensive availability-domain helpers;
- defensive quote/booking-domain helpers;
- focused unit and workflow-regression tests.

It does **not** yet provide working supplier, customer or admin product journeys. The flags must remain disabled until the missing integration listed below is implemented and validated.

## Implemented in this PR

### Browser quality gates

- E2E auth, both E2E shards and repository visual regression no longer use `continue-on-error`.
- A pull-request-only `Browser Verification` job fails when a required browser prerequisite fails, is cancelled or is skipped.
- The aggregator does not run on post-merge push events where the PR-only visual prerequisite is intentionally skipped.
- The dedicated visual/axe workflow is blocking.
- Reports, traces and screenshot diffs are still uploaded with `if: always()`.
- Workflow permissions are explicitly least-privileged.

### Availability-domain helpers

- UK postcode normalisation, including `GIR 0AA`.
- validated GeoJSON points in `[longitude, latitude]` order;
- defensive distance calculation;
- valid Europe/London-style local calendar-date semantics;
- inclusive date-range validation and bounded multi-day evaluation;
- deterministic public status precedence;
- redaction of booked status to public unavailable;
- package-scoped exception handling;
- calendar freshness classification;
- intended index declarations for suppliers, calendars and separate availability exceptions.

These helpers are not yet connected to persistent collections, routes or marketplace UI.

### Quote/booking-domain helpers

- safe integer minor-unit arithmetic;
- positive quantities and overflow protection;
- quote state-transition rules;
- deeply immutable quote snapshots;
- defensive acceptance validation;
- hashed deterministic idempotency keys;
- guarded booking construction from accepted quotes only;
- truthful payment status when platform booking payments are disabled;
- intended unique-index declarations for quote versions and booking idempotency.

These helpers do not yet perform a MongoDB transaction or persist quotes/bookings.

## Not implemented

### Availability-aware marketplace

- geocoding provider and cache;
- persistent supplier coordinates and geocoding state;
- real database index creation/verification;
- supplier calendar collections and CRUD APIs;
- recurring rules, exceptions, provisional holds and booking blocks;
- supplier calendar UI;
- calendar freshness confirmation UI/API;
- server-side `$geoNear`/radius search;
- date-aware marketplace filtering and genuine nearest sorting;
- public marketplace filter controls and result badges;
- migration/backfill tooling;
- admin geocoding/calendar operations;
- availability maintenance jobs and shared telemetry;
- integration and Playwright journeys.

### Quote-to-booking

- persistent event briefs;
- enquiry/thread integration;
- persistent quotes and immutable version records;
- supplier quote composer;
- customer quote centre and comparison;
- transaction-safe acceptance;
- persistent bookings and availability blocks;
- customer, supplier and admin booking dashboards;
- cancellation and expiry jobs;
- Postmark lifecycle notifications;
- booking analytics;
- Stripe booking-payment integration/webhooks;
- transaction, concurrency and Playwright coverage.

## Required checks

Configure these pull-request checks as required after confirming their exact GitHub check-run names:

- `E2E Auth Focus`
- `E2E Tests Part 1 of 2`
- `E2E Tests Part 2 of 2`
- `Visual Regression Tests`
- `Browser Verification`
- `Visual + a11y (Chromium desktop + mobile)`
- `Dedicated Visual Verification`

## Safety rules

- Keep `marketplaceAvailability`, `quoteBooking` and `bookingPayments` disabled until the related end-to-end journey exists.
- Booking payments may only be considered active when quote booking is active.
- Do not create placeholder GeoJSON coordinates.
- Do not represent unknown availability as available.
- Do not accept a quote without a current availability recheck.
- Sent quote versions must be immutable.
- Quote acceptance must eventually run inside a MongoDB transaction with a unique booking idempotency constraint.
- Subscription billing and booking payments must remain separate.
- Do not run whole-database migrations during web-process startup.

## Definition of ready for review

This PR must remain draft until either:

1. its scope is intentionally limited to the browser gates and hardened domain foundations, with the unfinished product work moved into explicitly linked follow-up PRs; or
2. the missing product integration above is completed in this branch, with migrations, routes, UI, notifications, telemetry, integration tests and Playwright coverage passing on the exact final SHA.

Do not describe the supplier calendar, marketplace filtering, quote composer, customer quote centre or booking lifecycle as delivered before those journeys genuinely work.
