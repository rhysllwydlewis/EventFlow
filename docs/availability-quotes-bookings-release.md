# Availability-aware marketplace, quote-to-booking, and blocking browser gates

This release note is the implementation map for the coordinated marketplace and commercial-booking programme. It records the canonical EventFlow surfaces that must be reused as the product code rolls out, the new domains to introduce, and the branch-protection gates that now block browser regressions.

## 1. Executive summary

EventFlow's supplier discovery, enquiry and messaging journey should evolve into an availability-aware quote-to-booking flow without creating a parallel marketplace, a second inbox or a separate operations dashboard. The canonical public supplier endpoints remain mounted through `routes/suppliers.js`, marketplace support stays with `routes/marketplace.js` and `routes/search.js`, supplier package ownership stays with `routes/packages.js`, and customer/supplier conversations continue to use the Messenger v4 thread model documented in `docs/MESSENGER_V4_FINAL_STATUS.md`.

## 2. Product journeys delivered

- Customers search suppliers by event date, optional end date, UK postcode, radius and existing marketplace filters.
- Suppliers maintain public-safe availability from the supplier dashboard and confirm calendar freshness.
- Suppliers convert an existing enquiry/thread into a structured quote using integer minor-unit money.
- Customers compare, accept or reject quote versions, with acceptance creating exactly one booking and a booking-created availability block.
- Admins inspect geocoding coverage, stale calendars, quote/booking status, audit history and background-job telemetry in existing admin/debug surfaces.

## 3. Existing architecture reused

- Public supplier search and supplier profile data: `routes/suppliers.js`.
- Marketplace listing support: `routes/marketplace.js` and `routes/search.js`.
- Supplier-owned package data and dashboard package APIs: `routes/packages.js`.
- Existing quote-request compatibility endpoint: `routes/quote-requests.js`.
- Messaging and enquiry context: Messenger v4 thread/message entities in `data/threads.json`, `data/messages.json` and the documented dashboard widgets.
- Postmark delivery, Stripe subscription billing, privacy analytics, Admin Debug and `background_job_runs` telemetry must be extended, not replaced.

## 4. Data models and indexes

### Supplier location

Supplier location normalisation must add a canonical `locationGeo` GeoJSON point only after a postcode has resolved to a valid longitude/latitude pair. Coordinates are stored as `[longitude, latitude]`; invalid or placeholder coordinates are omitted rather than stored. Required indexes are:

- `suppliers.locationGeo`: `2dsphere`;
- `suppliers.normalisedPostcode`;
- `suppliers.geocoding.status` plus `suppliers.geocoding.updatedAt`.

### Availability

Availability uses compact calendars plus date-range exceptions rather than one document per ordinary available day. Public status vocabulary is `available`, `provisional`, `booked`, `unavailable` and `unknown`. Event dates are Europe/London local calendar dates with inclusive start and end dates, so DST changes do not shift the chosen date.

### Quotes and bookings

Quotes store immutable sent-version snapshots and integer GBP minor units. Bookings store the accepted quote snapshot, event/date/location snapshot, payment state, lifecycle state and the availability block reference. A deterministic idempotency key and unique index protect quote acceptance from duplicate booking creation.

## 5. Availability/search behaviour

Hard constraints are applied before paid placement or relevance boosts. Date and availability filters cannot be overridden by featured/promoted sorting. Radius filtering requires a valid origin and uses geospatial indexes where MongoDB is available. Suppliers without coordinates or calendars remain visible unless the customer explicitly asks for available-only results; unknown availability is never labelled as available.

Precedence: date range, availability-only, valid postcode/radius, category, price, rating, verification, featured/promoted status, relevance, distance, deterministic ID tie-break.

## 6. Quote and booking state machines

Quote states: `draft`, `sent`, `viewed`, `revised`, `accepted`, `rejected`, `withdrawn`, `expired`.

Booking states: `pending_confirmation`, `pending_payment`, `confirmed`, `in_progress`, `completed`, `cancelled`, `disputed`.

Acceptance re-reads the latest quote inside a transaction, verifies ownership/current version/expiry, rechecks availability, creates or returns the idempotent booking, writes the booking-created availability block and queues notifications after commit.

## 7. Payment feature-flag behaviour

`BOOKING_PAYMENTS_ENABLED` must remain explicit opt-in. With the flag disabled, quote acceptance is safe and creates a booking without exposing a payment button. With it enabled, booking payment metadata is separate from supplier subscription metadata, webhooks are signature-verified and idempotent, and the browser redirect is not trusted as confirmation.

## 8. Security and privacy boundaries

- Browser mutations require authentication, role checks, CSRF and write-rate limiting.
- Supplier ownership and customer quote ownership are checked on every object-level action.
- Public availability responses redact customer identity and private booking details.
- Analytics must never include full postcodes, quote text, message contents or payment secrets.
- Subscription Stripe webhooks and booking-payment Stripe webhooks remain separate paths.

## 9. Migration and rollback approach

Backfills for supplier postcode normalisation, geocoding, indexes and enquiry/thread linkage must be idempotent, resumable, batch-limited and dry-run capable. No web-process startup may run a whole-database mutation. Rollback is feature-flag-first: disable `MARKETPLACE_AVAILABILITY_ENABLED`, `QUOTE_BOOKING_ENABLED` or `BOOKING_PAYMENTS_ENABLED`, then leave commercial records intact for remediation.

## 10. Browser-gate changes and required check names

Browser tests are now blocking because workflow test steps no longer use merge-permissive `continue-on-error`, obsolete soft-fail wording and dates were removed, and explicit aggregators fail when a dependency is failed, cancelled or skipped.

Configure these required checks in branch protection:

- `E2E Auth Focus`
- `E2E Tests Part 1 of 2`
- `E2E Tests Part 2 of 2`
- `Visual Regression Tests`
- `Browser Verification`
- `Visual + a11y (Chromium desktop + mobile)`
- `Dedicated Visual Verification`

## 11. Changed-file scope grouped by programme

- Programme A: availability/search domain map plus the foundational postcode, GeoJSON, distance, date-overlap, freshness, public-redaction and index helper in `services/availability.service.js`.
- Programme B: quote/booking state-machine map plus the foundational integer-money, immutable snapshot, acceptance validation, idempotency and booking-construction helper in `services/quoteBooking.service.js`.
- Programme C: `.github/workflows/e2e.yml`, `.github/workflows/visual-regression.yml`, and `tests/unit/browser-workflow-gates.test.js`.

## 12. Test evidence from the exact final SHA

Record the exact commands and final SHA in the pull request before marking ready for review. Do not claim live production verification unless it was actually run against production.

## 13. Known limitations and deferred work

The live geocoding provider and live booking-payment provider require production credentials and operational enablement outside repository code. The safe boundary, flags, required indexes, telemetry expectations and provider separation are documented here; production activation must follow the checklist below.

## 14. Production enablement steps

1. Deploy with all new feature flags disabled.
2. Verify indexes and Admin Debug health.
3. Run dry-run migrations and review counts.
4. Run controlled backfills in bounded batches.
5. Enable availability for a small supplier cohort.
6. Enable quote/booking for controlled accounts.
7. Enable booking payments only after Stripe booking-payment test-mode verification.

## 15. Post-deployment verification checklist

### Availability

1. Confirm required indexes exist.
2. Run geocoding backfill in dry-run mode.
3. Review counts and failures.
4. Run controlled production backfill.
5. Enable availability feature flag.
6. Update one supplier calendar.
7. Search using a real UK postcode/date/radius.
8. Confirm nearest sorting and distance values.
9. Confirm unknown availability is not shown as available.
10. Confirm Admin Debug health and telemetry.

### Quotes and bookings

1. Enable quote/booking flag for a controlled test account or environment.
2. Create an enquiry/event brief.
3. Send and revise a quote.
4. Accept the latest version.
5. Confirm exactly one booking exists.
6. Confirm supplier availability is blocked.
7. Confirm both dashboards show the booking.
8. Confirm email delivery state.
9. Test a deliberate availability conflict.
10. Test cancellation and calendar behaviour.

### Payments, only when enabled

1. Verify Stripe booking-payment configuration.
2. Use test mode first.
3. Confirm signed webhook receipt.
4. Confirm duplicate webhooks are harmless.
5. Confirm browser redirect alone does not mark payment successful.
6. Confirm receipt/payment status.
7. Enable production payments only after the controlled test passes.

### Browser gates

1. Confirm the required check names are enabled in branch protection.
2. Deliberately test the gate on a temporary branch with one failing Playwright assertion.
3. Confirm the PR is blocked.
4. Revert the deliberate failure.
5. Confirm all checks pass.
