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
| `views`                | `{total, uniqueVisitors, days, basis:'page_loads'}`                                               | `profile_view` events in the window. Honest label: page loads, not people. `uniqueVisitors` is how many different anonymous visitor keys (a hash, not an address) those loads came from: about how many browsers or signed-in people, `null` when it could not be read.                                                                                                                                                                                                                                        |
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

- `GET /api/supplier/analytics` and `GET /api/me/suppliers/:id/analytics?period=` apply the same plan rule
  (Starter 7). The old `GET /api/supplier/analytics/legacy` was removed: nothing called it. `period` must be a whole number
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
for the same `days`. Suppliers are notified when an enquiry arrives (`services/supplierEnquiryNotifier.js`).

**Reply.** `POST /api/supplier/enquiries/:id/reply` with `{message}` (up to 2000 characters) emails the customer from
EventFlow, with the owner's verified account address as Reply-To, and marks the enquiry handled. Refused with
`code` `EMPTY`/`TOO_LONG` (400), `NO_EMAIL` (422, the customer left no address), `EMAIL_NOT_VERIFIED` (403),
`ENQUIRY_TOO_OLD` (422, older than 30 days), `ENQUIRY_LIMIT`/`HOURLY_LIMIT`/`DAILY_LIMIT` (429: 3 per enquiry, 10 an
hour and 30 a day per supplier) or `SEND_FAILED` (502). A place is reserved in `supplier_enquiry_replies` before
sending and the limits are checked again, so overlapping requests cannot pass them; a failed send gives the place back.
Once the email has gone nothing can turn the reply into a failure: if marking the enquiry handled does not save, the
route still answers `{success: true, enquiry, warning}` (the enquiry keeps its old status) and the dashboard shows the
warning, so the supplier does not send it twice.
`GET /api/supplier/enquiries/:id` includes the sent `replies` and an estimated `quality` (`rating`, `score`, `reasons`,
from `utils/leadScoring.js`, worked out when read, never stored); the list takes `quality=High|Medium|Low` and
returns `counts.byQuality`.

**Setup guide progress.** `GET`/`PUT /api/supplier/guide-progress` (`{status: active|dismissed|completed, step}`) keep
where the supplier is in the first-visit guide on their account (`users.onboarding.supplierGuide`), so it follows them
to another device.

**CSV export.** `GET /api/supplier/enquiries/export` is the single export route (the shadowed "safe" duplicate was deleted).
It exports the supplier's customer conversations, quote requests and contact-form enquiries, spreadsheet-safe, as
`enquiries-and-conversations-YYYY-MM-DD.csv`. With nothing to export it still returns 200 with the header row and
`X-Export-Row-Count: 0`. Conversations the supplier deleted from their inbox (`participants.isDeleted` for their
own participant) are not exported. Each source keeps its newest 1000 rows; when more existed the response has
`X-Export-Truncated: true`, the file ends with a `Notice` row saying so (not counted in `X-Export-Row-Count`) and the
dashboard tells the supplier. Otherwise `X-Export-Truncated: false`.

**Reviews.** Two writers share `reviews` (v2 service with `moderation.state`; the live public form with
`approved`/`flagged`/`comment`/`userName`). `utils/reviewShape.js` is the one adapter used by the dashboard list, the
summary, `reviews/stats` and replies, so both shapes list, count and accept replies. Only published reviews of either
shape count; pending/rejected never do. No migration is required.

**Profile visits.** One event per visit, written only by the page beacon `POST /api/analytics/track`. Not recorded for the
supplier's own session, admins, automated clients, or unknown/unapproved suppliers; the same visitor counts once per hour.
"The same visitor" is the signed-in account, or an HMAC-SHA256 (under a server secret, `PROFILE_VIEW_SALT` or else
`JWT_SECRET`) of the address and the browser family (browser/OS, not the full User-Agent string, so changing the version
or rotating strings does not make a new visitor); an IPv6 address counts as its /64 prefix. The raw IP is never stored,
and the stored visitor key cannot be reversed by trying every address. If no secret is configured, anonymous views are not
counted. The rule is enforced by the database: each view carries a `dedupeKey` (supplier, visitor, clock hour) with a
unique index, so two beacons at once count once. A second cap bounds one network address to 20 counted views per
supplier per hour (`PROFILE_VIEW_IP_CAP`; changing it is an environment change and needs a restart), which means a very
busy shared address (an office, a mobile carrier) can undercount. The cap applies to anonymous visitors only. It is kept
in a separate collection, `profile_view_caps`: one row per supplier, keyed address hash and hour, incremented atomically,
with no address in it and a TTL index that removes it within about two hours. Nothing derived from the address is stored
on the event itself. Both depend on `req.ip` being the real client address, which depends on the deployment's trust-proxy
setting (behind a CDN that does not forward the client address, many visitors would share one key). A signed-in
visitor's events carry their `userId` and are deleted with the account. `views.description` carries the exact sentence the UI may show. Events recorded
before this change were not rewritten.

**Calendar.** Public calendar publishing is hard-coded by category (`Event Planner`, `Wedding Fayre`) plus a per-supplier
admin override, enforced on create/update/delete and on publisher requests (verified email, approved supplier, publisher,
ownership). Editing can no longer publish an event that is awaiting approval. The private calendar
(`/api/me/calendar-entries`) is separate and open to every verified account. There are no bookings.

**Tips.** `GET /api/v1/supplier/performance-tips` returns up to three ranked tips (`services/supplierTips.js`) derived from
the supplier's real state: account status (email, verification, approval, suspension), category (category-specific
package, description and photo advice), plan limits actually reached (packages, photos), profile gaps, unhandled
enquiries, unanswered conversations and reviews, packages without a photo or awaiting approval. Each tip is
`{id, priority, category, icon, title, body, action:{type, label, href, field?, data?}}`; tips contain no statistics or
promises, and a tip whose data does not exist is not produced. The dashboard maps each `action.type` to a page action
(open the profile editor on `field`, the package form, Request a review, scroll to a card) or a link. There is no
availability tip or card: `suppliers.availability` was never shown to customers, so the Availability card and its
`/availability` endpoints were removed. The description tip measures the same text as the completeness check
(`getSupplierDescriptionText`: description_long, description_short, description, then the admin-set `blurb`; the
public About section shows the first three only). `responses.unanswered` (summary) counts customer conversations over
a day old with no reply.

**Messenger identity.** Participants are hydrated from the live account; suppliers use their business profile photo and gain
`businessName`; `lastMessage.senderName` is the sender's current name. See `server-contract.md` for field names.

## Deliberately not provided

- **Bookings.** No route creates or reads bookings; `maxBookings` in the plan matrix is inert.
  `upcoming` is calendar entries only.
- **Earnings and enquiry-to-booking conversion.** No data source. (Per-enquiry quality exists, as an estimate.)
- **Per-source reply rates** for quote requests and contact-form enquiries: replies to those happen
  outside the platform, so only messenger conversations have a measurable reply.
- **An exact count of people.** `views.total` is page loads (one beacon per visitor key per supplier per hour).
  `views.uniqueVisitors` counts the distinct anonymous visitor keys in the window (about how many different browsers or
  signed-in people), `null` when it could not be read.

## Cost

The summary issues about ten indexed, supplier-scoped queries plus one aggregate over first messages
(one row per conversation and sender). Quote requests are selected by `suppliers.supplierId` and projected to
`createdAt, userId, email` in the database; no other customer's request is read. Engagement results are reused
for 30 seconds per (supplier, window) so the several widgets of one page load do not recompute them.

## Writes that fail

`db-unified`'s `updateOne`/`deleteOne`/`insertOne`/`read` swallow errors by default (`false`/`null`/empty), and `false`
from `updateOne` also means "matched but nothing changed". A route that must not report a failed write as a success
passes `{ throwOnError: true }`, so a thrown error becomes a 500 while "no change" stays a 200. Package edit, delete,
pause and resume, setup-guide progress, trial activation and verification submit do this; so do the package ownership
lookups and the public-calendar publisher/approval reads (which fail closed: an unreadable approval setting means an event
waits for review). The dashboard already shows the server's reason for a refused package action. The setup guide's
progress save is best effort by design (the browser keeps a copy), so a failed account save is not shown as an error.

## Availability

The dashboard no longer has an Availability card and `/api/v1/supplier/availability` was removed: nothing a customer sees
(public profile, search, SEO, quote flow) reads `suppliers.availability`, so the control changed nothing. Stored values
are left in place. Wiring it honestly would need the public profile, the supplier API, search and the structured data
to agree, which is a product decision, so it was deleted instead. The Calendar card (`#availability-calendar`) is a
different, working feature.

## Completeness 'description'

The checklist measures the first non-empty of `description_long`, `description_short`, `description`, then the legacy
`blurb` (`getSupplierDescriptionText`), and wants 100 characters. The public About section shows the first non-empty of
the first three, so the check measures what the page shows except for `blurb`: only an admin can set it, it counts
because the browser widget (`profile-health-widget.js`, kept in step by a parity test) counts it, and the About section
does not display it. Removing `blurb` from both would make the two agree exactly.

## Known caveat

Customers' enquiries reach the supplier in the dashboard: the Enquiries card and drawer list them (status, quality,
detail with the contact details the customer left), the supplier is notified when one arrives, can reply by email from
the drawer, and can export them. What is still missing is any channel other than email for replying to a quote request or
contact-form enquiry, so the reply rate and reply time cover messenger conversations only.
