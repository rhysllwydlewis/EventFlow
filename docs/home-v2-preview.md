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

### Collage geometry

The collage is not eyeballed. It is a 757 × 659 box (`aspect-ratio: 757 / 659`) measured
from the design, with each card a fixed percentage of it:

| Card          | Left   | Top    | Width  | Height | z   |
| ------------- | ------ | ------ | ------ | ------ | --- |
| Venues        | 0%     | 0%     | 85.2%  | 74.96% | 1   |
| Catering      | 62.35% | 3.64%  | 37.65% | 39.3%  | 3   |
| Entertainment | 3.3%   | 54.78% | 40.16% | 43.1%  | 4   |
| Photography   | 59.05% | 53.72% | 40.82% | 46.28% | 4   |

The overlaps are the composition — catering and photography sit over the feature card,
entertainment over its lower left — so this must not be flattened back into a grid. Each
card takes its own `clipPath` in `objectBoundingBox` units (the four `#hv2-mask-*` defs in
`home-v2.html`) so the silhouettes scale with the box; `border-radius` cannot express them
because it only ever draws four elliptical quadrants.

The boxes above are measured; the silhouettes are traced. Catering, entertainment and
photography are superellipses — a straight run along each edge joined by large, unequal
corner arcs — generated from per-corner radii of roughly 0.3 of each side. The feature card
is the exception: in the design it has almost no straight edge, so its corner radii run to
0.5 and it reads as an organic blob with a shoulder about 37% across the top and its widest
point about 42% down the left. Radii that make the other three read correctly make the
feature card read as a rounded rectangle, which is the single most visible way to get this
composition wrong.

The mask sits on the card's media and on a `::before` inset by `-3px`, not on the card
itself, so the white backing can follow the same contour 3px outside the image and read as
a separator. That means `overflow` and paint containment have to come off the card, and the
depth moves from `box-shadow` (which a clipped subject drops) to a soft `drop-shadow()`
filter. The numbers and the separator are pinned by `tests/unit/home-v2-hero-design.test.js`
and, at runtime, by `e2e/home-v2-hero.spec.js`.

Each card names its own shape in `--hv2-mask` and one rule applies it to `::before`, `img`
**and** `video`. The collage swaps a card's `<img>` for a `<video>` whenever the admin
widget serves a clip, copying the image's (empty) class list over, so anything that only
names `img` leaves video cards as bare rectangles on top of a masked white backing.

The collage carries no creator credit. `.hero-collage-credit` is the static pill in the
markup; `.pexels-credit` is the one the collage module appends at runtime, and V2 does not
carry V1's inline styles for it, so an uncaught one renders as raw text over the photograph.
Both are hidden on V2. The Pexels licence does not require attribution.

### Hero height

The hero is the fold, so its height is deliberate rather than incidental. Whichever column
is taller sets the row, and on desktop that is usually the collage, whose height follows its
width through the aspect ratio.

That puts a floor under how short the hero can be without shrinking the collage — and
shrinking the collage costs the design's proportions, since it is 757 of the reference's 1672. So the height comes out of the padding above and below the content instead, and out
of the CTA row below. The design's own hero is 941px tall at 1672; this one is 794px with
the same proportions.

The CTA row is the trap. Three CTAs at full size occupy 713px against a column of
`(93vw - 4vw) / 2`, so they only fit from about 1602px up; below that Community wraps onto
a second row and adds 76px. Hence two tightening bands — 1024–1619px, and a further step at
1024–1154px where even the tightened row needs more than the column has. `e2e/home-v2-hero.spec.js`
measures the row at six widths and fails on a wrap; it disables transitions first, because
the CTAs animate `all` for 0.3s and a measurement taken straight after a resize reads the
old size.

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
