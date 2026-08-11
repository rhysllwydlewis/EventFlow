# EventFlow Homepage V2 Preview

Homepage V2 is a hidden alternative homepage. It shares its header and hero with the live V1
homepage and keeps its own lower sections.

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

## Hero parity with V1

The header and hero are V1's, markup for markup — same wordmark lockup, same headline and
underline, same unified search bar, same quick tags, same 2×2 category collage. V2 adds a
Community link to both navigations and a third Community hero CTA.

Two constraints govern how that was done:

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

`tests/unit/home-v2-hero-parity.test.js` enforces both, and carries a drift guard that fails
if the two heroes diverge by anything other than the Community CTA.

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
- The hero matches V1 at 1920, 1680, 1440, 1280, 1024, 834, 430, 390, 360 and 320px.
- Search submits to `/suppliers` with `q` and/or `category`; an empty search does not navigate.
- Quick tags fill the search and submit.
- Hero CTAs point at `/start`, `/suppliers` and `/community`; the CTA row wraps below 480px.
- Community appears in the header nav, the mobile menu and the hero.
- Collage cards link to `/category?slug=…` and stay out of the keyboard tab order.
- The header shows the navigation or the hamburger, never both.
- Marketplace links point to `/marketplace`; supplier CTA to `/for-suppliers`; login to `/auth`.
- Mobile menu opens, closes and is keyboard dismissible.
- `/home-v3-preview` still renders the video hero (V2 and V3 share `home-v2.css`).
