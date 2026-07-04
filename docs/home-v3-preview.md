# EventFlow Homepage V3 Preview

V3 is a controlled preview that keeps the live V1 homepage structure and sections, but replaces the V1 hero with a bespoke V3 hero experience built on the V2 search and rotating-image foundations.

## Preview route

- `/home-v3-preview`
- `/home-v3-preview.html`
- `/home-v3`
- `/home-v3.html`

All V3 preview URLs are served from the current V1 homepage template at `public/index.html`, then transformed by the template renderer.

## What V3 does

- Keeps V1 content and ordering below the hero, including featured packages, spotlight packages, category browsing, trust cards, launch copy, marketplace, guides, how it works, supplier CTA, newsletter, footer and mobile navigation.
- Swaps only the V1 hero section for the bespoke V3 hero.
- Keeps the same search contract: `category`, `eventType`, `location` and `q` submit to `/suppliers`.
- Adds a premium editorial hero layout with proof chips, a planning preview stage, floating supplier cards and a lightweight live plan console.
- Loads the V2 hero base CSS plus a V3 scoped stylesheet so the hero can sit above V1 content without restyling the rest of the page.
- Loads the V2 hero script so popular searches and rotating hero imagery continue to work, plus the V3 script for the custom event select, guide overlays and plan-console state.

## Indexing protection

V3 preview URLs receive an `X-Robots-Tag: noindex, nofollow` response header and an injected `<meta name="robots" content="noindex,nofollow">` tag.

## QA checklist

- `/` still serves V1 by default.
- `/home-v2-preview` still serves V2.
- `/home-v3-preview` serves V1 below the hero and the bespoke V3 hero above it.
- Preview URLs are noindexed.
- V3 search submits to `/suppliers`.
- V3 popular search chips populate/submit correctly.
- V3 custom event select updates the hidden `eventType` input.
- V3 planning console responds to search field interaction without blocking form submission.
- V1 sections below the hero retain their existing IDs so package, category, marketplace and guide scripts still hydrate.
- Mobile header, mobile menu and bottom navigation still come from V1.
