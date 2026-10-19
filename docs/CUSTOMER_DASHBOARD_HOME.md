# Customer dashboard home

`public/dashboard-customer.html`, served at `/dashboard/customer`.

The page is one calm column of cards on a warm neutral background with a single
teal accent. It replaces a page that was nine stacked stylesheets, three
layers of scripts that re-patched the DOM after render, and the same facts
(budget, progress, countdown) drawn twice from two different calculations.

## Structure

Top to bottom. Each section appears once.

| Section                                | Where it comes from                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Account-type notice (only if relevant) | static markup, `dashboard-account-type-notice.js`                                            |
| Email verification banner (if needed)  | `dashboard-customer-init.js`                                                                 |
| Greeting + next action                 | `#welcome-heading` (init), `#cdh-lede` and `#cdh-next-action` (`customer-dashboard-home.js`) |
| Summary row                            | countdown, budget, planning progress, guests; `customer-dashboard-home.js`                   |
| Budget form (opens from the summary)   | `#budget-settings-panel`, saved by `dashboard-customer-init.js`                              |
| Next steps                             | `/api/v1/customer/milestones`, `customer-dashboard-home.js`                                  |
| Wedding Website & RSVPs entry          | static card, app is `customer-wedding-website.js`                                            |
| Calendar                               | `calendar-view.js` (FullCalendar)                                                            |
| Your plans                             | `dashboard-customer-init.js`                                                                 |
| Messages                               | `MessengerWidgetV4` (its own heading is hidden; the card supplies it)                        |
| Saved suppliers                        | `dashboard-customer-init.js`, `/api/v1/shortlist`                                            |
| Suggested for you (hidden if empty)    | `recommendations-widget.js`                                                                  |
| Support                                | `customer-tickets.js`                                                                        |

On screens under 1024px the two columns dissolve into one and cards are
ordered: next steps, wedding website, plans, messages, saved suppliers,
suggestions, calendar, support.

### One focus plan

Everything in the summary row describes one plan, chosen by
`CustomerDashboardHome.pickFocusPlan`: the plan whose date is next, else the
latest dated plan, else the first. When someone has more than one plan the
Plans card marks the one in the summary. The budget form saves to that same plan.

- **Countdown** and **Guests** come from the plan; guest replies come from
  `/api/me/plans/:id/rsvp-summary`. With no guest list it says so and links to `/guests`.
- **Budget** is the plan's own `budget` against the priced packages it holds.
  Per-person prices need a guest count; they and packages with no price are
  reported as "not priced", never guessed. The figure stored in the browser is
  only used when no plan has a budget yet.
- **Planning progress** and **Next steps** are the server's milestone list.
  The first unfinished step is also the primary button in the header. Finished
  steps sit in a real `<details>` ("6 completed").
- If the plans request fails the page says so and offers a retry; it does not
  show an empty dashboard.
- **Suggested for you** is `GET /api/v2/search/personalized`, asked with the focus plan's
  location and the supplier categories the plan has not covered yet (`needed`). A budget category
  counts as covered once the plan has a budget line whose category contains its name, so "Venue
  hire" covers Venue (`CustomerDashboardHome.neededSupplierCategories`: Venue, Catering,
  Photography, Entertainment, Decor, Transport, and Attire for a wedding, each mapped to the
  supplier categories it stands for). Suppliers in a still-needed category come first, whatever
  their rating (a strong venue does not push out the photographer the plan has no one for), ordered
  by quality with a boost for the plan's town; suppliers in categories the plan already has only
  fill the rest.
  No more than two of one category come before the others. A card with no real reason shows none
  (never "good match for your search": nobody searched); a still-needed one says "Still to find:
  Photography". Each card opens the supplier's public profile (`publicProfilePath`, built by the
  server), and shows their photo (`profilePhotoUrl`, else `displayAvatarUrl`, `avatarUrl`, `logo`)
  or, with none, the shared placeholder from `utils/supplier-avatar.js`: white initials on that
  supplier's own colour. The response is `private` and never stored in the shared search cache,
  because it depends on who is signed in.
- **Account-type notice** ("Want to list a business? Switch to a supplier account."): shown to
  customers until dismissed (per browser). Its layout follows its own width (container query
  units): one line with the whole sentence on desktop and tablet (the text scaling down to 12px
  as it narrows), one line with just the question on a narrower tablet, and two lines on a phone
  (the question, then Switch and Dismiss side by side; the label shortens to "Switch" under about
  345px, keeping the full accessible name). Browsers without container queries get the same
  steps from the screen width. Both buttons keep the site's 44px touch target.

## Stylesheet

`public/assets/css/customer-dashboard-home.css` is the only stylesheet written
for this page.

- Every selector starts with `.cdh-page`, the class on `<body>`, so nothing can
  leak to another page. Dialogs that scripts append to `<body>` (calendar entry,
  plan editor, ticket) are covered by the same scope. The plan editor and the delete
  confirmation are native `<dialog>` elements (focus moves in, stays in and returns to the
  button that opened them; bottom sheets on phones), not inline-styled overlays.
  The checklist steps "Set your event date", "Add guest count" and "Choose a location" open the
  plan editor on that field (the server sends them to the plan wizard, which starts a new plan).
  The editor has an "Expected guests" field so the guest count step can be completed; it is left
  out for old plans that keep their guest list itself in `guests`, so a number never overwrites it.
  `tests/unit/customer-dashboard-home.test.js` fails on any unscoped selector.
- Tokens are declared once on `.cdh-page` (`--cdh-*`): ink `#17202f`, muted
  `#566176`, accent `#0b8073` / deep `#064f46`, hairline `#e8e5de`, same values
  as the wedding website app and the homepage showcase.
- Type sizes stay on the site scale (10 11 12 13 14 16 18 20 24 28 32).
- No gradients except the loading shimmer, which stops under
  `prefers-reduced-motion`.
- The site-wide touch-target rule gives every `<main>` button a 44px box; text
  links keep that hit area and pull it out of the layout with a negative margin.
- FullCalendar renders into the container itself (the container gets `.fc`), so
  its theme is on `.customer-calendar-viewport` directly. The site's mobile
  `table { display: block }` rules are reset inside the grid.

## What was removed

From this page (the files are deleted only where nothing else loaded them):

- Stylesheets: `customer-dashboard-improvements.css` (2.7k lines),
  `-liquid-glass`, `-welcome-card`, `-welcome-scale`, `-polish`,
  `account-type-notice.css` (folded into the new sheet). Unlinked but kept
  because the supplier dashboard uses them: `dashboard-overhaul`,
  `dashboard-mobile`, `dashboard-animations`, `card-collapse` (css and js),
  `liquid-glass`, `messaging-glass-enhancements`, `p3-features`.
- Scripts: `dashboard-customer-module.js` (stat tiles, budget tracker,
  progress ring, generated task timeline), `dashboard-customer-overhaul.js`
  (countdown, KPI cards, milestone list), `customer-dashboard-enhancements.js`,
  `customer-dashboard-mop-up.js` and `customer-dashboard-polish.js` (both were
  injected by `dashboard-guard.js`; the loader was removed there).
- Content: the welcome card with four shortcut tiles and the "Got it" strip, the
  "At a glance" banner, the second Budget Tracker / Planning Progress / KPI row,
  the countdown nested inside Upcoming Tasks, the generic date-derived task list
  (it was not tied to the customer's own data), the Quick Actions card (links
  already in the header and summary), the conversation search and filter boxes
  (MessengerWidgetV4 reads `-supplier` control ids, so they never did anything),
  and every collapsed accordion.
- With the same data the desktop page went from 4,630px to about 2,400px tall (390px wide: 7,480px to about 4,900px).

## Things left alone

- Done in a later clean-up: the old first-visit onboarding box for customers (`dash_customer` in `app.js`), its
  `renderThreads` helper and the `#customer-*` placeholder rules in `skeleton.css` were
  removed afterwards, along with the `.thread-list`/`.thread-row*` rules in `styles.css` that only
  `renderThreads` used. `app.js` is now `?v=18.5.6` and `skeleton.css` `?v=2.1.0` everywhere.
  A first-visit welcome for new customers does not exist any more; if wanted, build it
  into the dashboard home rather than restoring the script.
- `dashboard-guard.js` changed (it no longer injects the removed scripts), so its
  `?v=` is `17.1.0` on every page that loads it, including the generated
  `admin-community.html` via `scripts/generate-community-pages.mjs`. Behaviour
  only differed on this page; the bump is for cache hygiene.
