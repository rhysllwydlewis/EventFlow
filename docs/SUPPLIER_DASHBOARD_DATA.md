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
This relies on every read passing `{ throwOnError: true }` to `db-unified`, which otherwise turns a
failed query into an empty result (tests use a double that swallows errors like the real module, so
a read that forgets the option fails them). `verification.emailVerified` is `null` if the user lookup
failed, and no email-dependent next step is locked on that guess. The same goes for the other
sources `nextSteps` reads (packages, reviews, review requests, calendar): a step whose source could
not be read is not marked undone and not offered; it is `locked` with `lockedReason` "We could not
check this just now".

## Contract

| Key                    | Shape                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window`               | `{days, maxDays, requestedDays}`                                                                  | `requestedDays` = what was asked (default 30, capped at 90). `days` = what was served: limited by the plan's `analyticsWindowDays` (Starter 7, Pro 90, Pro Plus 365 but this endpoint never serves more than 90). `maxDays` = longest this supplier can get. Every windowed number below uses `days`. A window is `days` whole UTC calendar days ending today (from 00:00 UTC of the first day), so every total equals the sum of its per-day chart buckets; the previous window is the `days` days before it. |
| `verification`         | `{emailVerified, approved, state, status, submittedAt, reviewedAt, rejectionCount, notes}`        | `emailVerified` = `users.verified` (the field every server gate checks). `approved` = `supplier.approved === true` (the enforced gate). `state` is `unverified\|pending\|approved\|rejected`; `status` is the detailed state machine value. `needs_changes`, `rejected`, `suspended` all map to `rejected`. `notes` = admin note, only for `needs_changes`/`rejected`.                                                                                                                                         |
| `profile`              | `{name, publicProfilePath, completeness:{score, checks[]}, ...}`                                  | `checks[] = {id,label,weight,done,href}`. Legacy keys kept: `hasProfile, profileCount, topProfileId, topProfileName, healthScore, isApproved, completionFlags`.                                                                                                                                                                                                                                                                                                                                                |
| `packages`             | `{total, active, paused, awaitingApproval, limit, countedTowardsLimit, draft}`                    | `active` = live (not paused, not awaiting approval). `limit` = plan `maxPackages` (`-1` unlimited). `countedTowardsLimit` = packages not paused (what create/unpause enforce). Works for unapproved suppliers. `draft` = legacy alias of `awaitingApproval`.                                                                                                                                                                                                                                                   |
| `messages`             | `{unreadMessages, conversationsWithUnread, latestAt, total, unread}`                              | From `conversations_v4`, same rule as `/api/v4/messenger/unread-count` (active conversations, minus archived/muted). `total`/`unread` are legacy (inbox conversations / conversations with unread).                                                                                                                                                                                                                                                                                                            |
| `enquiries`            | `{newThisPeriod, previousPeriod, sources:{conversations, quoteRequests, contactForm}, truncated}` | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `responses`            | `{sampleSize, matureSampleSize, repliedPct, medianMinutes}`                                       | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `views`                | `{total, days, basis:'page_loads'}`                                                               | `profile_view` events in the window. Honest label: page loads, not people.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `reviews`              | `{approvedCount, averageRating, pendingCount, total, pending}`                                    | Only `moderation.state === 'approved'` reviews are counted (same rule as the public reviews panel). `averageRating` is `null` with no rated approved review. `total`/`pending` are legacy aliases.                                                                                                                                                                                                                                                                                                             |
| `subscription`         | `{plan, status, activeUntil, cancelAtPeriodEnd, limits, tier, renewsAt, trialEndsAt}`             | From the subscription record and plan matrix. No Stripe call on this path.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `upcoming`             | `[{id, title, date, time, source}]`                                                               | Next 3 of the supplier's personal calendar entries and public events they created (`source` `personal`/`public`). Calendar entries, not bookings.                                                                                                                                                                                                                                                                                                                                                              |
| `nextSteps`            | `{steps[], completed, total, percent, primaryStepId}`                                             | `steps[] = {id,label,done,locked,lockedReason,href,priority}`. 13 milestones, independent of email preferences. `primaryStepId` = first step neither done nor locked.                                                                                                                                                                                                                                                                                                                                          |
| `analytics`, `tickets` | legacy                                                                                            | Kept for the old page; values are now honest (reply figures from the v4 collections or `null`).                                                                                                                                                                                                                                                                                                                                                                                                                |

### Enquiries

Counts three real flows in the window (and the same-length previous window):

- `conversations`: `conversations_v4` the supplier's owner is in (one supplier profile per owner is
  enforced by a unique index), created in the window, whose first message was written by a customer
  (supplier-started outreach, supplier-to-supplier and admin threads are excluded).
- `quoteRequests`: `quoteRequests` rows whose `suppliers[]` names this supplier.
- `contactForm`: `enquiries` rows (`POST /api/v1/contact-supplier`) for this supplier.

Each customer is counted once per window across all channels (by account id, else normalised email):
a signed-in customer who sends a quote request and then messages the supplier, or sends two quote
requests, is one enquiry. The channel order above decides which `sources` entry keeps it, so
`newThisPeriod` always equals the sum of `sources`. Enquiries that cannot be identified (anonymous, no
email) are all counted. Quote requests are public submissions, so anyone can name any supplier: read
the figure as "requests received".

`enquiry_sent` analytics events are **not** counted: nothing emits them and the beacon endpoint is
anonymous and spoofable. `truncated` is `true` if more than 1000 conversations had to be scanned
(counts are then lower bounds).

### Responses

Over the customer-started conversations in the window: `sampleSize` = how many. `repliedPct` = share
with any supplier message, counting only conversations at least 24 hours old (`matureSampleSize`).
`medianMinutes` = median of (supplier's first message - customer's first message), 1 dp.
`repliedPct` is `null` unless at least 3 conversations are 24 h old (`matureSampleSize >= 3`);
`medianMinutes` is `null` unless there are at least 3 replies. Neither is ever quoted from one or two threads.
Legacy `analytics.responseRate` = `repliedPct`; `analytics.avgResponseTime` = `medianMinutes / 60` hours (1 dp).

### Profile completeness

One server calculation (`computeProfileCompleteness`) that mirrors
`public/assets/js/components/profile-health-widget.js` exactly (7 checks, weights 15/15/15/15/15/15/10).
It scores the photo-hydrated supplier, as the widget does, so an owner-avatar-only photo counts in both.
`tests/unit/supplier-profile-completeness-parity.test.js` loads the browser file and feeds both the same
fixtures; change one without the other and CI fails. `/api/me/suppliers` items also carry
`profileCompleteness` (same score). `aiScore` is an admin batch value: do not show it as a health score.

## Other endpoints

- `GET /api/supplier/analytics`, `GET /api/me/suppliers/:id/analytics?period=` and the legacy
  `GET /api/supplier/analytics/legacy` apply the same plan rule (Starter 7). `period` must be a whole number
  (else 400); the two chart endpoints serve up to the plan window (Professional Plus: 365, as sold), while
  the summary caps at 90. The responses include `window`. `analytics.responseRate`/`avgResponseTime` are
  `null` without a sample.
- `GET /api/supplier/reviews/stats` counts approved reviews only (`averageRating` `null` when none).
- `POST /api/v1/supplier/request-review` requires a verified email and an approved supplier:
  403 `{code:'EMAIL_NOT_VERIFIED'|'SUPPLIER_NOT_APPROVED'}`.
- Calendar reminder notifications for suppliers link to `/dashboard/supplier#availability-calendar`.
- `GET /api/v1/supplier/performance-tips` no longer contains invented statistics.

## Enquiries, export, reviews, visits, calendar, messenger (round 1)

**Enquiries API.** `GET /api/supplier/enquiries` (list, `days`/`page`/`limit<=100`/`status`/`source`),
`GET /api/supplier/enquiries/:id` (detail with the customer's email/phone), `PATCH /api/supplier/enquiries/:id`
(`{status: new|read|handled}`) expose the quote requests and contact-form enquiries addressed to the signed-in
supplier. Approved suppliers only; a record addressed to another supplier answers like a missing one; the read/handled
state is per supplier (`supplier_enquiry_states`). Text is returned as plain text (stored HTML-escaped): render with
`textContent`. `enquiries.requests {received, new}` in the summary equals the list's `counts.total` / `counts.new`
for the same `days`. Nothing notifies suppliers of new enquiries and there is no in-app reply yet.

**CSV export.** `GET /api/supplier/enquiries/export` is the single export route (the shadowed "safe" duplicate was deleted).
It exports the supplier's customer conversations, quote requests and contact-form enquiries, spreadsheet-safe, as
`enquiries-and-conversations-YYYY-MM-DD.csv`. With nothing to export it still returns 200 with the header row and
`X-Export-Row-Count: 0`.

**Reviews.** Two writers share `reviews` (v2 service with `moderation.state`; the live public form with
`approved`/`flagged`/`comment`/`userName`). `utils/reviewShape.js` is the one adapter used by the dashboard list, the
summary, `reviews/stats` and replies, so both shapes list, count and accept replies. Only published reviews of either
shape count; pending/rejected never do. No migration is required.

**Profile visits.** One event per visit, written only by the page beacon `POST /api/analytics/track`. Not recorded for the
supplier's own session, admins, automated clients, or unknown/unapproved suppliers; the same visitor counts once per hour
(database rule using a hash, not the raw IP). `views.description` carries the exact sentence the UI may show. Events recorded
before this change were not rewritten.

**Calendar.** Public calendar publishing is hard-coded by category (`Event Planner`, `Wedding Fayre`) plus a per-supplier
admin override, enforced on create/update/delete and on publisher requests (verified email, approved supplier, publisher,
ownership). Editing can no longer publish an event that is awaiting approval. The private calendar
(`/api/me/calendar-entries`) is separate and open to every verified account. There are no bookings.

**Messenger identity.** Participants are hydrated from the live account; suppliers use their business profile photo and gain
`businessName`; `lastMessage.senderName` is the sender's current name. See `server-contract.md` for field names.

## Deliberately not provided

- **Bookings.** No route creates or reads bookings; `maxBookings` in the plan matrix is inert.
  `upcoming` is calendar entries only.
- **Lead quality, earnings, enquiry-to-booking conversion.** No data source.
- **Per-source reply rates** for quote requests and contact-form enquiries: replies to those happen
  outside the platform, so only messenger conversations have a measurable reply.
- **Unique visitors.** Views are page loads (one beacon per IP per supplier per hour, in memory).

## Cost

The summary issues about ten indexed, supplier-scoped queries plus one aggregate over first messages
(one row per conversation and sender). Quote requests are selected by `suppliers.supplierId` and projected to
`createdAt, userId, email` in the database; no other customer's request is read. Engagement results are reused
for 30 seconds per (supplier, window) so the several widgets of one page load do not recompute them.

## Known caveat

Quote requests and contact-form enquiries are stored against the supplier but the product does not show
them to the supplier or notify them. They are counted because they are real customer requests, but the
supplier cannot yet act on them in-app.
