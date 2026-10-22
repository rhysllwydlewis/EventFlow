# Supplier dashboard: what is left

This file used to list about a hundred things that were not done, not verified or left alone after the
dashboard redesign (rhysllwydlewis/EventFlow#1819). **Everything that can be done in the code has been done, or
decided with a reason.** What is left below needs a person with access that the code and its tests cannot
have: production data, a payment account, real devices, a lawyer, the hosting dashboard.

Ids (`B-…`, `K-…` and so on) are the original ones, so older notes still point somewhere.

## 1. Needs you

| Id       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why it is not done here                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-2, P-4 | **Run the price repair against production, as a dry run first.** `npm run repair:package-prices` lists every package whose two price fields disagree. For each conflict choose `--prefer=shown` (what customers see now) or `--prefer=price` (what the supplier last typed), then run with `--apply`. Do it once the code is deployed, so no new package is written one-sided.                                                                                                                                          | It needs the production database, and the right answer for a conflict is a judgement about that supplier's data.                                                             |
| V-1      | **Run the billing screens against a Stripe test-mode account.** The webhook lifecycle (checkout, failed payment, recovery, cancellation, end of subscription, a repeated event) is tested with Stripe-shaped events in a real database. Still to do by hand: the billing portal button, proration text, monthly/annual switch, a coupon, and a card that needs authentication.                                                                                                                                          | It needs a Stripe account's test keys; the sandbox has none.                                                                                                                 |
| V-2, V-4 | **After the deploy, look at production once.** Indexes for the enquiry queries are created at start-up (the first start builds `suppliers.supplierId` on `quoteRequests`, which takes longer on a large collection). Check the 7-day asset cache and the `?v=` busting through the CDN, compression and HSTS headers on the live site, and the slowest dashboard queries.                                                                                                                                               | Everything was tested against thousands of local records and the production Content-Security-Policy; the CDN, the proxy and production data volume only exist in production. |
| V-6      | **Try the dashboard on real devices:** an iPhone and iPad (Safari `<dialog>` sheets, `100dvh`, the keyboard), a real Android phone, Samsung Internet, Edge and an older browser.                                                                                                                                                                                                                                                                                                                                        | The suite runs Chromium, Firefox and WebKit engines, with phone-sized screens, but not physical devices.                                                                     |
| V-7      | **A screen-reader and keyboard pass by a person:** VoiceOver, NVDA, TalkBack, speech input. Focus order, announcements in the dialogs, the guide, the enquiries drawer and the live unread count.                                                                                                                                                                                                                                                                                                                       | Automated checks (axe: zero violations on approved and pending suppliers at desktop and phone, in CI) find rules, not whether it is understandable.                          |
| C-6      | **Privacy policy §7.4 and the processor table.** They say a supplier's or venue's postcode may go to Postcodes.io. The distance search also sends the postcode a visitor types. It goes from our server only (the visitor's address and browser are not sent, nothing identifies them), and the map no longer keeps it. The wording should say so, and `POLICY_PRIVACY_VERSION` should move.                                                                                                                            | It is a legal document with a version and an effective date; the wording is for you or your adviser to approve.                                                              |
| C-1      | **Read the open items in the repository's Security tab (Code scanning).** The CodeQL check passes on this change. One warning remains by design: `utils/postmark.js` writes a copy of an email to the local `outbox/` folder when no mail provider is configured (a development fallback, never served), and CodeQL flags that the text now includes what a supplier typed in an enquiry reply. Dismiss it there, or ask for the fallback to be removed. Redirect handling rebuilds the address from a fixed allowlist. | The integration used here cannot list code-scanning alerts.                                                                                                                  |
| E-1..E-4 | **The Railway preview environment.** Re-authorise the Railway connector, then: find out why previews stopped following the branch (the last deployment was an old commit); give previews Stripe test keys and a sandboxed mail transport (the preview reported live Stripe and real email); say where the preview database lives; seed a supplier account that reviewers can use.                                                                                                                                       | The connector needs signing in again, and changing a deployment's source can affect every environment, including production.                                                 |

## 2. Decided, and why

These were questions rather than defects. Each has an answer; say if you want a different one.

| Id       | Decision                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-2      | **Public-calendar publishing stays "supplier category, unless an admin overrides it for that supplier".** The per-supplier override already is the entitlement flag. A plan-based gate would take the feature away from some suppliers, which is a pricing decision.                                                            |
| K-5      | **The enquiry-quality badge, reasons and filter are back** (from the existing lead scoring, worked out when read, shown as an estimate). **The reply-time distribution chart is not**: the dashboard shows the reply rate and median reply time, and a distribution would need every reply timed and stored.                    |
| K-8      | **A price stays free text** ("From £450", "£25 pp"), because that is how suppliers think of it. The number in it is read by one parser (`parsePriceAmount`, shared by the browser and the server), and price filtering and sorting use that number. A stored amount/currency/unit would need every supplier to re-enter prices. |
| K-9      | Plan limits on windows and package counts come from the server's plan config and the page reflects them; the explanatory text is generated from the limits, so there is nothing to keep in step.                                                                                                                                |
| C-2      | The visitor's own planning data (plan list, start choices) is kept because they asked for it. The two interface flags for the welcome card are only remembered with functional consent.                                                                                                                                         |
| S-2      | The messenger widget polls whatever happens to the live connection, so updates never stop; a "live updates off" label would only add noise.                                                                                                                                                                                     |
| S-3      | The dashboard only follows links on this site (or Stripe's hosted pages for billing). A supplier's own website link is shown as a link they can open; the dashboard never navigates the page to an address it was handed.                                                                                                       |
| T-4, T-9 | Browser files that are not modules are tested by cutting the function out of the source (`app.js`'s redirect code, the cookie-choice helper). Moving the redirect allowlist out of `app.js` would mean a new script tag on every page that loads `app.js`; the helper throws a clear error if the markers move, so it was left. |
| R-1, R-3 | Review of the whole repository and of every older test was not part of this work. What was reviewed: every file the dashboard uses, the security review of the routes it calls, the price and messenger code paths, and the dashboard stylesheet.                                                                               |

## 3. Done

Fixed or built in rhysllwydlewis/EventFlow#1822 (merged): L-1, L-2, L-3, K-4, T-2, T-3, C-3, C-4, enquiry
notifications, the first thirty-three dashboard journeys, the Stripe/same-site URL allowlist for billing buttons.

Done in the follow-up that cleared this file (rhysllwydlewis/EventFlow#1825):

- **Features:** K-1 reply to an enquiry from the drawer (email from EventFlow, the owner's verified address as
  Reply-To; 3 per enquiry, 10 an hour, 30 a day; enquiries under 30 days old). K-3 a supplier who is not approved
  can see their own packages, read-only. K-5 enquiry quality. K-6 setup-guide progress kept on the account
  (`/api/supplier/guide-progress`). K-7 visits also show about how many different visitors.
- **Price:** P-1 one shared reader (`public/assets/js/utils/package-price.js`), P-2 every place mapped, P-3 every
  writer now stores both fields (seed, founding-supplier seed, bot parity, package service, debug script), P-6 two
  guard tests (a server file that writes packages with a `price` must use `priceFields`; a browser file must read
  `price_display` before `price`). Package search filtered and sorted by price text as if it were a number; fixed.
  L-4 hardened.
- **Security review of the routes the dashboard calls (R-5):** a free upgrade to a paid plan for an account with no
  Stripe subscription; photo deletion by address; mail caps for review requests; ticket sender taken from the
  session; markup in the public package page. R-6: `npm audit --omit=dev` reports zero vulnerabilities.
- **Messenger and live updates (L-5, L-6, V-3, V-11):** the full-page messenger ignored the event that tells it
  about messages in other conversations; edit/delete/reaction events lacked the conversation id; read receipts
  did not reach the reader's other tabs; routes that push notifications read a WebSocket key nothing sets. Two
  app instances share events through Redis (tested); reconnect after a restart, expired tokens and long-polling
  only are tested.
- **Real database (V-2, V-12, V-1):** indexes for the enquiry queries (there was none for the quote requests'
  `suppliers.supplierId`), atomic status writes (a double click or two people used to make duplicate status
  documents), a test with thousands of records that checks the plans use indexes, and the subscription lifecycle
  from Stripe events.
- **Browser (V-8, V-9, V-10, V-13, V-14, V-15, V-16, B-5, B-6, T-1, T-7, T-8):** the layout and accessibility
  journeys (axe, widths from 320 to 1920 px, 200% text, forced colours, reduced motion, dark scheme, right to left,
  long and emoji names, a profile at its photo limit, other time zones, a dropped connection, no Content-Security-
  Policy violation), a layout-shift and size budget (the page used to jump 0.26 on desktop and 0.49 on a phone; now
  0.02 and 0.07), the dashboard refreshing when a long-open tab is returned to, customer and supplier messages
  arriving live in both directions, the admin packages page, the verification email's link, and the dashboard
  journeys also run in Firefox and WebKit in CI.
- **Privacy and housekeeping (C-2, C-5, S-1, S-4, S-5, S-6, T-5, T-6, R-2, R-4):** welcome-card flags only with
  consent; leftover setup-guide records are erased at start when consent is not given; the chart is tested at 7, 30
  and 90 days; the guide says when a step may be missing; how to run everything locally is in
  `docs/RUNNING_THE_BROWSER_TESTS_LOCALLY.md`; 196 tests that could never run (they described deleted code) were
  removed; eight unused style rules were removed.
- **B-1, B-3, B-4, B-5, B-6, B-7, B-8:** B-4 no public page was deleted by #1819 (only its stylesheets and
  scripts), so nothing outside the repository can point at a missing page; the others are the checks above.
