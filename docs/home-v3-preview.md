# EventFlow Homepage V3

V3 now uses the approved homepage concept: the original EventFlow wordmark and teal palette, animated supplier-photo bubbles, supplier categories and locations, featured and hourly spotlight packages, interactive wedding website/RSVP/seating samples, planning steps, guides, marketplace and supplier plans.

## Routes and isolation

`/home-v3`, `/home-v3.html`, `/home-v3-preview` and `/home-v3-preview.html` resolve to `public/home-v3.html`. All four receive the existing preview `noindex, nofollow` meta tag and response header. HTML remains private/no-store through the template renderer.

The regular homepage and V2 templates are unchanged. This PR does not change the active homepage version. Selecting V3 in the existing Homepage Manager will serve its dedicated template at `/`; that root route does not inherit preview-only indexing restrictions.

V3 no longer transforms the V1 hero or loads the previous V2/video style and script stack. The superseded V3 video assets have been removed. V1 guidance/display toggles and legacy V3 video controls do not configure this independent design.

## Content and interactions

- Search uses a normal GET form to `/suppliers` with `category` and `location`. Internal links stay on the current EventFlow origin.
- Featured and spotlight cards use `/api/packages/featured` and `/api/packages/spotlight`. Marketplace cards use `/api/v1/marketplace/listings?limit=3`. These sections load as they approach the viewport, with empty/error states linking to the relevant browse pages. Captured listing titles/prices from the design artifact are not shipped.
- Locations use `/api/v1/locations/featured?limit=6`, including current supplier counts and published city URLs. The fallback has valid supplier-search links and no captured counts.
- Category photos use `/api/v1/categories`, with optimised local fallback photos. Brand artwork comes from the existing `/assets/brand/` files. Self-hosted Inter is subsetted to WOFF2.
- The original shared `eventflow-footer` component, stylesheet and brand rules render the footer and bind the real newsletter and cookie controls. V3 does not fork the footer markup or submit a second newsletter handler.
- Wedding RSVP and seating changes are explicitly labelled as samples. They remain in memory, reset locally and never modify an actual wedding or guest list. The account CTA opens the existing real wedding tools.
- Photo motion respects reduced motion, visibility, hover/focus and the pause button. Navigation, carousels, FAQs and wedding controls support keyboard use. Signed-in account links use the existing auth state manager.

## Source and validation

The page uses HTML/CSS and TypeScript compiled to plain JavaScript. Edit `src/homepages/home-v3-concept.ts`, then run `npm run build:homepages` and commit the generated `public/assets/js/pages/home-v3-concept.js`.

Run `npm run typecheck:homepages`, lint the changed JavaScript/CSS, and run the V3 routing tests alongside existing homepage renderer/guidance/brand checks. Review the page on phone, tablet and desktop widths, including live-feed success, failure and empty responses, search, navigation, motion controls, wedding RSVP/seating/reset and the original footer.
