# Homepage Lower-Section Approved Design — Handoff

## Purpose

This pull request updates the **production EventFlow homepage (`/`, served from `public/index.html`) from “Browse suppliers by category” down to the footer**. The hero, search, featured packages and spotlight packages above that point are deliberately untouched.

The visual target is the approved EventFlow concept supplied by Rhys in ChatGPT on 24 July 2026. The requested treatment is:

1. Eight category image cards in a four-by-two desktop grid, each with a **white circular line icon overlapping the image and content area**.
2. One pale-mint horizontal strip containing all four platform benefits.
3. Three compact numbered early-access cards with stronger line illustrations.
4. One wide featured marketplace item: image left, real item details centre, marketplace CTA right.
5. Three equal-height guide cards with image, category, title, description and read time.
6. Remove the redundant “How It Works” section.
7. A dark-green, image-led supplier banner with No Commission, Verified Leads and Easy Setup benefits, followed by a lower information strip.
8. A compact pale-mint horizontal newsletter bar.
9. A taller dark-green footer with improved spacing, brand statement, social links and an Account column.

## Architecture

The production entrypoint is `public/index.html`. It directly loads the cache-busted homepage-only assets:

- `/assets/css/homepage-approved-lower.css?v=3`
- `/assets/js/pages/homepage-approved-lower.js?v=3`
- `/assets/js/components/eventflow-footer.js?v=3`

Direct entrypoint wiring was added after visual verification showed that relying only on dynamically injected assets could be defeated by stale cached footer assets. The direct references guarantee that the approved lower-page treatment runs on the production homepage. The JavaScript and CSS remain scoped to the production homepage, and other pages retain their existing footer behaviour.

## Authoritative changed files

- `public/index.html`
  - Directly loads the cache-busted approved stylesheet, enhancement script and footer component.
  - Leaves the hero, search and package sections above the category area unchanged.
- `public/assets/js/components/eventflow-footer.js`
  - Keeps the existing newsletter submission and cookie-preference behaviour.
  - Adds the approved homepage footer statement and Account column only on `/`.
  - Avoids duplicate dynamic asset injection when the production entrypoint already supplies the approved assets.
- `public/assets/js/pages/homepage-approved-lower.js`
  - Rebuilds the homepage sections from categories through the supplier CTA.
  - Preserves the existing live endpoints and public routes.
  - Reasserts the approved marketplace and guide markup if the legacy homepage loader completes later and overwrites those containers.
  - Fetches admin-managed categories from `/api/v1/categories` and renders them with the approved markup; the legacy `CategoryGrid` loader is not run on the production homepage, so there is nothing to reassert against for categories (see "Category cards" below).
  - Uses same-origin EventFlow imagery for the approved lower-page enhancement, and falls back to a fixed hardcoded category list only if the live category fetch fails or is empty.
- `public/assets/css/homepage-approved-lower.css`
  - Contains the full desktop, tablet and mobile treatment.
  - Is scoped under `body.ef-approved-lower-home`.
  - Uses the repository’s approved customer-facing type scale.
- `tests/unit/homepage-approved-lower.test.js`
  - Guards direct production entrypoint wiring, required section markers, live data sources, same-origin imagery, scoping and unsupported-metric avoidance.
- `tests/visual/__screenshots__/visual-regression.spec.mjs/homepage-desktop-chromium.png`
  - Stores the reviewed Chromium desktop baseline for the approved production homepage.
- `tests/visual/__screenshots__/visual-regression.spec.mjs/homepage-mobile-chromium.png`
  - Stores the reviewed Chromium mobile baseline for the approved production homepage.
- `package.json`
  - Updates the audited `brace-expansion` and `filelist` overrides to secure compatible versions.
  - Pins Prettier `3.7.4` so local and CI formatting use the same verified formatter output.
- `package-lock.json`
  - Regenerated from a clean install so the verified dependency and formatter resolutions are reproducible in CI and deployment.
- `docs/HOMEPAGE_LOWER_APPROVED_DESIGN_HANDOFF.md`
  - Records the implementation contract, audit corrections, verification and continuation rules.

The earlier draft implementation against `home-v2.html` was removed. `public/assets/js/pages/home-v2.js` is restored to its generated source so `npm run typecheck:homepages` and generated-asset parity remain valid.

## Data contracts

### Marketplace

Endpoint: `GET /api/v1/marketplace/listings?limit=12`

The enhancement selects the strongest available real listing using featured status, image availability, description completeness and recency. It displays the live title, GBP price, description, category, condition and location. If no listing is available, it shows a styled honest empty state rather than fabricated content.

### Guides

Source: `/assets/data/guides.json`

The first three published guides are displayed using their real `href`, `category`, `description` and `readingMins` values. Their thumbnails use same-origin EventFlow imagery so the homepage does not set third-party image cookies or depend on an external image host. This avoids the broken draft routes that previously appeared in the PR while keeping the guide content and destinations live.

### Category cards

Endpoint: `GET /api/v1/categories`

Updated (see continuation notes): the category cards now render the admin-managed categories from this endpoint (name, hero image, description, visibility, order), using the same approved markup and styling. Admin hero images are same-origin uploads (`POST /api/admin/categories/:id/hero-image`), not third-party requests, so the original reliability concern no longer applies. The eight-category hardcoded list in `homepage-approved-lower.js` is kept only as a fallback — used when the fetch fails or returns no visible categories — so the section can never render blank. There is no longer a MutationObserver reasserting this section; the legacy `CategoryGrid` component is not instantiated on the production homepage (see `home-init.js`), so there is nothing left to reassert against.

## Truthfulness decision

The concept image included example figures such as `1,000+ suppliers`, `5,000+ events planned` and `4.9★`. Those figures are not introduced because the repository does not establish them as current public facts. The **same four-column visual strip is retained**, using truthful product statements instead:

- Growing network — Across the UK
- 100% — Your booking fees
- Direct — Customer enquiries
- UK based — Local support

Do not replace these with numerical claims unless they are driven by a verified live endpoint.

## Security audit correction

A fresh high-severity transitive advisory appeared during the PR audit for `brace-expansion <=5.0.7`, affecting the existing dependency graph even though the homepage work did not originally change dependencies.

The verified resolution is:

- global `brace-expansion` override: `5.0.8`;
- `filelist`: `2.0.2`;
- `filelist` → `minimatch`: `10.2.5`;
- `filelist` → `brace-expansion`: `5.0.8`.

The lockfile was regenerated from a clean state. A clean `npm ci`, ESLint, the targeted homepage/type-scale tests and the production high-severity audit all passed with the candidate before it was committed. The resulting production audit has **zero high and zero critical vulnerabilities**; the remaining findings are moderate Sentry/OpenTelemetry items requiring a separate major-version review and are outside this homepage PR’s scope.

## Responsive behaviour

- Desktop: four category columns, four-benefit strip, three steps, three guides, split supplier banner and five-column footer.
- Tablet: two category/benefit/guide columns, stacked marketplace, responsive supplier image and footer.
- Mobile: single-column categories and benefits, compact guide media cards, stacked supplier statistics, single-column newsletter form and footer.

## Verification commands

```bash
node --check public/assets/js/components/eventflow-footer.js
node --check public/assets/js/pages/homepage-approved-lower.js
npm run check:lockfile
npm ci --prefer-offline --no-audit
npm run format:check
npm run lint
npm run typecheck:homepages
npm test -- --runInBand --coverage=false tests/unit/homepage-approved-lower.test.js tests/unit/type-scale.test.js
npm run test:e2e:static
npm run audit
```

## Completed audit verification

The final correction workflow completed successfully with:

- JavaScript syntax checks;
- clean lockfile verification and installation;
- repository formatting and ESLint;
- homepage TypeScript and generated-asset parity;
- targeted homepage and type-scale unit tests;
- production dependency audit;
- regenerated Chromium desktop and mobile homepage visual baselines.

Also review the root homepage at desktop, tablet and mobile widths. Confirm:

- no changes above “Browse suppliers by category”;
- exactly eight category cards with overlapping white circular icons;
- no separate floating benefit cards;
- no “How It Works” section;
- marketplace and guide content comes from live data;
- homepage enhancement images are same-origin and do not request `images.pexels.com`;
- supplier CTA, newsletter and footer match the approved composition;
- keyboard focus remains visible on all links and controls.

## Continuation notes for Claude or another agent

1. Work only on the existing PR branch; do not merge without Rhys’s approval.
2. Treat this document and the PR description as the implementation contract.
3. Review the current ten-file diff against `main`; do not treat superseded early commits as the desired implementation.
4. Keep the cache-busted approved assets directly wired into `public/index.html`.
5. Do not move the change back into `home-v2.html`; the production homepage is `public/index.html`.
6. Do not edit generated homepage assets directly. `public/assets/js/pages/home-v2.js` is generated from `src/homepages/home-v2.ts` and must remain in parity.
7. Preserve live marketplace and guide data. Do not hard-code a sample product or broken article route.
8. Preserve the no-fabricated-metrics rule.
9. Preserve the verified dependency overrides, formatter pin and regenerated lockfile unless replacing them with an independently tested safer resolution.
10. Before handing back, wait for every required GitHub Actions check to complete and fix all relevant failures on the PR branch.

## Audit history

The first draft of this PR targeted `public/home-v2.html`, which is not the production root homepage shown in Rhys’s screenshot. The audit corrected that error before merge by removing every draft Home V2 stylesheet, restoring the generated `public/assets/js/pages/home-v2.js` asset, and rebuilding the work against the real production homepage hooks.

The audit also removed broken draft article routes, replaced a fabricated sample marketplace item with live marketplace data, corrected formatting and ESLint findings, added contract tests, remediated a newly surfaced high-severity transitive dependency advisory, replaced enhancement-owned third-party images with same-origin assets, and used visual-regression output to identify and fix the production asset-loading path.

The **current ten-file diff against `main` is authoritative**. Earlier commits remain visible in the branch history for transparency, but another agent should review and continue from the final diff rather than treating those superseded commits as the intended implementation.
