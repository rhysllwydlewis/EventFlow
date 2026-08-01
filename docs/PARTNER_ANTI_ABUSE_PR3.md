# PR3 — Partner cashout and operations controls

PR3 is the money-out and operational-control layer of the Partner Programme anti-abuse work. It is stacked on PR2 and must remain unmerged until PR1, PR2 and PR3 have completed their own review and validation.

## Objectives

PR3 is designed around one rule: qualifying activity does not become an irreversible payout merely because a cashout endpoint was reached.

The cashout path therefore has independent controls for submission, administrator approval, processing and delivery. A failure in an identity, limit, pause, concurrency, authoritative-storage or ledger-integrity check fails closed before the existing payout state machine is allowed to mutate the ledger.

## Authoritative storage boundary

PR3 does not use EventFlow's normal resilient database wrapper for money-out safety decisions. That wrapper is intentionally capable of normalising some MongoDB failures or using local fallback data, which is useful elsewhere but unsafe when an empty result could be interpreted as "no prior cashouts" or "no competing lock".

`partnerCashoutStrictStore` therefore provides a separate fail-closed boundary for PR3:

- production cashout controls require MongoDB;
- Mongo read/write errors propagate rather than becoming empty/null results;
- cashout policy, lock, reconciliation, operations-event and admin safety reads use this strict store;
- a database failure returns an unavailable response rather than allowing the legacy cashout path to continue; and
- non-production local mode remains available for development/tests but is explicitly not described as distributed or authoritative.

## Cashout policy limits

All amounts below are defaults and are configurable through environment variables.

| Control | Default | Environment variable |
| --- | ---: | --- |
| Maximum single cashout | £500 | `PARTNER_CASHOUT_MAX_SINGLE_GBP` |
| Maximum first cashout | £100 | `PARTNER_CASHOUT_FIRST_MAX_GBP` |
| Rolling 24-hour cashout exposure | £500 | `PARTNER_CASHOUT_24H_MAX_GBP` |
| Rolling 30-day cashout exposure | £1,000 | `PARTNER_CASHOUT_30D_MAX_GBP` |
| Maximum open requests per partner | 1 | `PARTNER_CASHOUT_MAX_OPEN_REQUESTS` |
| High-value manual-review threshold | £100 | `PARTNER_CASHOUT_HIGH_VALUE_REVIEW_GBP` |

Submitted, approved and processing requests count as open exposure. Submitted, approved, processing and delivered requests count toward rolling cashout exposure. Rejected requests do not consume the rolling payout limit.

Rolling exposure uses the latest meaningful money-moving stage timestamp (`deliveredAt`, then `processingAt`, then `approvedAt`, then `createdAt`). A request submitted weeks ago but paid today therefore counts as a recent payout rather than ageing out on its original submission date.

First cashouts always require manual review. A cashout at or above the configured high-value threshold also requires manual review.

## Distributed cashout locking

The older route already has a per-process cashout lock. PR3 adds an authoritative Mongo-backed lock so two application instances cannot independently pass the same exposure check at the same time.

Runtime installation is deliberately ordered so the effective request path is:

`distributed lock -> PR3 policy/reconciliation -> existing cashout handler`

Additional properties:

- partner cashout submission is serialised per partner;
- administrator status mutations are serialised per existing cashout request;
- CSRF is checked before lock storage is mutated;
- the lock is held while the PR3 policy check and existing ledger/request mutation execute;
- locks use a unique ID and owner token;
- expired-lock cleanup and release are owner-token scoped to prevent stale-owner/ABA deletion races;
- a live lease is renewed while the HTTP request remains in progress;
- a TTL index eventually cleans up abandoned locks after a crashed process; and
- a failed lock insert is only treated as ordinary contention when a real live competing owner can be verified. Unknown write failures fail closed.

A genuine busy lock returns a retryable conflict instead of allowing a second concurrent money movement.

## Emergency controls

The singleton `partner_programme_controls` record supports:

- `programmePaused` — master-pause Partner Programme **cashout progression**;
- `cashoutsPaused` — stop cashout submission/approval/processing/delivery while leaving referral earning and the rest of the programme available.

`programmePaused` is intentionally described in the admin UI as a **master payout pause**. PR3 does not currently stop referral registration or reward earning globally.

Changing either control requires an administrator reason. The actor, reason and timestamps are retained and an operations event is written. The singleton first-write path handles concurrent creation safely. Rejection remains available during a pause so an administrator can safely release points from an unsafe pending request.

## Cashout identity review

By default, administrator approval of a cashout requires a current explicit identity review.

`PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED=false` can disable this requirement, but the launch-safe default is enabled.

A verified review records:

- review status;
- administrator;
- review timestamp;
- review note;
- email snapshot; and
- company snapshot.

The linked partner email account must itself be verified before an administrator can mark cashout identity as verified.

The default review lifetime is 365 days (`PARTNER_CASHOUT_IDENTITY_REVIEW_MAX_AGE_DAYS`). A changed reviewed email/company identity, expired review, rejected review, inactive partner or unverified email blocks approval until the identity state is resolved.

The review is intentionally an administrator decision based on existing EventFlow account/business evidence. PR3 does not introduce collection of passports or other government identity documents.

## Ledger reconciliation and interrupted-delivery recovery

Before approval PR3 verifies that the request and temporary cashout hold agree. Processing and delivery are checked again before the existing state transition runs.

The reconciler checks:

- denomination × points-per-pound snapshot equals the recorded held points;
- exactly one cashout hold exists for the request;
- the stored hold transaction ID points to that hold;
- the hold amount exactly matches the held points;
- duplicate redeem/release transactions do not exist;
- redemption and release amounts match the request;
- the stored final redemption ID, when present, matches the ledger;
- delivered requests have one valid redeem and one hold release and no later redemption reversal; and
- rejected requests have one hold release, with a matching redemption reversal when an interrupted permanent debit existed.

The existing delivery implementation is intentionally idempotent. PR3 preserves its two recoverable crash/interruption states for `processing -> delivered` retries:

- `redeem_persisted` — the permanent debit was written but the hold release/status write was interrupted;
- `redeem_and_release_persisted` — both ledger writes completed but the final request-status write was interrupted.

Those exact states can proceed through the existing recovery handler. A released hold with no permanent debit, duplicate ledger entries, mismatched amounts or a reversed debit still fails closed.

A reconciliation result can be explicitly persisted from the admin operations endpoint for investigation and is surfaced on the normal cashout administration screen.

## Administrator operations API and UI

The existing administrator cashout router is extended with protected operations endpoints:

- `GET /api/v1/admin/cashout-requests/ops/controls`
- `PATCH /api/v1/admin/cashout-requests/ops/controls`
- `PATCH /api/v1/admin/cashout-requests/ops/identity/:partnerId`
- `POST /api/v1/admin/cashout-requests/ops/reconcile/:id`
- `GET /api/v1/admin/cashout-requests/ops/events`

Writes use the existing administrator authentication and CSRF protections. Operations-event listing is database-paginated rather than loading the entire collection into application memory.

The ordinary administrator cashout page also surfaces the controls needed during a real review:

- current cashout/master payout pause state and configured exposure limits;
- identity-review state and expiry/drift warnings;
- persisted reconciliation state and issue codes;
- existing fraud-risk summary;
- verify/reject identity actions using an internal audit note; and
- an explicit ledger-reconciliation action using the next expected cashout state as context.

Admin cashout list/detail responses are enriched through the same strict authoritative storage boundary, so the safety UI does not silently render incomplete state after a database failure.

## Operations evidence and alerts

PR3 stores dedicated `partner_cashout_ops_events` records for operational decisions such as blocked submissions, status-transition requests/outcomes, pause changes, identity reviews and explicit reconciliation.

Status-transition attempts record a requested event and then an asynchronous completed/failed outcome including the HTTP status. A failure to write the post-response audit event is logged without pretending the already-completed payout mutation can be rolled back.

High-risk cashouts and reconciliation failures also use the existing administrator notification service. Repeated high-risk assessments do not repeatedly notify when a persisted high-risk assessment already exists. The existing PR1/PR2 fraud assessment remains authoritative for fraud scoring; PR3 augments it with high-value manual-review evidence rather than replacing it.

## Audit retention

The live PR3 route path prevents permanent deletion of cashout requests, including terminal requests. Cashout records are financial and anti-abuse evidence and should remain available for reconciliation and incident review.

The legacy route still contains its historical delete implementation for compatibility/source history, but PR3 inserts the retention guard before that handler when the application routes are initialised.

## Database indexes

PR3 ensures indexes for:

- the singleton payout-control record;
- cashout operations event IDs and request/partner/action timelines;
- partner/status/time cashout policy lookups;
- persisted reconciliation status;
- partner cashout identity-review state; and
- distributed operation locks, including unique ownership ID and TTL expiry.

Index initialisation is idempotent and retried after startup failures.

## Validation gate

The PR3-specific suites included in `npm run test:smoke` are:

- `tests/unit/partner-cashout-operations.test.js`
- `tests/unit/partner-cashout-operations-runtime.test.js`
- `tests/unit/partner-cashout-operations-indexes.test.js`
- `tests/unit/partner-cashout-operation-lock.test.js`
- `tests/unit/partner-cashout-strict-store.test.js`
- `tests/unit/partner-cashout-admin-enrichment.test.js`
- `tests/unit/partner-cashout-admin-ui.test.js`

These are in addition to the pre-existing partner anti-abuse, ledger, cashout and reward-integrity regression suites already in that gate.

The new tests specifically cover strict-storage failure propagation, lock ownership/renewal, stale-owner cleanup, ambiguous lock writes, rolling payout timestamps, interrupted-delivery recovery, identity-review drift/expiry, admin safety-state enrichment and admin UI endpoint wiring.

## Rollout procedure

For the initial programme rollout:

1. Keep explicit cashout identity review enabled.
2. Keep the first-cashout maximum conservative until genuine payout history exists.
3. Review every first cashout and every request at or above the high-value threshold.
4. Use reconciliation before progressing a request when any ledger state looks unusual.
5. Use the master payout/cashout pause immediately if repeated reconciliation failures, coordinated fraud, database authority uncertainty or payout-processing uncertainty appears.
6. Reject unsafe requests rather than deleting them; retain the request and operational evidence.
7. Do not treat shared offices, venues or networks as proof of fraud in isolation.

## Current status

PR3 is a draft. The controls above describe the current implementation, not a claim that the PR has passed full hosted CI or is ready to merge. The post-implementation audit found and corrected several material issues, including runtime lock ordering, interrupted-delivery recovery, strict database semantics and payout timestamp accounting. Hosted validation and final source review are still required before the PR is promoted from draft.
