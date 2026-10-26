# Admin dashboard audit (`/admin`)

First pass over the admin landing page (`public/admin.html`, `pages/admin-init.js`,
`pages/admin-messages-init.js`, the shared navbar). Checked in a real browser as a seeded admin at
1440px and 390px, with the console and network watched, then against the known bug classes in
`CLAUDE.md`.

The other 35 `admin-*.html` pages were not audited in this pass. See "Not done" below.

## Fixed

| Finding                                                                                                                                                                                           | Cause                                                                                                                                                                                             | Fix                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The two counts inside each "Manage and export" card (Pending approval, Pro+ subscribers, Featured, Access requests, Published, Active, Open payouts) were invisible: a grey empty strip.          | `styles.css` sets `.stat-item { opacity: 0 }` until a script adds `.is-visible`. Only `admin.html` still uses `.stat-item` and nothing adds the class. The values were in the page, at opacity 0. | `admin-dashboard-refresh.css` shows them (`opacity: 1; transform: none`).                                |
| Message Moderation stayed on "Loading conversations…" for ever when the server did not answer, then (after any failure) printed "Failed to load conversations (error: 500)" with no way to retry. | Bare `fetch` with no time limit. Two quick searches could also finish out of order, so the older answer replaced the newer one.                                                                   | 15s limit through `AdminShared.fetchWithTimeout`, a readable message, a "Try again" button, newest-wins. |
| Every other dashboard panel could wait for ever on a silent server.                                                                                                                               | `admin-init.js` has its own `api()` helper that called bare `fetch`.                                                                                                                              | It now goes through `AdminShared.fetchWithTimeout` (20s) and gets the shared readable network error.     |
| System Analytics "Signups last 7/30 days" rows had the number floating mid-row beside a row of ▮ glyphs that only repeated the number.                                                            | Three children in a two-column flex row; the glyph "bar" was capped at 20 and carried no information.                                                                                             | Bar deleted; each row is a label and a value, like the rows above it.                                    |
| Recent Users rows were ~180px tall on desktop: the Actions column shrank so the four buttons stacked.                                                                                             | Auto table layout gave the wrapping button group the narrowest width.                                                                                                                             | `min-width: 230px` on the Actions column: two rows of buttons.                                           |
| The bell's icon map had no entry for `booking` and `payment`.                                                                                                                                     | `NOTIFICATION_TYPES` has 11 types; `getNotifIcon()` covered 9 (the CSS colours already covered all 11).                                                                                           | Icons added; a test now checks every type against both maps. `admin-navbar.js` re-versioned on 34 pages. |

Tests: `tests/unit/admin-dashboard-fixes.test.js` (the message panel is run under jsdom: loading,
timeout, retry, access error, out-of-order answers).

## Checked and fine

- No console errors and no 4xx/5xx on `/admin` for an admin session.
- No request on the dashboard asks for `limit` over 100.
- Dashboard counts agree with `GET /api/admin/metrics` and `/users/summary`.
- Account Health, Moderation Queue, Quick Actions and the user table render the seeded data.

## Users Centre and Supplier Management (second pass)

Same method: real browser as a seeded admin, 1440px and 390px, console and network watched.

| Finding                                                                               | Cause                                                                                                                                       | Fix                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Users Centre summary cards (Total, Unverified, Google, …) stacked in one tall column. | The container used `uc-summary-grid`; the stylesheet defines `users-centre-summary-grid`. A class with no rule fails silently.              | Container uses the defined class: seven cards in a row.                                                                               |
| Choosing "200" users per page failed.                                                 | The dropdown offered 200, but the `/api` pagination middleware rejects `limit` over 100 with a 400. A saved `?limit=200` link did the same. | 200 removed from the dropdown and from the accepted values (a stale link falls back to 50).                                           |
| "Subscription" and "Marketing" column headings broke mid-word ("SUBSCRIPTI ON").      | Columns 110px and 80px.                                                                                                                     | 130px and 100px.                                                                                                                      |
| Supplier Management filter dropdowns each filled a whole line.                        | `styles.css` and `ui-ux-fixes.css` give every `select` `width: 100%`; inside the wrapping `.filter-row` each took its own row.              | `.filter-row .filter-select { width: auto; flex: 0 1 200px }`. `admin-ui-improvements.css` re-versioned on the 27 pages that load it. |

Tried and dropped: pinning the Actions column to the right edge. On Suppliers the Actions cell is
about 440px wide (two dropdowns and four buttons), so a pinned column covered four other columns.

## Dashboard redesign (`/admin` only)

The dashboard now follows the customer and supplier dashboards: a warm neutral page, white cards with
hairline borders, one teal accent, hierarchy from type instead of gradients and emoji tiles.

- **Greeting and "Next:" line.** A hero greets the admin by name and names the biggest waiting
  queue ("Next: 4 suppliers to verify and 1 more queue."), with two buttons.
- **One summary card** with hairline-divided cells (users, suppliers, packages, queues) in place of
  the old row of coloured stat tiles.
- **Queue list.** Photos, reports, supplier verification and reviews are rows with a count and one
  action each. A count that failed to load shows "—", not 0.
- **Account health, Manage and quick links** are plain hairline row lists; analytics, message
  moderation (with the earlier timeout and retry) and Recent Users sit below.
- **One stylesheet**, `admin-dashboard-home.css`, scoped under `.adh-page`. The old
  `admin-dashboard-refresh.css` and `admin-verification-source-init.js` patch layers were deleted;
  the page script now draws their rows itself.
- **Every element id the scripts and tests use was kept** (`getElementById` wiring and the browser
  specs). The dashboard's photo count is `adhPendingPhotosCount` because the shared badge updaters
  also write to `pendingPhotosCount`.

Found in a line-by-line review of the redesign and fixed: the non-admin "hide the page" step did not
work on the grid sections (their own `display` beat the `hidden` attribute); "Some queue counts could
not be loaded" flashed while counts were still loading; System analytics counted signups from only
the 20 users the table loads, so "last 30 days" could never pass 20 (7 days now comes from the summary
service, 30 days shows "20+" when the list is full); a failed recent-users or platform-totals request
showed "No users match" and zeros instead of saying it failed; an unfamiliar role was labelled
Customer.

Left alone: `admin-enhanced.css` still carries the old dashboard health and stat-card rules, which
other admin pages load; they are dead on `/admin` but not removed here.

## Click-through pass on the redesigned `/admin`

Every visible control on the page (93 buttons, links, inputs and selects, each on a freshly loaded
page) was clicked as a seeded admin at 1440px, with the console and network watched. Then the
data-changing flows were run end to end on a throwaway local database: create, edit, verify email,
grant admin, revoke admin and delete a user; the three exports; the bell and "Mark all read"; the
user menu, Settings and Sign Out (after which `/admin` sends you to sign in); the drawer search and
all 30 drawer links. All of them did what they say, with no console errors and no 4xx/5xx.
Previous/Next are disabled with one page of users, and the owner account's Edit is disabled on
purpose ("Owner account is protected").

| Finding                                                                                                       | Cause                                                                                                                              | Fix                                                                                                             |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A grey band down the left edge of every admin page.                                                           | The closed quick-nav drawer is parked off screen, but its wide `box-shadow` reached into the viewport.                             | The shadow only applies while the drawer is open. `admin-navbar.css` re-versioned on all 36 pages that load it. |
| The page background was cool grey, not the warm neutral the redesign uses.                                    | `admin-workspace.css` sets `body.has-admin-navbar.admin { background: #f5f7f8 }`, which out-ranked the dashboard's own background. | `body.adh-page.has-admin-navbar.admin` sets the dashboard background.                                           |
| The navbar's Refresh button reloaded the whole page and logged "Failed to fetch" for every request in flight. | The navbar reloads the page unless the page defines `window.refreshDashboardData`.                                                 | `admin-init.js` defines it as `loadAll`, so Refresh updates the numbers in place.                               |
| Row chevrons were a text "›" that rendered at different sizes per font.                                       | A text glyph in `::after`.                                                                                                         | A 16px, 2px-stroke SVG mask that matches the header icons and moves 2px on hover.                               |
| "Press Ctrl+/ for shortcuts" popped up over the content on phones and tablets.                                | `admin-features.js` showed it on every device.                                                                                     | Skipped on touch (`pointer: coarse`) devices.                                                                   |
| On a phone the summary links had a blank gap under the text.                                                  | The link has a 44px minimum height (good for touch) with its text at the top.                                                      | The text is centred in the link.                                                                                |

Not changed: the navigation drawer's tile icons are emoji, shared by all 36 admin pages. Replacing
them with SVGs is a change to every admin page, so it is left for its own pass.

## Not done (updated)

- **Actions column off-screen.** On a 1440px screen the Users table is about 1,500px wide and the
  Suppliers table about 1,500px wide, inside a card about 1,180px wide, so the Actions column is
  reached by scrolling the table sideways. The real fix is smaller row actions (a menu for the
  secondary actions) rather than pinning.

## Not done (first pass)

- **The other admin pages.** 36 pages, about 20,000 lines of page scripts and 20,000 lines of admin
  routes. Settings was audited and redesigned in #1830; the rest have not had a pass like this one.
- **Recent Users on a phone** still scrolls sideways inside its card (the table is 980px wide). It
  works, but a stacked card layout like the message panel's would be better.
- **Recent Users "Verified: LEGACY"** shows for every account created before the verification
  provenance fields existed; it reads like a status, and it is a data-age label.
- **The message list could not be tested against real conversations** in the local run (it needs
  MongoDB). The failure path was exercised for real because the local request never answered.
