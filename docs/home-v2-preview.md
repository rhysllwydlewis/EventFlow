# EventFlow Homepage V2 Preview

This branch adds a hidden premium homepage V2 while keeping the current homepage untouched.

## Preview route

- `/home-v2-preview`
- `/home-v2-preview.html`

Both preview URLs are served from `public/home-v2.html` and protected from indexing by the
template renderer.

## Indexing protection

Preview URLs receive an `X-Robots-Tag: noindex, nofollow` response header and an injected
`<meta name="robots" content="noindex,nofollow">` tag.

The live-ready file `public/home-v2.html` does not contain a hard-coded robots noindex tag,
so it can be served at `/` later without accidentally noindexing the real homepage.

## Future live switch

The current homepage remains the default. To switch V2 live later, set
`HOMEPAGE_VARIANT=v2`. To roll back, set `HOMEPAGE_VARIANT=v1` or remove the variable.

Only switch after screenshots, mobile checks, analytics expectations and SEO checks have
been reviewed.

## Files added

- `public/home-v2.html`
- `public/assets/css/home-v2.css`
- `public/assets/js/pages/home-v2.js`

## Files changed

- `utils/template-renderer.js`

## QA checklist

- `/` still serves the existing V1 homepage by default.
- `/home-v2-preview` serves the V2 homepage.
- `/home-v2-preview.html` serves the V2 homepage.
- Preview URLs are noindexed.
- `HOMEPAGE_VARIANT=v2` serves V2 at `/`.
- Search form submits to `/suppliers`.
- Marketplace links point to `/marketplace`.
- Supplier CTA points to `/for-suppliers`.
- Login link points to `/auth`.
- Mobile menu opens, closes and is keyboard dismissible.
