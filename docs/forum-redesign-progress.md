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
- [ ] **Regenerate the `homepage` and `pricing` visual baselines.** Both are
      marked `screenshotApproved: false` in
      `tests/visual/visual-regression.spec.mjs`, which skips the pixel
      comparison only — axe still runs on both. `homepage` shifted 4700→4704px
      when the site-wide `hyphens: auto` rule was removed (a line now wraps
      differently); `pricing` still depicts the pre-#1428 page and is roughly
      twice the height CI renders. Both need `npm run test:visual:update` in an
      environment that reproduces CI's rendering, the images reviewed, and the
      flag removed. Deliberately not done from a development machine: a
      baseline generated where text wraps even slightly differently fails on a
      size mismatch regardless of pixel tolerance, so an unverifiable image is
      worse than none.
- [ ] The composer modal is wired to `/community` and `/community/discussions`.
      Consider it for the category pages too, where "Start a discussion" could
      preselect the category it was opened from — `openDialog` already reads
      `?category=` off the link, so it is a markup change rather than new code.
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

- [x] **Every unclassed checkbox and radio on the site rendered stretched.**
      `styles.css` sets `width: 100%` on `input, select, textarea` for text-like
      fields; a checkbox obeys it too, so the control filled its container while
      the glyph stayed 13px and the browser painted that glyph centred in the
      box. On `/community/new` the 18+ confirmation appeared to float alone in
      the middle of its notice, nowhere near its own label. Fixed with a
      carve-out restoring the intrinsic size. Verified against the previous file
      that no page which already had its own override changes at all — including
      every visual-baseline page — so the fix reaches only the pages that were
      actually broken.
- [x] **Regenerating the shells would have reverted the forum redesign.**
      `scripts/generate-community-pages.mjs` still emitted the old `.efc-hero`
      band for `community.html` long after the committed shell was rebuilt
      around `.efc-stage`, and pinned one shared asset version over the
      individually bumped ones. Running it replaced the 67-line hero with the
      old 13-line band and silently downgraded four cache-busting queries.
      Nothing failed; the only signal would have been someone noticing the
      homepage had reverted. The template now carries the real hero and a
      per-asset version map, reproduces all 12 committed shells byte-for-byte,
      and has a `--check` mode that a unit test runs so drift fails loudly.

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
`pexelsCollage` feature flag is off and gets 200. Confirmed by stashing this
branch's changes and re-running: it fails identically. Left alone for now.

> **Correction (session 5).** The diagnosis above originally blamed a route
> collision between `routes/admin-homepage-collage-active.js` and
> `routes/admin.js`. That was wrong — the test mounts `routes/admin` directly,
> so no collision applies. The real cause was that the endpoint is enabled by
> `collageWidget.enabled === true || settings.features?.pexelsCollage === true`
> (deliberate backward compatibility, and correct) while the test's
> `beforeEach` managed only the legacy flag. It therefore passed on a clean
> database and failed wherever a collage widget already existed. Fixed in
> session 5 by making the test manage both flags. The route was not changed.

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

### 2026-08-05 — sessions 4 and 5 (pricing detour, PR #1432)

The site owner redirected this branch onto `/pricing` after PR #1431 merged.
The page had just been rebuilt by #1430 but did not match their render, so the
work was: restyle it in the community design language, fix what was visibly
broken, and surface the selling copy. All of it shipped in #1432, now merged.

What changed:

- **The billing toggle.** The track and thumb were geometrically wrong — the
  switch element was carrying the track's own background and box-shadow at the
  wrong height. The track is now a `::before` pseudo-element at a fixed 48×28,
  with the thumb centred on it and translating 20px.
- **Site-wide hyphenation removed.** `ui-ux-fixes.css` applied `hyphens: auto`
  to a global `h1,h2,h3,h4,h5,h6,p,span,div,a,label` selector and again to
  `.card` headings. That is what made the pricing text look broken, and it was
  breaking words across every page on the site. `/pricing` alone had 33
  hyphenation breaks; it now has zero, as does everywhere else.
- **Merchandising copy surfaced.** The plans API already returned
  `valueStatement` and `badge` for each plan and `pricing.js` fetched and then
  discarded both. They now render.
- **Four accessibility defects fixed**, found by sweeping every public page
  with axe rather than only the pages this branch touched. All pre-existing:
  three `aria-hidden` containers that still held focusable children (fixed
  with `inert`), a searchbox carrying `aria-expanded` without a role that
  permits it (critical — it is a combobox, and now says so), and the shared
  bottom-nav label at 3.70:1 on a tinted bar. Guarded by
  `tests/unit/aria-hidden-focus.test.js`, because the visual/a11y suite only
  covers five baseline pages and a regression on `/suppliers` or the shared
  nav would otherwise go unnoticed until someone swept again.
- **The pexels-collage test made deterministic** — see the correction above.

Verified: full `npm test` **8169 passing, 0 failing** — the first fully green
run on this branch. Axe clean across 9 routes × 2 viewports. No horizontal
overflow, no JavaScript errors. DeepSource grade A on all four categories.

Two things left open and honestly so:

- The two visual baselines above. Skipping the comparison is a stopgap, not a
  fix, and the backlog item says what "done" looks like.
- DeepSource JavaScript was red on #1430 on a dashboard-configured metric with
  grade A and zero inline issues. A documentation-coverage hypothesis was
  tested and **falsified**. #1430 is merged and the check is green on this
  branch, so it is no longer blocking, but the cause was never established and
  needs the owner's DeepSource dashboard if it recurs.

Next: back to stage 4 — `/community/discussions` and `/community/search` still
use the old `.efc-hero` band and look like a different site next to the
redesigned homepage. That remains the largest open item.

### 2026-08-05 — session 6 (the composer)

The site owner reported that `/community/new` "looks bad" and asked whether it
could be a widget opened from the community page rather than a whole page.

**Why it looked bad.** One rule, and not a community one. `styles.css` styles
every `input, select, textarea` at `width: 100%`, which is right for text
fields and wrong for a checkbox: the control stretched to the full width of the
notice while its glyph stayed 13px, and the browser painted that glyph centred
in the resulting box. The 18+ confirmation therefore floated in the middle of
its own notice, a long way from the label it belonged to. Measured at 1114px
wide in the browser before the fix, 20px after. Every unclassed checkbox on the
site had the same defect; most pages happened to carry their own override, so
the composer was where it showed.

Alongside that the page had no layout of its own — one flat column of controls
at the full 1180px shell width, with the title input stretched right across the
viewport. It is now capped at 46rem and grouped into two cards: what you are
asking, then how people find it.

**The modal.** "Start a discussion" now opens the composer over the page it was
pressed on, on `/community` and `/community/discussions`. It is layered on top
of the ordinary link rather than replacing it, which is the part worth
preserving: `/community/new` is still a real page with a real URL, so a
middle-click, a new tab, a bookmark, a browser without `<dialog>` and the
`?next=/community/new` login redirect all still land somewhere that works. The
same `composer.js` renders both surfaces — it takes a root element and a
heading level, so the modal uses `h2` and the page keeps its `h1` rather than
the page ending up with two.

Details that needed deciding rather than defaulting:

- Escape and the close button confirm before discarding typed content. Drafts
  autosave every three seconds, but a modal that vanishes on a stray keypress
  and takes the post with it is worse than one extra prompt.
- Focus moves to the title field on open and returns to the button that opened
  it on close.
- Modified clicks (cmd, ctrl, shift, middle) are not intercepted — those mean
  "open this somewhere else" and must stay ordinary navigation.
- `?category=` is read from the link that was clicked, not the current page's
  query string, which is what a category-page trigger would need.

**Found along the way:** the page generator had drifted far enough to be
dangerous — see the entry above. That was not part of the request and is the
more serious of the two findings.

Verified: full `npm test` **8185 passing, 0 failing**. Axe clean on the page and
on the modal at 1440 and 390. No horizontal overflow, no JavaScript errors, one
`h1` on the page with the modal open. Checkbox geometry compared against the
previous `styles.css` on seven pages including every visual baseline: identical
everywhere, so no baseline needs regenerating.

Next: unchanged — stage 4, the sibling pages' visual treatment.
