# Supplier dashboard home

`public/dashboard-supplier.html`, served at `/dashboard/supplier`.

The page is one calm column of cards on a warm neutral background with a single
teal accent, built the same way as the customer dashboard (see
`CUSTOMER_DASHBOARD_HOME.md`). It replaces a page that loaded eleven
stylesheets and several script layers that re-patched the DOM after render,
showed the same facts (completeness, plan, packages, unread messages) in two or
three places, and drew numbers the server never sent.

The data contract is in `SUPPLIER_DASHBOARD_DATA.md`. This file is about the page.
Everything not done, not verified or left alone is listed in `SUPPLIER_DASHBOARD_BACKLOG.md`.

## Structure

Top to bottom. Each section appears once.

| Section                               | Where it comes from                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Email verification banner (if needed) | `supplier-dashboard-home.js`, with "Resend email"                                                              |
| Greeting, one `<h1>`, primary action  | `#welcome-heading`, `#sdh-lede`, `#sdh-next-action`; "Setup guide" link under the greeting                     |
| Verification strip (only if relevant) | `#verification-status-banner`, `dashboard-supplier-verification.js` for the form                               |
| Summary row                           | `GET /api/supplier/dashboard-summary`; tiles with no data are left out; "More numbers" folds on a phone        |
| Next steps (one merged card)          | the summary's `nextSteps`; finished steps in a real `<details>`                                                |
| Your profile                          | `app.js` (`#my-suppliers`); editing is a dialog (below)                                                        |
| Your packages                         | `app.js` (`#my-packages`); create and edit are a dialog; the first five (three on a phone) show, the rest fold |
| Enquiries                             | `supplier-dashboard-enquiries.js`: a card with the latest, and a drawer with the list and detail               |
| Reviews and Request a review          | `supplier-reviews-init.js`; the dialog, copy-link and request history are in `supplier-dashboard-home.js`      |
| Calendar                              | `dashboard-supplier-calendar.js` (FullCalendar), week list under 640px                                         |
| Messages (side column)                | `MessengerWidgetV4` with search, filter and sort over the latest 20 conversations                              |
| Availability                          | `/api/v1/supplier/availability`                                                                                |
| Profile visits                        | the summary: 7 / 30 / 90-day buttons, visits and enquiries per day, "From visit to reply"                      |
| Tips (hidden if there are none)       | `/api/v1/supplier/performance-tips`, each tip's action wired to the real editor or page                        |
| Plan                                  | the summary's `subscription` plus the subscription record for billing facts                                    |
| Support                               | `supplier-tickets.js`                                                                                          |

Under 1024px the two columns become one. Under 768px the visits, availability,
calendar, tips, plan and support cards fold their content into a closed `<details>`
("Show plan") so the page stays short; wider screens never fold. On a phone the only
navigation is the site header and the existing bottom nav.

## Dialogs over the dashboard

The page keeps its place and opens work in native `<dialog>`s: a card-sized modal on
desktop, a bottom sheet (or side drawer for enquiries) on a phone. Focus moves in, is
kept in and returns to the opener; the page behind does not scroll; Escape works even
when focus is not inside (handled on the document).

- **Profile and package editors** (`supplier-dashboard-overlays.js`): save closes with a
  toast, errors and validation stay inside the dialog (inline status, `aria-invalid`,
  focus on the first field to fix), a second submit while one is in flight is ignored,
  and an **unsaved-changes guard** asks before Cancel, the close button, Escape or leaving
  the page throws away edits. A close the browser does by itself with edits puts the
  editor back. Closing resets the form (`sdh:overlay-closed`), and opening refills it
  from the saved profile, so a cancelled form never comes back blank and never saves as a
  new profile.
- **Banner image** is a field in Edit profile (`supplier-dashboard-banner.js`): upload
  (JPG, PNG or WebP, 5 MB) and remove, saved as soon as they succeed. The Next steps card
  calls it "Add banner" and opens the editor on it; it is never the headline button.
- **Verification**, **Request a review** (with a copy-profile-link field), **Ask to
  publish public events**, the confirmation and the **setup guide** are dialogs too.
- **Enquiries drawer** (`supplier-dashboard-enquiries.js`): list with status and source
  filters and "Show more", detail with the customer's contact details, Mark read /
  handled / new. Customer text is put on the page with `textContent` only. States:
  loading, empty, error with Try again, and "opens once your profile has been approved".
  Suppliers are not emailed when an enquiry arrives and cannot reply here; the page says so.
- **Toasts** are shown in the browser's top layer (`popover`) so a dialog cannot hide them.

## First-visit setup guide

`supplier-dashboard-onboarding.js`: for a supplier with no profile (or a profile with no
package, not approved and no reviews) a short dialog introduces the dashboard, then
prompts for what gets a listing live. "Step 2 of 5", progress bar, Back / Next / Skip,
keyboard and screen reader friendly (focus on the step heading, a native dialog).

- Every step after the first is built from the same `nextSteps` the Next steps card shows,
  uses that step's label and does what its button does; finished steps are left out; a
  locked or waiting step says why instead of offering a button. It cannot contradict the card.
- Progress (`active` / `dismissed` / `completed` and the step) is kept in `localStorage`,
  keyed by user id (`ef.supplierGuide.v1.<id>`). No server field exists for it, so there is
  no server copy; blocked storage is tolerated. Because it is a convenience rather than
  something the site needs, it is only written when cookie consent allows functional storage;
  without consent the guide still works for the visit, and saved progress is erased if
  consent is withdrawn.
- It does not come back by itself after being skipped or finished. The "Setup guide" link
  under the greeting reopens it at the step it was left on.

## Supplier with no profile yet

The summary answers 404 and the page does not ask for it (the site's fetch wrapper would
show a 404 as an error toast): it waits for `app.js` to report the supplier list
(`sdh:suppliers`) and skips the summary, availability, tips and review-request requests if
the list is empty. Only the profile, calendar (the private calendar needs no profile), plan
and support cards show (`body.sdh-no-profile`). Until the first load finishes the cards
keep their loading placeholders: nothing says "could not load" before a request has failed.

## Supplier waiting for approval

The server only lets an approved supplier read packages and enquiries. The page knows this from
the profile list, so it does not ask for packages at all until the profile is approved (the
packages card says "Packages unlock after approval") and says the same for enquiries; nothing
is requested that the server would refuse, so a pending supplier's console stays clean. The
"Create package" button says why it is off ("Profile pending approval", or "Profile setup needed"
with no profile) instead of opening a form that can only fail.

## Honest numbers

Nothing on the page is computed from guesses.

- **Profile visits** are page loads (`views.basis === 'page_loads'`); the footnote is the
  server's own `views.description`. The 7 / 30 / 90-day buttons ask the server for that
  window; periods beyond the plan's `maxDays` are off, with the reason.
- **Enquiries** are the summary's `enquiries` (de-duplicated across channels) with a trend
  against the period before, said in words ("Up 250% on the 30 days before.", "None in the
  30 days before.") and nothing when the earlier figure is unknown. "From visit to reply" lists
  page loads, enquiries and the reply rate side by side and says it is not a conversion rate.
- **Reply rate and reply time** appear only when the server reports enough conversations.
- **Rating** is the approved average; with none the card says "No reviews yet", not 0.0.
- **Packages** show `countedTowardsLimit` of `limit`; the price is what the supplier typed.
  Every writer stores it in both `price` and `price_display` (`utils/packagePrice.js`) and
  every reader goes through `packagePriceText`; `npm run repair:package-prices` (dry run by
  default) fixes older packages where the two fields differ.
- **Plan card**: the plan, status, the end-of-period sentence (renews, downgrades to X, or
  cancels, from the subscription record), billing interval, trial end and days left, start
  date, next payment, card on file, discount, and the entitlements the plan really has. A
  failed payment shows the plan the supplier pays for with the failed payment and a billing
  button, never "Starter".
- Unread messages follow the messenger's live count, which the widget updates over Socket.IO
  as soon as a customer writes; the lead-quality badges are hidden (the
  server sends no score).

## How the scripts fit together

`supplier-dashboard-home.js` is loaded before `app.js`. They talk through events and one
global, never by patching each other's DOM.

- `app.js` fires `sdh:suppliers` (the supplier list, or `{failed: true}`) and `sdh:changed`
  (after a profile or package is saved, deleted, paused or a banner changes); the home script
  refreshes the summary and fires `sdh:rendered` after each draw.
- `window.SupplierDashboardHome` offers `getSummary()`, `getContext()`, `getJson()`,
  `sendJson()` (CSRF token fetched and retried once), `confirm()` and `toast()`, plus the pure
  helpers the tests use. Package delete and pause go through it.
- Escaping: `esc()` (home) and `escapeAttr()` (`app.js`) also turn quotes into entities, so any
  value is safe in an attribute; links are validated with `localHref()` (parsed, same-site paths
  and fragments only), not a pattern.
- Showing and hiding uses the `hidden` attribute, never inline `display`.

## Stylesheet

`public/assets/css/supplier-dashboard-home.css` is the only stylesheet written for this page,
scoped to `.sdh-page` (the class on `<body>`) with tokens `--sdh-*` (ink `#17202f`, muted
`#566176`, accent `#0b8073`, hairline `#e8e5de`), the same values as the customer dashboard.

- Type sizes stay on the site scale (10 11 12 13 14 16 18 20 24 28 32).
- No gradients, glass, blur, emoji or colour tiles; no pill radii. The calendar keeps to one
  accent: private entries are solid, public events dashed, saved ones dotted.
- Small icon buttons that carry `.ef-cta` reset its padding.
- `[hidden]` is enforced, focus rings are visible, motion stops under `prefers-reduced-motion`,
  every control is 44px tall on touch screens, and anchor jumps clear the fixed header.

## What was removed

Stylesheets (all deleted, none loaded by another page): `supplier-dashboard-aesthetic-refresh`,
`-liquid-glass`, `-v3-polish`, `-visual-refresh`, `supplier-utils`, `profile-health`,
`dashboard-overhaul`, `dashboard-animations`, `card-collapse`, `liquid-glass-mobile`,
`messaging-glass-enhancements`. `supplier-dashboard-improvements.css` is **kept**: other pages use it.

Scripts (all deleted): `dashboard-supplier-overhaul`, `-module`, `-inline`, `-actions`, `-auth`,
`-breadcrumb`, `-threads`, `-websocket`, `supplier-dashboard-enhancements`, `supplier-analytics-chart`,
`liquid-glass-engine`, `card-collapse`, `supplier/js/feature-access.js`.

Content removed on purpose: the health ring and setup checklist, the injected Onboarding card, a
second copy of next steps, the profile-completeness widget, the earnings tile, the lead-quality
overview card and badges (no score from the server; the client heuristic is not shown as if it were
data), the mobile "nav pills", every accordion, confirm()/alert()/prompt(), the "3x more enquiries"
upsell claim, the live "+1" counters (nothing on the server emitted those events), and the
response-time distribution chart (no honest source: the typical reply time is shown instead).

## Tests

- `supplier-dashboard-home.test.js`: stylesheet scoping and scale, page structure, honest-metric
  rules, the pure functions, and the whole page rendered in jsdom.
- `supplier-dashboard-overlays.test.js`, `-onboarding.test.js`, `-enquiries.test.js`,
  `-parity.test.js`, `-package-actions.test.js`, `-review-fixes.test.js`, `-visual-fixes.test.js`,
  `-mobile-length.test.js`, `-calendar-wording.test.js`: the dialogs, the guide, enquiries and export,
  the restored capabilities, package actions with errors, escaping and links, and the visual fixes.
  The jsdom scenarios live in `tests/helpers/` (a child process: jsdom's dependencies are ES modules).
- `e2e/supplier-dashboard-improvements.spec.js` and `e2e/dashboard-mobile-ui-fixes.spec.js` follow the
  new markup.

## Things left alone

- `supplier-dashboard-improvements.css` (used elsewhere), `dashboard-guard.js`, the site header and
  footer, and the server routes (the page only reads what the server sends).
