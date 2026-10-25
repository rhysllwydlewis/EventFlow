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
