# Supplier dashboard data

`GET /api/supplier/dashboard-summary?days=30` (also under `/api/v1/`) returns every
headline number the supplier dashboard shows, in one call, computed from real records.
Supplier role only (403 otherwise; 404 if the account has no supplier profile).
Code: `routes/supplier.js` (thin route) -> `services/supplierDashboardSummary.js`,
`services/supplierEngagementMetrics.js`, `services/supplierNextSteps.js`,
`services/supplierProfileCompleteness.js`, `utils/analyticsWindow.js`.

## Null semantics

`null` means "not enough data" or "the source was unavailable". It is never a disguised
`0` or `100`. A `0` is a real zero. If a block's source query fails, that block is
`null`-filled and named in the top-level `unavailable: string[]`; other blocks still return.

## Contract

| Key                    | Shape                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window`               | `{days, maxDays, requestedDays}`                                                                  | `requestedDays` = what was asked (default 30, capped at 90). `days` = what was served: limited by the plan's `analyticsWindowDays` (Starter 7, Pro 90, Pro Plus 365 but this endpoint never serves more than 90). `maxDays` = longest this supplier can get. Every windowed number below uses `days`.                                                                  |
| `verification`         | `{emailVerified, approved, state, status, submittedAt, reviewedAt, rejectionCount, notes}`        | `emailVerified` = `users.verified` (the field every server gate checks). `approved` = `supplier.approved === true` (the enforced gate). `state` is `unverified\|pending\|approved\|rejected`; `status` is the detailed state machine value. `needs_changes`, `rejected`, `suspended` all map to `rejected`. `notes` = admin note, only for `needs_changes`/`rejected`. |
| `profile`              | `{name, publicProfilePath, completeness:{score, checks[]}, ...}`                                  | `checks[] = {id,label,weight,done,href}`. Legacy keys kept: `hasProfile, profileCount, topProfileId, topProfileName, healthScore, isApproved, completionFlags`.                                                                                                                                                                                                        |
| `packages`             | `{total, active, paused, awaitingApproval, limit, countedTowardsLimit, draft}`                    | `active` = live (not paused, not awaiting approval). `limit` = plan `maxPackages` (`-1` unlimited). `countedTowardsLimit` = packages not paused (what create/unpause enforce). Works for unapproved suppliers. `draft` = legacy alias of `awaitingApproval`.                                                                                                           |
| `messages`             | `{unreadMessages, conversationsWithUnread, latestAt, total, unread}`                              | From `conversations_v4`, same rule as `/api/v4/messenger/unread-count` (active conversations, minus archived/muted). `total`/`unread` are legacy (inbox conversations / conversations with unread).                                                                                                                                                                    |
| `enquiries`            | `{newThisPeriod, previousPeriod, sources:{conversations, quoteRequests, contactForm}, truncated}` | See below.                                                                                                                                                                                                                                                                                                                                                             |
| `responses`            | `{sampleSize, matureSampleSize, repliedPct, medianMinutes}`                                       | See below.                                                                                                                                                                                                                                                                                                                                                             |
| `views`                | `{total, days, basis:'page_loads'}`                                                               | `profile_view` events in the window. Honest label: page loads, not people.                                                                                                                                                                                                                                                                                             |
| `reviews`              | `{approvedCount, averageRating, pendingCount, total, pending}`                                    | Only `moderation.state === 'approved'` reviews are counted (same rule as the public reviews panel). `averageRating` is `null` with no rated approved review. `total`/`pending` are legacy aliases.                                                                                                                                                                     |
| `subscription`         | `{plan, status, activeUntil, cancelAtPeriodEnd, limits, tier, renewsAt, trialEndsAt}`             | From the subscription record and plan matrix. No Stripe call on this path.                                                                                                                                                                                                                                                                                             |
| `upcoming`             | `[{id, title, date, time, source}]`                                                               | Next 3 of the supplier's personal calendar entries and public events they created (`source` `personal`/`public`). Calendar entries, not bookings.                                                                                                                                                                                                                      |
| `nextSteps`            | `{steps[], completed, total, percent, primaryStepId}`                                             | `steps[] = {id,label,done,locked,lockedReason,href,priority}`. 13 milestones, independent of email preferences. `primaryStepId` = first step neither done nor locked.                                                                                                                                                                                                  |
| `analytics`, `tickets` | legacy                                                                                            | Kept for the old page; values are now honest (reply figures from the v4 collections or `null`).                                                                                                                                                                                                                                                                        |

### Enquiries

Counts three real flows in the window (and the same-length previous window):

- `conversations`: `conversations_v4` the supplier's owner is in, created in the window, whose first
  message was written by a customer (supplier-started outreach, supplier-to-supplier and admin
  threads are excluded).
- `quoteRequests`: `quoteRequests` rows whose `suppliers[]` names this supplier.
- `contactForm`: `enquiries` rows (`POST /api/v1/contact-supplier`) for this supplier.

`enquiry_sent` analytics events are **not** counted: nothing emits them and the beacon endpoint is
anonymous and spoofable. `truncated` is `true` if more than 1000 conversations had to be scanned
(counts are then lower bounds).

### Responses

Over the customer-started conversations in the window: `sampleSize` = how many. `repliedPct` = share
with any supplier message, counting only conversations at least 24 hours old (`matureSampleSize`).
`medianMinutes` = median of (supplier's first message - customer's first message), 1 dp.
Both are `null` when `sampleSize < 3`; `repliedPct` is also `null` while no conversation is 24 h old.
Legacy `analytics.responseRate` = `repliedPct`; `analytics.avgResponseTime` = `medianMinutes / 60` hours (1 dp).

### Profile completeness

One server calculation (`computeProfileCompleteness`) that mirrors
`public/assets/js/components/profile-health-widget.js` exactly (7 checks, weights 15/15/15/15/15/15/10).
It scores the photo-hydrated supplier, as the widget does, so an owner-avatar-only photo counts in both.
`tests/unit/supplier-profile-completeness-parity.test.js` loads the browser file and feeds both the same
fixtures; change one without the other and CI fails. `/api/me/suppliers` items also carry
`profileCompleteness` (same score). `aiScore` is an admin batch value: do not show it as a health score.

## Other endpoints

- `GET /api/supplier/analytics` and `GET /api/me/suppliers/:id/analytics?period=` apply the same window
  rule. `period` must be a whole number (else 400), is clamped to 1-90 and to the plan, and the response
  includes `window`. `analytics.responseRate`/`avgResponseTime` are `null` without a sample.
- `GET /api/supplier/reviews/stats` counts approved reviews only (`averageRating` `null` when none).
- `POST /api/v1/supplier/request-review` requires a verified email and an approved supplier:
  403 `{code:'EMAIL_NOT_VERIFIED'|'SUPPLIER_NOT_APPROVED'}`.
- Calendar reminder notifications for suppliers link to `/dashboard/supplier#availability-calendar`.
- `GET /api/v1/supplier/performance-tips` no longer contains invented statistics.

## Deliberately not provided

- **Bookings.** No route creates or reads bookings; `maxBookings` in the plan matrix is inert.
  `upcoming` is calendar entries only.
- **Lead quality, earnings, enquiry-to-booking conversion.** No data source.
- **Per-source reply rates** for quote requests and contact-form enquiries: replies to those happen
  outside the platform, so only messenger conversations have a measurable reply.
- **Unique visitors.** Views are page loads (one beacon per IP per supplier per hour, in memory).

## Known caveat

Quote requests and contact-form enquiries are stored against the supplier but the product does not show
them to the supplier or notify them. They are counted because they are real customer requests, but the
supplier cannot yet act on them in-app.
