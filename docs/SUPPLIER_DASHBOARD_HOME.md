# Supplier dashboard home

`public/dashboard-supplier.html`, served at `/dashboard/supplier`.

The page is one calm column of cards on a warm neutral background with a single
teal accent, built the same way as the customer dashboard (see
`CUSTOMER_DASHBOARD_HOME.md`). It replaces a page that loaded eleven
stylesheets and several script layers that re-patched the DOM after render,
showed the same facts (completeness, plan, packages, unread messages) in two or
three places, and drew numbers the server never sent.

The data contract is in `SUPPLIER_DASHBOARD_DATA.md`. This file is about the page.

## Structure

Top to bottom. Each section appears once.

| Section                               | Where it comes from                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Email verification banner (if needed) | `supplier-dashboard-home.js`, with "Send again"                                        |
| Greeting, one `<h1>`, primary action  | `#welcome-heading`, `#sdh-lede`, `#sdh-next-action` (`supplier-dashboard-home.js`)     |
| Verification strip (only if relevant) | `#verification-status-banner`, `dashboard-supplier-verification.js` for the form       |
| Summary row                           | `GET /api/supplier/dashboard-summary`; tiles with no data are left out                 |
| Next steps (one merged card)          | the summary's `nextSteps`; finished steps in a real `<details>` ("3 completed")        |
| Your profile (view, edit form)        | `app.js` (`#my-suppliers`, `#supplier-form`), `/api/me/suppliers`                      |
| Your packages (list, form)            | `app.js` (`#my-packages`, `#package-form`), `/api/me/packages`                         |
| Reviews and Request a review          | `supplier-reviews-init.js`; the dialog and history are in `supplier-dashboard-home.js` |
| Calendar                              | `dashboard-supplier-calendar.js` (FullCalendar), week list under 640px                 |
| Messages (side column)                | `MessengerWidgetV4` (its heading is hidden; the card supplies it)                      |
| Availability                          | `/api/v1/supplier/availability`                                                        |
| Profile visits                        | the summary's `analytics.dailyData`, drawn as bars with a plain-text summary           |
| Tips (hidden if there are none)       | `/api/v1/supplier/performance-tips`                                                    |
| Plan                                  | the summary's `subscription` (limits come from the plan, never hard-coded)             |
| Support                               | `supplier-tickets.js`                                                                  |

Under 1024px the two columns become one: next steps, profile, packages, reviews,
calendar, messages, availability, visits, tips, plan, support. On a phone the only
navigation is the site header and the existing bottom nav.

### Supplier with no profile yet

The summary answers 404. The page does not ask for it (the site's fetch wrapper
would show a 404 as an error toast): it waits for `app.js` to report the supplier
list (`sdh:suppliers`) and skips the summary request if the list is empty. Only the
profile, plan and support cards show (`body.sdh-no-profile`, cards marked
`data-needs-profile` are hidden), with one action: Create your profile. If the
summary request fails for any other reason the page says so and offers a retry;
it never shows an empty dashboard.

## Honest numbers

Nothing on the page is computed from guesses.

- **Profile visits** are page loads (`views.basis === 'page_loads'`) and say so.
  There is no "conversion" or "enquiry rate": quote requests and contact-form
  records are not visible to suppliers anywhere yet, so the page does not show
  `enquiries.*`.
- **Reply rate and reply time** appear only when the server reports
  `responses.sampleSize >= 3`. Below that the tile is left out, not zero.
- **Rating** is `reviews.averageRating` over approved reviews; with none the card
  says "No reviews yet", not 0.0.
- **Packages** show `countedTowardsLimit` of `limit` (`-1` means unlimited and
  reads "Unlimited").
- A short plan window (Starter keeps 7 days) is labelled with the days actually
  served.
- Unread messages come from the summary; the messenger widget no longer
  broadcasts its own (under-counted, five conversations) number.
- The messenger's "Lead quality" badges are hidden: the score has no data behind it.

## How the scripts fit together

`supplier-dashboard-home.js` is loaded before `app.js`. They talk through events
and one global, never by patching each other's DOM.

- `app.js` fires `sdh:suppliers` (the supplier list, once loaded) and `sdh:changed`
  (after a profile or package is saved, deleted or paused); the home script
  refreshes the summary.
- `window.SupplierDashboardHome` offers `getSummary()`, `getPackageAllowance()`,
  `getPlanLimits()`, `refresh()`, `confirm()` and `toast()`. `app.js` asks it for the
  package limit instead of making its own subscription requests.
- One toast system (`.sdh-toast`); `Toast`, `EFToast` and `showToast` are shims on it.
- Destructive actions use one native `<dialog>` confirmation; verification, Request a
  review and the confirmation are all native dialogs (focus moves in, stays in and
  returns to the button that opened them; bottom sheets on phones).
- Showing and hiding uses the `hidden` attribute, never inline `display`.
- A request for a review can be refused with `EMAIL_NOT_VERIFIED` or
  `SUPPLIER_NOT_APPROVED`; the dialog says which, in plain words.

## Stylesheet

`public/assets/css/supplier-dashboard-home.css` is the only stylesheet written for
this page, scoped to `.sdh-page` (the class on `<body>`) with tokens `--sdh-*`
(ink `#17202f`, muted `#566176`, accent `#0b8073`, hairline `#e8e5de`), the same
values as the customer dashboard.

- Type sizes stay on the site scale (10 11 12 13 14 16 18 20 24 28 32).
- No gradients, glass, blur, emoji or colour tiles; no pill radii.
- Small icon buttons that carry `.ef-cta` reset its padding.
- `[hidden]` is enforced, focus rings are visible, motion stops under
  `prefers-reduced-motion`, and every control is 44px tall on touch screens.
- `tests/unit/supplier-dashboard-home.test.js` fails on any unscoped selector.

## What was removed

Stylesheets (all deleted, none loaded by another page): `supplier-dashboard-aesthetic-refresh`,
`-liquid-glass`, `-v3-polish`, `-visual-refresh`, `supplier-utils`, `profile-health`,
`dashboard-overhaul`, `dashboard-animations`, `card-collapse`, `liquid-glass-mobile`,
`messaging-glass-enhancements`. `supplier-dashboard-improvements.css` is **kept**: other pages use it.

Scripts (all deleted): `dashboard-supplier-overhaul`, `-module`, `-inline`, `-actions`,
`-auth`, `-breadcrumb`, `-threads`, `-websocket`, `supplier-dashboard-enhancements`,
`supplier-analytics-chart`, `liquid-glass-engine`, `card-collapse`,
`supplier/js/feature-access.js`.

Content: the health ring and setup checklist, the injected Onboarding card, a second
copy of next steps, the profile-completeness widget, the earnings and conversion
tiles, lead-quality and funnel widgets, the conversation search/filter/sort boxes
(they only saw five conversations), the mobile "nav pills", every accordion, and the
confirm()/alert() prompts.

With the same data the desktop page went from about 11,900px to about 4,600px tall; a
supplier with no profile from about 8,900px to about 1,550px.

## Tests

- `tests/unit/supplier-dashboard-home.test.js`: stylesheet scoping and scale, page
  structure, honest-metric rules, the pure functions, and the whole page rendered in
  jsdom (`tests/helpers/supplier-dashboard-home-scenario.js`, a child process because jsdom's
  dependencies are ES modules) for approved, in-review, rejected, unverified-email,
  no-profile and failed-summary suppliers.
- `e2e/supplier-dashboard-improvements.spec.js` and `e2e/dashboard-mobile-ui-fixes.spec.js`
  follow the new markup.

## Things left alone

- `supplier-dashboard-improvements.css` (used elsewhere).
- Server routes: the CSV export route still returns only headers and `/api/me/packages`
  answers 403 to an unapproved supplier; the page does not depend on either.
- `dashboard-guard.js`, the site header/footer, and the messenger widget's internals
  (only a `broadcastUnread` option was added).
