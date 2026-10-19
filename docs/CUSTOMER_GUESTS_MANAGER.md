# Customer guest list manager (`/guests`)

A calm, app-like guest list for any event plan: counts, search, filter, sort, add / edit / remove,
CSV import and export. Files:

- `public/guests.html` – page shell (site header and footer unchanged, one `<main class="gm">`).
- `public/assets/js/guests.js` – the whole page: pure helpers, then the app. No other page script.
- `public/assets/css/guests.css` – the page's only stylesheet, every selector under `.gm`.
- Tests: `tests/unit/guests-manager.test.js` (+ `tests/helpers/guests-manager-scenario.js`, a jsdom run of the real page).

## Data and its relationship to Wedding Website & RSVPs

Both screens read and write the **same** list: `plan.guestList` (or the legacy `plan.guests` array)
in the `plans` collection, through `/api/me/plans/:planId/guests` (`routes/guests.js`). They are two
views of one data set, not duplicates, so there is nothing to consolidate on the backend.

- Replies that guests submit on a wedding website appear here (marked "Replied via your website").
- Seating lives in the wedding app. A guest seated there has a `tableId`; on this page their Table
  field is read-only so the two cannot drift apart. Changing a guest to declined / awaiting / maybe
  frees their seat on the server.
- For wedding plans the page shows a short pointer to `/dashboard/customer` (Wedding Website &
  RSVPs). Other plan types do not see it.

Fields used: `name`, `email`, `phone`, `rsvpStatus` (pending, attending, maybe, declined),
`partySize`, `dietaryRequirements`, `tableName`, `notes`.

## What changed from the old page

- The old page sent a `plusOne` flag and read `dietary`, `table` and `plusOne` back. The server
  ignores `plusOne` and stores `dietaryRequirements` / `tableName`, so those columns were empty
  after every reload. The page now uses the server's own fields, and **party size** replaces the
  plus-one toggle (a plus one is a party of two).
- Edit and Delete used inline `onclick` handlers, which the site's CSP (`script-src-attr 'none'`)
  blocks in production. Rows now use delegated listeners.
- The "Maybe" reply, which the server accepts, is now supported.
- Attending is counted in guests and in people (sum of party sizes), matching `rsvp-summary`.
- Chart.js (CDN) and `guests-init.js` are gone; the RSVP doughnut is a segmented bar.

## Behaviour notes

- Dialogs are native `<dialog>` elements (focus trap, Escape and return of focus come from the
  platform; the page returns focus to the same guest's Edit button after saving). On phones they
  become bottom sheets. Delete asks for confirmation and focuses Cancel.
- Add has "Save and add another" for entering several guests quickly.
- The server frees the table of any guest who is not attending each time they are saved (including
  a table typed in the same form), so the edit dialog says so when that is about to happen.
- With no `?plan=` the page opens on the plan last picked here or on the budget page (shared in
  `localStorage` as `ef_customer_plan`), otherwise on the dashboard's focus plan (the next dated
  plan), so the three customer pages start on the same event. The dashboard's guest links carry
  `?plan=`.
- A party size outside 1 to 20 (the server's limit) is reported next to the field instead of being
  quietly changed.
- The page uses the same warm neutrals, 1200px frame and rounded-rectangle shapes as the budget page
  and the dashboard.
- The table becomes one card per guest at 900px and below. Lists are paged 25 at a time.
- Guest data is always escaped (`esc()`); a test proves an `<img onerror>` name never becomes markup.
- Export writes `Name, Email, Phone, RSVP, Party size, Dietary, Table, Notes`. Cells that start with
  `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe so spreadsheets do not run them as
  formulas; import removes that guard again.
- Import matches columns by header name, so the previous `FirstName, LastName, PlusOne` layout still
  works. It posts one guest at a time and is limited to 50 rows because the write limiter allows 80
  writes per 10 minutes. Rows without a name are listed as skipped rather than dropped silently.
- All requests use `limit`-free endpoints, so the `/api` pagination cap does not apply.

## Left alone

The shared `dash-*` utilities and the now-unused `guests-*` rules in `styles.css` were not touched
(`styles.css` is global and other pages use the `dash-*` classes). The page still loads the shared
site-chrome stylesheets (`styles.css`, `utilities.css`, `components.css`, `mobile-optimizations.css`,
`ui-ux-fixes.css`, `navbar.css`, `eventflow-brand.css`, `eventflow-footer.css`): the header, footer
and cookie banner depend on them. `eventflow-17.0.0.css` and `animations.css` were dropped from this
page: removing them made no visible difference to the header, footer, cookie banner or bottom
nav (a screenshot comparison showed about 1,500 differing pixels at desktop width, none on
phones), and the page's own content no longer uses them.
