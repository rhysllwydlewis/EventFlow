# Community forum redesign — working file

This file is the handoff between working sessions, including the automated 6am
pickup. It is deliberately committed to the repository rather than kept in a
scratchpad: a session that starts cold has nothing else to read.

**Branch:** `claude/eventflow-community-forum-vgvvt0`

If you are picking this up cold, read the brief, then the backlog, then the last
two or three session-log entries. The log is the answer to "where did I get to".

---

## Design brief

The redesign targets the reference mockup supplied by the site owner. The
mockup covers the **above-the-fold area of `/community` only**; everything
below it (the discussion feed, its tabs and the sidebar) stays as it is. The
brief, read off the mockup:

1. **A centred hero card**, floating on a tinted background, carrying a
   circular teal chat-bubble badge, the `EventFlow Community` heading, the
   one-paragraph explainer, a single search field with a square teal submit
   button, and two calls to action — `Start a discussion` (solid teal) and
   `Browse discussions` (outlined).
2. **Six discussion preview cards flanking the hero**, three each side, each
   with a thumbnail, title, author, relative time, reply count and a small
   activity dot.
3. **Decorative background**: soft mint blobs and dashed curved connector
   lines running from the hero out to the flanking cards.
4. **A category strip** below the hero: one tile per category with a line icon
   in a tinted circle, the category name, a compact discussion count
   (`1.2k discussions`) and a chevron.
5. **A join bar** at the very bottom: a people icon, the sentence
   "Join thousands of event planners and suppliers sharing ideas every day."
   and a `How it works` link.

### Constraints that override the mockup where they conflict

These are non-negotiable and any session must honour them:

- **The mockup is a desktop composition.** The flanking cards cannot float at
  narrow widths. They must reflow into ordinary in-flow content rather than be
  hidden — hiding them would remove real discussion links from small screens.
- **Everything stays crawlable.** `/community` is server-rendered first and
  enhanced second (`#efc-noscript` holds the server HTML; `EFC.hideFallback()`
  removes it once the client has data). Any new hero content must exist in the
  server-rendered fallback too, or it is invisible to crawlers.
- **WCAG 2.1 AA.** 4.5:1 for normal text, 3:1 for large text and UI borders.
  The previous PR took this page from thirteen contrast failures to zero;
  do not reintroduce any. Teal-on-tinted-teal is the recurring trap — use
  `--efc-accent-strong` for brand text on a tinted surface.
- **The site type scale.** Allowed font sizes are 11, 12, 13, 14, 16, 18, 20,
  24, 28 and 32px; anything from 36px up is treated as decorative. Enforced by
  `tests/unit/type-scale.test.js`, which fails on both an off-scale value and
  on more than ten distinct sizes.
- **No vanity metrics.** The community deliberately publishes evidence-backed
  counts, not "users online". The join-bar wording is copy, not a live count.
- **Never merge.** The site owner merges their own pull requests.

---

## Backlog

Ordered. Tick as they land, and add anything discovered along the way rather
than fixing it silently.

### Stage 1 — the hero composition

- [x] Add a `compactCount` helper (1234 → `1.2k`) to the shared client module
- [x] Add a per-category line-icon set, keyed by slug, with an emoji fallback
      for operator-created categories that are not in the seed list
- [x] Build the hero card markup and styles
- [x] Build the flanking preview rails, with a responsive reflow
- [x] Build the decorative background layer (`aria-hidden`, motion-safe)
- [x] Build the category strip
- [x] Build the join bar

### Stage 2 — data the new design needs

- [x] Give discussion cards a thumbnail (`heroImage`) from their first image
      attachment, with a category-tinted placeholder when there is none
- [x] Extend the server-rendered `/community` fallback so the new hero content
      is crawlable

### Stage 3 — verification

- [x] Axe pass on `/community` signed out — 0 violations at 1440, 768 and 390
- [ ] Axe pass on `/community` **signed in** (not yet run)
- [x] Contrast audit of every new colour pair (all ≥ 4.5:1 for text)
- [x] Viewport sweep: 390, 768, 1024, 1200, 1280, 1440 — no horizontal overflow
- [x] Reduced-motion and forced-colors checked with the settings forced in the
      browser: the decorative layer drops out under both, the hero survives,
      and the card picks up a `CanvasText` border in forced colours
- [x] Unit tests for the new helpers and payload fields (26 cases)
- [x] Full `npm test`: 8146 passed, 1 failed. The failure is
      `tests/integration/pexels-collage-fallback.test.js`, which fails
      identically with this branch's changes stashed — see below.

### Stage 4 — still to do

- [ ] Carry the hero treatment across to the sibling pages that still use the
      old `.efc-hero` band: `/community/discussions` and `/community/search`.
      They look like a different site next to the new homepage. **This is the
      largest remaining item and the obvious next one.**
- [ ] `/community/category/:slug` has no hero at all — decide whether it gets
      a scaled-down version of the stage.
- [ ] `core.js` fetches `/api/v1/csrf-token` three times on a page that fires
      several non-GET calls at once: `csrfToken()` caches the result in
      `window.__CSRF_TOKEN__`, but concurrent callers all miss the cache before
      the first response lands. Cache the in-flight promise, not just the
      resolved value. Minor — three requests, not a loop.
- [ ] The rails are populated from the `home` payload's `recentActivity`,
      `trending`, `popular` and `recentDiscussions` arrays. That is four
      arrays fetched to render six cards. Worth a dedicated slice in the
      payload if the endpoint ever gets slow.

### Discovered along the way

Bugs and defects found while doing the above. Each one gets a line here when
found and a tick when fixed, so nothing is quietly dropped.

- [x] **Two `<h1>`s on `/community`.** The shell's hero and the server-rendered
      fallback each emitted `<h1>EventFlow Community</h1>`, so the page shipped
      two competing top-level headings for as long as the fallback was on
      screen. Pre-existing, not introduced by this work. The fallback now
      starts at `<h2>`.
- [x] **The hero search button went full-width on mobile**, squeezing the input
      to 32px and making the field unusable below 768px. Cause:
      `mobile-optimizations.css` forces `width: 100%` on every
      `button[type="submit"]`, with an existing carve-out for
      `.ef-search-bar__button`. The hero button now carries `.efc-searchbtn`
      and is excluded the same way.
- [x] **Preview cards were clipped 8px by the stage's `overflow: hidden`** at
      every width from 1200px up, because the staggered middle card hangs
      1.5rem outside its grid column and the container only had 1rem of
      padding to hang into.
- [x] **The decorative arcs were positioned with `inset: 0`**, which stretched
      a 620-unit viewBox over the full stage height and left two stray dashes
      floating above the category strip.
- [x] **Nine of the 22 seeded categories had no line icon** and fell back to
      emoji, so the strip mixed two icon styles. Caught by a test asserting
      the map covers every seed slug, not by eye.
- [x] **`/community/discussions` served no discussion links without
      JavaScript.** The community's main index — and where the homepage's
      "Browse discussions" button sends people — was a `SIMPLE_PAGES` shell
      whose entire fallback was `<h1>All discussions</h1>`. The homepage
      rendered ten links and every category page rendered its own; this one
      rendered zero, which defeats the crawlability the whole feature was
      justified on. It is now a real route with a paginated server-rendered
      list, `rel=prev`/`rel=next` and `BreadcrumbList` data.
- [x] **Two visible `<h1>`s on `/community/guidelines` and
      `/community/help`.** Those pages are fully static and load no view
      script, so nothing ever hid the fallback: the injected heading rendered
      directly above the shell's own, on screen, in production. The same
      unconditional injection also shipped two `<h1>`s in the raw HTML of
      `/community/discussions` and `/community/search`. Fixed centrally with
      `fallbackHeading()`, which steps the fallback heading down to `<h2>`
      when the shell already provides an `<h1>`.
- [x] **The signed-out "Log in or join" button measured 2.05:1.**
      `.efc-notice a { color: inherit }` outranks `.btn-primary`'s own
      `color: white`, so the button in the composer's login prompt inherited
      the info notice's indigo `#3730a3` and painted it on the teal fill. This
      is the login gate on `/community/new`. Narrowed to
      `.efc-notice a:not(.btn)`.

### Known gaps against the mockup

Deliberate, and worth re-reading before someone "fixes" them:

- **Card thumbnails are category tiles, not photographs.** The mockup shows a
  photo on every preview card. Discussions have no image uploads — every
  published discussion has an empty `attachments` array and nothing in the
  product writes to it. `toDiscussionCard` now exposes `heroImage`, so real
  photos appear on their own the day uploads land; until then the cards show a
  tinted category icon rather than a stock photo the site does not have.
- **The strip scrolls.** The mockup shows seven categories filling the width.
  The site has 22. They are in one horizontally scrollable row with a fade at
  the right edge rather than truncated, so none is hidden.

---

## Session log

Newest last. Each entry: what was done, what was found, what is next.

### 2026-08-04 — session 1

Set up the daily 6am pickup routine and this handoff file. Surveyed the
existing implementation: `public/community.html` (shell), `home.js` (client
render), `community.css` (851 lines), `routes/community-pages.js` (server
fallback and meta), `routes/community.js` (`/home` payload) and
`services/community.service.js` (`toDiscussionCard`).

Findings that shaped the plan:

- The `/home` payload already returns `categories` with a `discussionCount`,
  so the category strip needs no new endpoint.
- `toDiscussionCard` has no image field at all, so the mockup's card
  thumbnails need a new `heroImage` derived from `attachments`.
- The seed categories match the mockup's strip almost exactly, but carry emoji
  icons where the mockup shows line art.

Built the whole hero composition: stage background, hero card, both preview
rails with their responsive reflow, the category strip and the join bar.
Added `compactCount`, `categoryIcon` (22 line icons) and `previewCard` to the
shared client module, `heroImage` to `toDiscussionCard`, and 26 unit tests.

Verified: axe clean at 1440/768/390, every new colour pair measured, no
horizontal overflow at six widths, reduced-motion and forced-colours checked
with the settings forced. Five defects found and fixed — see "Discovered along
the way"; two of them (the duplicate `h1` and the mobile search button) were
pre-existing rather than introduced here.

**Pre-existing failure, not ours and not fixed:**
`tests/integration/pexels-collage-fallback.test.js` expects 404 when the
`pexelsCollage` feature flag is off and gets 200. Two routers both register
`GET /public/pexels-collage` — `routes/admin-homepage-collage-active.js:261`
and `routes/admin.js:5478`. The one that wins reads a different flag
(`collageWidget`) from the one the test sets. Confirmed by stashing this
branch's changes and re-running: it fails identically. Left alone because
picking a winner between two admin routes is a separate decision from a
forum redesign, and guessing wrong would silently change admin behaviour.

Next: stage 4 — the sibling community pages (`/community/discussions`,
`/community/search`, `/community/category/:slug`) still use the old
`.efc-hero` band and now look like a different site next to the homepage.

### 2026-08-05 — session 3 (review pass)

Swept every public community route at 1440 and 390 for axe violations,
horizontal overflow, JavaScript errors and heading structure, rather than
looking only at the pages this branch had touched. That turned up three real
defects, all recorded above: the uncrawlable `/community/discussions` index,
the two visible `<h1>`s on the guidelines and help pages, and the 2.05:1
login button. **All three pre-date this branch.**

The sweep now reports **zero axe violations on every public community route at
both viewports**, one `<h1>` in the raw HTML of every page, and no horizontal
overflow anywhere.

Two things checked and deliberately not changed:

- `/community/saved` never reaches Playwright's `networkidle`. Investigated:
  85 requests, nothing repeating more than three times, no runaway poll. The
  site holds a persistent notifications connection, so `networkidle` will
  never fire. Not a defect; use `domcontentloaded` when testing that page.
- The remaining `h1=2` counts on `/community/new` and
  `/community/category/:slug` are the fallback heading sitting inside the
  `hidden` fallback after the client render replaced it. Verified not visible
  and not exposed to assistive technology, and the raw HTML has one.

Next: unchanged — stage 4, the sibling pages' visual treatment.
