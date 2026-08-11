# Homepage V2 → V1 hero parity: implementation plan

**Branch:** `claude/homepage-v2-redesign-audit-ienc2e`
**Goal:** make the `home-v2` header + hero render identically to the live V1 homepage, and add a
Community entry to the navigation and the hero CTA row.
**Status:** audit complete, approach validated with a working prototype. No production files changed yet.

---

## 1. What the target actually is

The supplied design is the **live V1 homepage** (`public/index.html`), not a new design. Rendering
`/` in headless Chromium at 1680×940 reproduces the reference frame almost exactly: same wordmark,
same nav row, same `Everything you need / to organise an event / In one place` headline with the
mint underline, same unified search bar, same four quick tags, same 2×2 category collage with pill
labels.

Two things in the reference are genuinely new:

| Element                           | Exists on V1?                                            | Action     |
| --------------------------------- | -------------------------------------------------------- | ---------- |
| `Community` nav link              | **Yes** — `index.html:325` (desktop) and `:381` (mobile) | Port to V2 |
| `Community` hero CTA (3rd button) | **No**                                                   | Build it   |

Small differences between the reference image and the live V1 render (organic blob collage shapes,
line icons on the quick tags and collage labels, a shortened one-line subcopy, a
`Search suppliers, packages, venues…` placeholder) are **out of scope for this PR** — decision:
_port V1 exactly now, raise mock polish as a follow-up_.

**Scope decision: header + hero only.** Everything below the hero on `home-v2.html` (trust strip,
featured/spotlight packages, category panel, dashboard preview, marketplace, guides, how-it-works,
supplier band, newsletter, footer, bottom nav) is untouched and keeps its existing
`home-v2-parity.js` wiring.

---

## 2. Baseline: what V2 looks like today

Rendered from the real serving path (static server + the `home-v2-navbar-parity` layer the template
renderer injects):

- **Header** — EF gradient tile + bold `EventFlow` text; nav is `Plan · Suppliers · Events ·
Marketplace · Guides · Pricing` (`For suppliers` is hidden by CSS, **Community is absent**);
  auth pill reads `Sign in` in the HTML and is rewritten to `Log in` at runtime by
  `home-v2-navbar-parity.js:148`.
- **Hero** — a completely different design: serif `Plan your event in one place`, an
  `UK EVENT PLANNING MARKETPLACE` eyebrow pill, a three-field search card (Event type / Location /
  Supplier or keyword) with "Popular searches" chips inside the card, a Pexels-driven background
  photo, **no CTA row and no collage** (`.hv2-hero-collage` is `display:none !important` at
  `home-v2-parity.css:670`).

So this is a full hero replacement plus a brand swap — not a tweak.

---

## 3. Architecture constraints discovered (read before touching anything)

### 3.1 `home-v2.css` is shared with homepage V3 — do not edit it

`utils/template-renderer.js:43-54` builds V3 as **`index.html` + `home-v2.css` + `home-v3*.css` +
an injected `hv2-*` hero**. Most rules in `public/assets/css/home-v2.css` are unscoped
(`.hv2-hero`, `.hv2-search`, `.hv2-hero__lead`, …), so **any edit there silently restyles V3**.

- `home-v2.css` → **shared, off-limits**
- `home-v2-parity.css` → `.home-v2-page`-scoped, V2-only, safe to edit
- `home-v2-navbar-parity.css` / `.js` → V2-only (injected by the renderer), safe to edit

Because the new hero uses V1's class names (`hero-modern`, `ef-search-bar`, `hero-collage`) rather
than `hv2-*`, the shared hero rules simply stop matching on V2 and keep working for V3. **No shared
CSS edit is required.**

### 3.2 How V2 is served

`utils/template-renderer.js`:

- `/home-v2`, `/home-v2.html`, `/home-v2-preview`, `/home-v2-preview.html` → `public/home-v2.html`,
  plus `home-v2-white-fade-page` body class, plus injected `home-v2-navbar-parity.css?v=1` and
  `home-v2-navbar-parity.js?v=1`, plus `X-Robots-Tag: noindex, nofollow` and a `robots` meta.
- `/` → V2 when the admin homepage manager's active version is `v2` (`getActiveHomepageVersion()`),
  with `HOMEPAGE_VARIANT=v2` as the env fallback. Same injections, **no** noindex.

Anything added to `home-v2.html` therefore also ships on `/` the moment V2 is activated.

### 3.3 `home-v2.js` is compiled from TypeScript

`src/homepages/home-v2.ts` → `public/assets/js/pages/home-v2.js` via
`npm run build:homepages` (`tsc -p tsconfig.homepages.json` + prettier). **Never hand-edit the
compiled file.**

Good news: `home-v2.ts` needs **no change**. Its hero-image rotation, popular-search and
search-state handlers all early-return when their elements are absent
(`home-v2.ts:265`, `:333`, `:355`), so removing the old hero markup makes them inert without a
network cost. Leaving it alone means no rebuild, no `?v=` bump on `home-v2.js`, and no churn in the
tests that assert those versions (§7.1).

### 3.4 CSP

`middleware/security.js:73` sets `scriptSrcAttr: 'none'` — **no inline handlers**; all behaviour
must live in external JS. Inline `style` attributes and `https:` images are allowed, so the ported
markup is compliant as-is.

---

## 4. Approach — validated by prototype

Port V1's hero markup verbatim, load the two stylesheets that are already fully namespaced, and add
one small scoped bridge stylesheet for the handful of rules V1 inherits from global files we must
not load.

A throwaway prototype built exactly this way rendered a 1:1 match with the reference, including the
Community nav link and Community CTA. Three defects were visible in that prototype and are folded
into the task list below (§5.2, §5.3).

### Which V1 stylesheets are safe to load into V2

| Stylesheet                                                                                    | Verdict         | Reason                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hero-modern.css`                                                                             | **Load it**     | Selector inventory is entirely `.hero-*`, `.ef-fade-up/.ef-float`, `.sr-only`, `.home-featured-section`, `.home-trust-section` + one `:root` block of `--hero-*`/`--collage-*` tokens. None of those classes exist elsewhere in `home-v2.html`. Also carries `.sr-only` (needed by the search-bar labels) and the `efFadeUp`/`efFloat` entrance animations. |
| `ef-search-bar.css`                                                                           | **Load it**     | Fully self-contained: every `var()` it uses is a `--search-bar-*` / `--search-btn-*` token it defines itself. Zero generic selectors.                                                                                                                                                                                                                       |
| `eventflow-brand.css`                                                                         | **Load it**     | Only `.ef-brand`, `.ef-logo*`, `.ef-brand-text`; supplies the wordmark SVG lockup seen in the reference.                                                                                                                                                                                                                                                    |
| `modern-landing.css`                                                                          | **Do NOT load** | Restyles `html`, `.ef-section`, `.ef-card`, `.container`, `.card` globally with `!important`. Its ~15 hero rules get transplanted into the scoped bridge file instead.                                                                                                                                                                                      |
| `styles.css`, `design-system.css`, `tokens.css`, `animations.css`, `mobile-optimizations.css` | **Do NOT load** | Global base layers that would restyle V2's lower sections. Only the specific values V1's hero reads from them get copied into the bridge file.                                                                                                                                                                                                              |

Verified no conflicts: `.container`, `.hero*` and `.sr-only` appear in **none** of `home-v2.css`,
`home-v2-parity.css`, `home-v2-navbar-parity.css`, `error-boundary.css`, `loading-skeleton.css`.

---

## 5. File-by-file changes

### 5.1 `public/home-v2.html`

**a. Brand → V1 wordmark**

```html
<!-- from -->
<a class="hv2-brand" href="/" aria-label="EventFlow home">
  <span class="hv2-brand__mark" aria-hidden="true"><span></span><span></span></span>
  <span>EventFlow</span>
</a>
<!-- to -->
<a class="hv2-brand ef-brand" href="/" aria-label="EventFlow home">
  <span class="ef-brand-text">EventFlow</span>
</a>
```

**b. Community links** — add `<a href="/community">Community</a>` after Marketplace in `.hv2-nav`,
and `<a href="/community">Community</a>` after Marketplace in `#hv2-mobile-nav`, matching V1's
ordering (`Plan · Suppliers · Events · Marketplace · Community · Guides · Pricing`).

**c. Auth pill copy** — `Sign in` → `Log in` in the static HTML, so it matches the reference and the
value `home-v2-navbar-parity.js` sets at runtime (removes a first-paint text flash).

**d. Hero replacement** — swap the whole `<section class="hv2-hero">…</section>` block for V1's
`<section class="hero hero-modern">…</section>` (`index.html:425-617`) verbatim: `hero-bg-gradient`,
two `hero-blob`s, `hero-grid-texture`, `container hero-grid`, `hero-content-inner` with the
three-span `h1` + `hero-highlight-bg`, `hero-modern-subcopy`, the `ef-search-bar` form (category
`<select>` + search input + submit button), `ef-quick-tags`, `hero-modern-ctas`, and the
`hero-collage` block (hidden video card + four `hero-collage-card` links with `hero-collage-label`
and `hero-collage-credit`). Keep the `aria-hidden` + `inert` pair on the collage.

**e. Community CTA** — third button in `.hero-modern-ctas`, after `Browse suppliers`:

```html
<a href="/community" class="hero-cta-base hero-cta-secondary">Community</a>
```

**f. Head additions** (after the existing `home-v2-parity.css` link):

```html
<link rel="stylesheet" href="/assets/css/hero-modern.css?v=18.3.0" />
<link rel="stylesheet" href="/assets/css/ef-search-bar.css?v=18.3.0" />
<link rel="stylesheet" href="/assets/css/eventflow-brand.css?v=1.0.0" />
<link rel="stylesheet" href="/assets/css/home-v2-hero-parity.css?v=1" />
```

Preload `hero-modern.css` and `ef-search-bar.css` alongside the existing preloads — they are
render-blocking for the largest contentful element.

**g. Script additions** (before the Jade widget scripts):

```html
<script src="/assets/js/ef-search-bar.js" defer></script>
<script src="/assets/js/collage/hero-collage.js?v=1" defer></script>
<script src="/assets/js/pages/home-v2-hero.js?v=1" defer></script>
```

`ef-search-bar.js` is the existing V1 wiring — it handles submit (with the empty-query guard and the
`search_performed` analytics beacon), quick-tag clicks, ⌘/Ctrl-K focus, and single-row tag
balancing. `home-v2-hero.js` is a ~15-line bootstrap that calls the shared collage module (§5.4).

**h. Noscript** — keep V2's existing `hv2-noscript` block; V1's inline-styled equivalent is not
needed.

### 5.2 `public/assets/css/home-v2-hero-parity.css` (new, ~140 lines, `.home-v2-page`-scoped)

1. **Container/grid base** copied from `styles.css:23,50` (the only rules V1's hero inherits from
   that file):
   `.home-v2-page .hero-modern .container { width: min(1480px, 94%); margin-inline: auto; }` and
   `.home-v2-page .hero-modern .hero-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:24px; align-items:center; }`
   with the `max-width:900px → 1fr` collapse. (`hero-modern.css:1282` already caps the hero
   container at `1320px` and supplies the ≥1024px two-column override.)
2. **Design tokens** the hero reads from `design-system.css` — exact values, do not re-invent:
   `--space-2: 8px`, `--space-3: 12px`, `--hero-cta-size: clamp(14px, 0.8vw + 11px, 15px)`,
   `--glass-bg-light: rgba(255,255,255,0.72)`, `--glass-border: rgba(255,255,255,0.35)`,
   `--glass-shadow-soft: 0 4px 24px -4px rgba(0,0,0,0.08)`,
   `--glass-shadow-medium: 0 8px 32px -8px rgba(0,0,0,0.12)`,
   `--gradient-primary: linear-gradient(135deg,#10b981 0%,#059669 50%,#047857 100%)`,
   `--gradient-primary-hover: linear-gradient(135deg,#059669 0%,#047857 50%,#065f46 100%)`.
3. **Tokens from `modern-landing.css`**: `--modern-primary: #0B8073`,
   `--modern-primary-light: #13B6A2`, `--modern-gray-900: #0F172A`, `--modern-gray-700: #334155`,
   `--modern-gray-500: #64748B`, `--modern-radius-lg: 24px`, `--modern-shadow-soft`,
   `--modern-shadow-large`, `--gradient-mesh-1: rgba(11,128,115,0.12)`,
   `--gradient-mesh-2: rgba(19,182,162,0.10)`, `--gradient-mesh-3: rgba(16,185,129,0.12)`,
   `--gradient-mesh-4: rgba(11,128,115,0.08)`.
   _(The prototype guessed these and produced a visibly bluer hero — copy the real values.)_
4. **Transplanted `modern-landing.css` hero rules** (lines 183-450), scoped and with the
   `!important` flags dropped (they only existed to beat `hero-modern.css` in the global cascade;
   the `.home-v2-page` prefix wins on specificity): `.hero-modern` mesh background + padding,
   `::before`/`::after` mesh orbs + `float-mesh` keyframes, `.hero-blob*` + `pulse-blob`,
   `.hero-grid-texture` opacity, `.hero-modern h1` weight/tracking, `.hero-line-1/2` gradient text
   clip, `.hero-highlight-text` + `.hero-highlight-bg`, `.hero-modern-subcopy`,
   `.hero-collage-card` radius/shadow/border, `.hero-collage-label` glassmorphism.

### 5.3 `public/assets/css/home-v2-navbar-parity.css`

1. **Fix the header gutter.** `line 24` is
   `padding: 0 clamp(20px, calc((100vw - 1280px) / 2 + 32px), 32px)` — the computed middle value
   exceeds the 32px ceiling on any viewport wider than 1280px, so it always clamps to 32px and the
   brand sits hard against the viewport edge instead of aligning with V1's centred
   `.ef-container` (`navbar.css:80` — `max-width:1280px; margin:0 auto; padding:0 20px`). Replace
   with `padding-inline: max(20px, calc((100vw - 1280px) / 2 + 20px))`. This is the single largest
   remaining visual delta in the prototype.
2. Neutralise the now-unused `.hv2-brand__mark` rules (lines 64-111) and set
   `.home-v2-page .hv2-header .hv2-brand { gap: 0 }` so the wordmark lockup sits correctly.
3. Bump the injected version to `?v=2` in `utils/template-renderer.js:39-43` (both the preload and
   the stylesheet link) so the change busts caches.

### 5.4 Collage: extract V1's loader into a shared module

**Decision taken: full dynamic parity.** V2 honours the admin collage widget exactly as V1 does.

Today the loader lives inside `public/assets/js/pages/home-init.js` — a 3,853-line V1-only script
that also renders featured packages, the category grid, stats, marketplace, guides and testimonials.
Loading it into V2 would double-render sections that `home-v2-parity.js` already owns, so the
collage subsystem gets lifted out.

**Move to `public/assets/js/collage/hero-collage.js` (new, ~2,100 lines, pure move — no behaviour
change):**

| Group             | Functions                                                                                                                                      | Lines          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Shared utils      | `calculateSuccessRate`, `detectConnectionSpeed`, `isDebugEnabled`, `isDevelopmentEnvironment`                                                  | 21-84, 635-683 |
| Image helpers     | `supportsWebP`, `getConnectionAwareQuality`, `getOptimalPexelsImageSize`, `generateSrcset`                                                     | 684-802        |
| Frame lifecycle   | `setupCollageResizeOptimization`, `setupLazyLoadingForCollage`                                                                                 | 803-875        |
| Entry point       | `loadHeroCollageImages` (fetches `/api/v1/public/homepage-settings`, 5s `AbortController`)                                                     | 876-1023       |
| Constants + state | `PEXELS_*`, `WATCHDOG_*`, `pexelsCollageIntervalId`, `COLLAGE_FALLBACK_GRADIENTS`                                                              | 1024-1052      |
| URL guards + swap | `validateUploadUrl`, `validatePexelsUrl`, `restoreDefaultImage`, `displayPexelsImage`, `restoreFrameDefault`                                   | 1053-1191      |
| Legacy path       | `initPexelsCollage`                                                                                                                            | 1192-1501      |
| Video card        | `loadHeroVideoWithRetry`, `initHeroVideo` (still live — called from `initCollageWidget:2085` even though `.hero-video-card` is `display:none`) | 1502-1982      |
| Widget path       | `initCollageWidget`, `removePictureSourceElements`, `addCacheBuster`, `loadMediaIntoFrame`, `cycleWidgetMedia`                                 | 1983-2965      |
| Cycling + credits | `cleanupPexelsCollage`, `cyclePexelsImages`, `removeCreatorCredit`, `addCreatorCredit`                                                         | 2966-3181      |
| Enhancements      | `initCollageErrorHandlers`, `initParallaxCollage`                                                                                              | 3794-3853      |

Wrap in an IIFE exposing `window.EFHeroCollage = { load, cleanup, initErrorHandlers, initParallax }`.
The module already fetches `/api/pexels/*` directly and has **no dependency on
`pexels-client.js`** — verified. It coordinates through `window.__collageWidgetInitialized`,
`window.__collageIntervalActive`, `window.__collageLastCycleTime`, `window.__collageWatchdogId`,
`window.__collageResizeObserver`, `window.__collageIntersectionObserver`; keep those global names so
the idempotency guards and the `beforeunload` / `load` / `online` retry ladder behave identically.

**`public/assets/js/pages/home-init.js`** — delete the moved functions; replace the six call sites
(`:214`, `:307`, `:313`, and the `setTimeout`/`load`/`online` retries at `:367`, `:380`, `:396`) plus
the `beforeunload` cleanup at `:352` with `window.EFHeroCollage.*` calls.

**`public/index.html`** — add `<script src="/assets/js/collage/hero-collage.js?v=1" defer></script>`
**before** `home-init.js` (`index.html:1203`).

**`public/assets/js/pages/home-v2-hero.js`** (new, ~15 lines) — V2's bootstrap: call
`EFHeroCollage.load()`, `initErrorHandlers()`, `initParallax()` on `DOMContentLoaded` and register
the same `beforeunload` cleanup.

_Risk control:_ do this as a **verbatim move in its own commit** with no edits, so the diff reviews
as a relocation and any V1 regression bisects cleanly.

### 5.5 Docs

Update `docs/home-v2-preview.md` — the "Files added/changed" and QA checklist sections still describe
the original V2 preview.

---

## 6. Full change inventory

| File                                          | Type    | Notes                                                                |
| --------------------------------------------- | ------- | -------------------------------------------------------------------- |
| `public/home-v2.html`                         | edit    | brand, Community ×2, `Log in`, hero swap, 4 CSS links, 3 script tags |
| `public/assets/css/home-v2-hero-parity.css`   | **new** | scoped bridge layer                                                  |
| `public/assets/css/home-v2-navbar-parity.css` | edit    | gutter fix, brand-mark cleanup                                       |
| `public/assets/js/collage/hero-collage.js`    | **new** | extracted collage module                                             |
| `public/assets/js/pages/home-v2-hero.js`      | **new** | V2 collage bootstrap                                                 |
| `public/assets/js/pages/home-init.js`         | edit    | remove moved code, delegate                                          |
| `public/index.html`                           | edit    | one `<script>` line                                                  |
| `utils/template-renderer.js`                  | edit    | navbar-parity `?v=1` → `?v=2`                                        |
| `docs/home-v2-preview.md`                     | edit    | refresh                                                              |
| `tests/unit/home-v2-hero-parity.test.js`      | **new** | markup + drift guard                                                 |
| `tests/unit/hero-collage-module.test.js`      | **new** | module contract                                                      |
| `e2e/home-v2-hero.spec.js`                    | **new** | behaviour                                                            |
| `tests/visual/visual-regression.spec.mjs`     | edit    | add `/home-v2-preview`                                               |

**Not touched:** `public/assets/css/home-v2.css` (shared with V3), `src/homepages/home-v2.ts`,
`public/assets/js/pages/home-v2.js`, `public/assets/js/pages/home-v2-parity.js`,
`public/assets/css/home-v2-parity.css`.

---

## 7. Test plan

### 7.1 Existing tests that could break

- `tests/integration/anonymous-public-render-path.test.js:72-93` asserts the literal strings
  `/assets/css/home-v2.css?v=11`, `/assets/js/pages/home-v2.js?v=11`,
  `/assets/js/utils/pexels-client.js?v=5`. **None of those three files change**, so these pass
  untouched — a deliberate reason to leave `home-v2.ts` alone. Re-check if that changes.
- `tests/unit/home-mobile-signup.test.js:40-53` reads `home-v2-navbar-parity.js` and asserts the
  `home-mobile-signup` asset versions. We only edit the **CSS**, so this passes; if the JS is ever
  touched, keep those two `?v=1.2.0` strings.
- `tests/unit/template-renderer-homepage-versions.test.js` — path resolution only, unaffected.
- `tests/unit/skeleton-loader-surface-compatibility.test.js:57` lists `public/home-v2.html` as a
  legacy skeleton consumer; the V2 skeleton markup we keep lives below the hero, so this holds —
  confirm after the swap.
- `e2e/admin-homepage-hardening.spec.js` — exercises the admin manager's `/home-v2-preview` path,
  not the hero. Unaffected.

### 7.2 New coverage

- **`tests/unit/home-v2-hero-parity.test.js`** — assert `home-v2.html` contains `hero hero-modern`,
  `ef-search-bar__form`, `ef-quick-tags`, `hero-collage`, `href="/community"` in both navs and in
  `.hero-modern-ctas`, and that `hv2-hero` / `hv2-search` / `hv2-popular` are gone. Plus a **drift
  guard**: extract the `<section class="hero hero-modern">` block from both `index.html` and
  `home-v2.html`, normalise whitespace, and assert they differ only by the Community CTA — so a
  future V1 hero edit can't silently desync V2.
- **`tests/unit/hero-collage-module.test.js`** — jsdom: module exposes `window.EFHeroCollage`,
  `load()` is idempotent under `window.__collageWidgetInitialized`, `validateUploadUrl` /
  `validatePexelsUrl` still reject non-HTTP(S) URLs.
- **`e2e/home-v2-hero.spec.js`** (static mode, `/home-v2-preview`) — search submits to
  `/suppliers?q=…&category=…`; empty submit is blocked and focuses the input; a quick tag fills the
  input and submits; the three CTAs point at `/start`, `/suppliers`, `/community`; nav Community →
  `/community`; the four collage cards link to `/category?slug=…`; the collage is `inert` and its
  links are out of the tab order.
- **Visual + a11y** — add `{ name: 'home-v2-preview', path: '/home-v2-preview', screenshotApproved: false }`
  to the `pages` list in `tests/visual/visual-regression.spec.mjs` (it currently covers `/` but not
  V2), then `npm run test:visual:update` to seed desktop + Pixel-5 baselines. The same list drives
  the axe-core scan, so this also gets V2 an accessibility gate for free.
- **V1 regression** — the existing `/` visual baseline plus a manual check of the collage rotation
  are the guard on the extraction. Verify with the admin collage widget enabled in both
  `pexels` and `uploads` source modes.

### 7.3 Commands

```
npm run lint
npx jest tests/unit/home-v2-hero-parity.test.js tests/unit/hero-collage-module.test.js \
         tests/unit/home-mobile-signup.test.js tests/unit/template-renderer-homepage-versions.test.js
npx jest tests/integration/anonymous-public-render-path.test.js
npm run test:e2e:static
npm run test:visual          # then :update to seed the new baselines
npm run typecheck:homepages  # no-op guard: home-v2.ts unchanged
```

### 7.4 Manual QA

Desktop 1920/1680/1440/1280, tablet 1024/834, mobile 430/390/360/320. Check: header gutter matches
V1 at every width; the ≥1024px two-column hero collapses to one column below 1024; quick tags stay
on one row (`ef-search-bar.js` trims trailing tags) and hide below 640px; the three CTAs wrap
sensibly; `prefers-reduced-motion: reduce` kills the mesh/blob/fade animations; keyboard tab order
skips the collage; signed-in state still swaps the auth pill, notification bell and dashboard links.

---

## 8. Risks

| #   | Risk                                                   | Mitigation                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Editing `home-v2.css` breaks homepage V3               | Plan requires **zero** edits to it; V3 renders from `index.html` + `hv2-*` classes we no longer use on V2. Verify `/home-v3-preview` before and after.                                                                                   |
| R2  | Collage extraction regresses the live V1 homepage      | Verbatim move in an isolated commit; keep every `window.__collage*` global; `/` visual baseline + manual widget check in both source modes.                                                                                              |
| R3  | Loading V1 stylesheets bleeds into V2's lower sections | Only `hero-modern.css`, `ef-search-bar.css` and `eventflow-brand.css` are loaded — selector inventories confirmed namespaced. `modern-landing.css` is transplanted, not loaded. Diff full-page screenshots above **and** below the fold. |
| R4  | Two search implementations coexist on the page         | The old `.hv2-search` form is removed with the hero, so `ef-search-bar.js` has exactly one `.ef-search-bar__form` to bind.                                                                                                               |
| R5  | Cached CSS/JS after deploy                             | `?v=` on every new asset; bump `home-v2-navbar-parity` to `?v=2` in the renderer.                                                                                                                                                        |
| R6  | Activating V2 at `/` exposes an unfinished hero        | Ships behind the existing admin homepage-manager switch; `/home-v2-preview` stays noindexed for review.                                                                                                                                  |

---

## 9. Suggested commit sequence

1. `Extract hero collage loader from home-init.js into a shared module` — pure move + `index.html`
   script tag + module unit test. Green on `/` before continuing.
2. `Port the V1 hero and wordmark into homepage V2` — `home-v2.html`, new bridge stylesheet,
   navbar-parity gutter fix, `home-v2-hero.js`, renderer `?v=2`.
3. `Add Community to homepage V2 navigation and hero CTAs` — nav, mobile nav, third CTA.
4. `Cover the V2 hero with unit, e2e and visual tests` — new specs + visual baselines.
5. `Refresh the V2 preview docs`.

**Estimate:** ~1 day. Step 1 is the bulk of it (~2,100 lines relocated and re-verified in two widget
modes); steps 2-3 are ~2 hours combined and already prototyped; step 4 is ~2 hours, mostly baseline
review.

---

## 10. Deferred follow-ups

1. ~~**Mock polish**~~ — **done, V2-only.** Organic blob/squircle collage shapes, teal line icons on
   the four quick tags and the `All categories` select, line-icon collage labels replacing the emoji,
   the shortened one-line subcopy and the `Search suppliers, packages, venues…` placeholder all
   landed in `public/assets/css/home-v2-hero-design.css` plus the V2 markup. The two heroes diverge
   deliberately: the design layer is scoped to `.home-v2-page` and no shared stylesheet was edited,
   so V1 and V3 keep the old hero. The markup drift guard that would have failed on this was
   replaced by a shared-hooks test — see `docs/home-v2-preview.md`.
2. **Prune dead code in `src/homepages/home-v2.ts`** — the Pexels hero-image rotation, popular-search
   and search-state handlers are inert once the old hero is gone. Removing them means a
   `build:homepages` run, a `home-v2.js` `?v=` bump and matching updates to
   `tests/integration/anonymous-public-render-path.test.js`.
3. **Header gutter bug on V3** — the same clamp pattern may exist elsewhere; worth a sweep.
