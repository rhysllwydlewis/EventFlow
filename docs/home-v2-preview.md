# EventFlow Homepage V2 Preview

Homepage V2 is a hidden alternative homepage. It shares its header with the live V1 homepage,
carries its own hero design on top of V1's hero markup and plumbing, and keeps its own lower
sections.

## Preview route

- `/home-v2-preview`
- `/home-v2-preview.html`

Both preview URLs are served from `public/home-v2.html` and protected from indexing by the
template renderer. `/home-v2` and `/home-v2.html` resolve to the same page.

## Indexing protection

Preview URLs receive an `X-Robots-Tag: noindex, nofollow` response header and an injected
`<meta name="robots" content="noindex,nofollow">` tag.

The live-ready file `public/home-v2.html` does not contain a hard-coded robots noindex tag,
so it can be served at `/` later without accidentally noindexing the real homepage.

## Live switch

The active homepage is chosen by the admin homepage manager (`getActiveHomepageVersion()`),
with `HOMEPAGE_VARIANT` as the environment fallback: `HOMEPAGE_VARIANT=v2` serves V2 at `/`,
and `HOMEPAGE_VARIANT=v1` or removing the variable rolls back.

Only switch after screenshots, mobile checks, analytics expectations and SEO checks have
been reviewed.

## Hero

The header is V1's — same wordmark lockup, same nav — plus a Community link in both
navigations. The hero started as V1's markup and now carries its own design:

- a wider, near-even two-column layout;
- a centred headline with a drawn teal underline under "In one place";
- a one-line subcopy in the accent blue;
- the category selector as a bordered chip with a grid glyph, and `Search suppliers,
packages, venues…` as the placeholder;
- teal line icons on the four quick tags and on the four collage labels, replacing the emoji;
- flat teal CTAs with outlined secondaries, including the third Community CTA;
- an overlapping organic collage — four blob/squircle cards instead of the 2×2 grid —
  from 1024px up, falling back to the shared grid below that.

That design lives in `public/assets/css/home-v2-hero-design.css`, layered on top of the
parity bridge below. It is **V2-only**: every rule is scoped to `.home-v2-page`, and no
shared stylesheet was edited, so V1 and V3 are untouched.

### Parity bridge

Two constraints govern how the hero was brought over in the first place, and they still
hold:

- **`home-v2.css` must not be edited.** The template renderer builds homepage V3 from
  `index.html` plus `home-v2.css`, and most of that file's rules are unscoped, so a change
  there restyles V3. The hero uses V1's class names (`hero-modern`, `ef-search-bar`,
  `hero-collage`) rather than `hv2-*`, so the shared rules stop matching on V2 and keep
  working for V3.
- **Only namespaced V1 stylesheets may be loaded.** `hero-modern.css`, `ef-search-bar.css`
  and `eventflow-brand.css` are safe. `modern-landing.css`, `styles.css` and
  `design-system.css` are not — they restyle `html`, `.ef-section`, `.ef-card` and
  `.container` globally — so the hero rules and tokens V1 inherits from them are
  transplanted into `public/assets/css/home-v2-hero-parity.css`, scoped to `.home-v2-page`.

`tests/unit/home-v2-hero-parity.test.js` enforces both. Because the two heroes now diverge by
design, it no longer diffs their markup — instead it pins the ids and class names both pages'
shared scripts look up. `tests/unit/home-v2-hero-design.test.js` guards the design layer's
scoping and the markup it styles, and asserts V1 still has its own copy and emoji.

## Hero collage

The collage is shared. `public/assets/js/collage/hero-collage.js` owns the admin collage
widget (`/api/v1/public/homepage-settings`), the legacy Pexels path, media cycling, creator
credits, lazy loading, the stall watchdog and the hidden hero video card, and exposes
`window.EFHeroCollage`. V1 drives it from `home-init.js`; V2 from
`public/assets/js/pages/home-v2-hero.js`. It must load before either.

## Key files

| File                                          | Role                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| `public/home-v2.html`                         | The page                                                   |
| `public/assets/css/home-v2.css`               | Base V2 styles — **shared with V3, do not edit**           |
| `public/assets/css/home-v2-parity.css`        | V2-only overrides                                          |
| `public/assets/css/home-v2-navbar-parity.css` | V2 header; injected by the renderer                        |
| `public/assets/css/home-v2-hero-parity.css`   | Scoped bridge for the ported V1 hero                       |
| `public/assets/css/home-v2-hero-design.css`   | V2-only hero design, layered over the bridge               |
| `public/assets/js/pages/home-v2.js`           | Compiled from `src/homepages/home-v2.ts` — never hand-edit |
| `public/assets/js/pages/home-v2-parity.js`    | Lower-section data wiring                                  |
| `public/assets/js/pages/home-v2-hero.js`      | Collage bootstrap                                          |
| `public/assets/js/collage/hero-collage.js`    | Shared collage module                                      |
| `utils/template-renderer.js`                  | Preview routing, navbar parity injection, noindex          |
| `scripts/serve-static.js`                     | Mirrors the preview routes for E2E and visual runs         |

## QA checklist

- `/` still serves the active homepage version by default.
- `/home-v2-preview` and `/home-v2-preview.html` serve the V2 homepage.
- Preview URLs are noindexed.
- `HOMEPAGE_VARIANT=v2` serves V2 at `/`.
- The hero holds up at 1920, 1680, 1440, 1280, 1024, 834, 430, 390, 360 and 320px: the quick
  tags drop trailing pills rather than truncating labels, the search value never runs under
  the submit button, and the collage keeps its aspect ratio.
- The collage is four organic shapes from 1024px up and the shared 2×2 grid below it.
- `/` still shows V1's hero — emoji collage labels, long subcopy, no chip icons.
- Search submits to `/suppliers` with `q` and/or `category`; an empty search does not navigate.
- Quick tags fill the search and submit.
- Hero CTAs point at `/start`, `/suppliers` and `/community`; the CTA row wraps below 480px.
- Community appears in the header nav, the mobile menu and the hero.
- Collage cards link to `/category?slug=…` and stay out of the keyboard tab order.
- The header shows the navigation or the hamburger, never both.
- Marketplace links point to `/marketplace`; supplier CTA to `/for-suppliers`; login to `/auth`.
- Mobile menu opens, closes and is keyboard dismissible.
- `/home-v3-preview` still renders the video hero (V2 and V3 share `home-v2.css`).
