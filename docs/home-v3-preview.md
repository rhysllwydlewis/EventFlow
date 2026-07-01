# EventFlow Homepage V3 Preview

V3 is a controlled preview that keeps the live V1 homepage structure and sections, but replaces the V1 hero with the polished V2 hero.

## Preview route

- `/home-v3-preview`
- `/home-v3-preview.html`
- `/home-v3`
- `/home-v3.html`

All V3 preview URLs are served from the current V1 homepage template at `public/index.html`, then transformed by the template renderer.

## What V3 does

- Keeps V1 content and ordering below the hero, including featured packages, spotlight packages, category browsing, trust cards, launch copy, marketplace, guides, how it works, supplier CTA, newsletter, footer and mobile navigation.
- Swaps only the V1 hero section for the V2 hero search experience.
- Loads the V2 hero base CSS plus a small V3 scoped stylesheet so the V2 hero can sit above V1 content without restyling the rest of the page.
- Loads the V2 hero script so popular searches and rotating hero imagery continue to work.

## Indexing protection

V3 preview URLs receive an `X-Robots-Tag: noindex, nofollow` response header and an injected `<meta name="robots" content="noindex,nofollow">` tag.

## QA checklist

- `/` still serves V1 by default.
- `/home-v2-preview` still serves V2.
- `/home-v3-preview` serves V1 below the hero and V2 for the hero only.
- Preview URLs are noindexed.
- V3 search submits to `/suppliers`.
- V3 popular search chips populate/submit correctly.
- V1 sections below the hero retain their existing IDs so package, category, marketplace and guide scripts still hydrate.
- Mobile header, mobile menu and bottom navigation still come from V1.
