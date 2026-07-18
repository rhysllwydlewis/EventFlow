# EventFlow current state

**Verified:** 18 July 2026  
**Verification base:** `main` at `5fe6c87e8329740f2eccca6398f2a7d65b885278`, plus the changes in the pull request that introduced this document.

This file is the repository's concise current-state record. Open GitHub issues are the source of truth for unfinished work. Historical roadmaps and implementation summaries are evidence of previous work, not active backlogs.

## Production and deployment

- EventFlow is deployed through Railway from `main`.
- The production process starts with `services/deploymentMetadataPreload.js`, which cannot block the HTTP server if metadata generation fails.
- Railway and Docker use the same startup path.
- `/api/health`, `/api/ready` and `/deployment.json` are monitored by the scheduled Production Synthetics workflow.
- The canonical public origin is `https://event-flow.co.uk`; the `www` host must redirect to it rather than serve a separate cached release.
- Public HTML responses are marked no-store by the application. Cloudflare rules must preserve the canonical redirect and must not pin different HTML releases to the two hostnames.

## Security operations

- GitHub secret-scanning, code-scanning and Dependabot counts are dynamic and must not be copied into documentation as fixed totals.
- The Security Alert Inventory workflow generates a sanitised weekly register and maintains one GitHub issue while alerts remain open.
- Provider credentials must be rotated or revoked by an authorised account owner. A pull request cannot perform provider-side rotation.
- Major framework, database and browser-library upgrades require dedicated migration pull requests.

## Public product areas confirmed in the repository

- Customer event planning wizard and saved planning state.
- Supplier directory, supplier profiles, packages, messaging and reviews.
- Supplier and customer dashboards.
- Admin homepage versions, media assignment and publishing controls.
- Marketplace listing, filtering, seller messaging and account journeys.
- Stripe subscription routes and supplier pricing plans.
- Email verification and supplier verification workflows.
- Public guides, sitemap, robots file and SEO metadata.

This list confirms that the areas exist. It is not a claim that every journey is defect-free or commercially complete.

## Backend API state

- Supplier photo list, upload, delete and reorder endpoints are implemented in `routes/suppliers-v2.js`.
- Supplier analytics storage and tracking are implemented through `services/analyticsService.js`, supplier routes and analytics routes.
- Lead quality is calculated and stored for supplier-facing lead journeys.
- Marketplace listing CRUD and supplier search APIs are implemented.
- Health, readiness, configuration and deployment identity endpoints are production monitored.

Detailed endpoint behaviour should be verified against route files and automated tests. `docs/api/BACKEND_APIS_STATUS.md` is a navigation summary, not an independent backlog.

## Test state

- Current real-server backend journeys are listed in `e2e/backend-suite-classification.json`.
- This pull request increases the blocking set from 10 to 12 specification files by restoring current supplier-directory and planning-wizard coverage.
- Eight historical suites remain quarantined with a specific repair reason.
- Issue #1355 is the authoritative burn-down list for the remaining quarantine.
- A quarantined suite must be rewritten against current behaviour or deleted with evidence that the journey no longer exists.

## Documentation rules

1. Every active status document must show a verification date and commit or pull request.
2. Completed implementation plans belong under `docs/history/`.
3. A TODO in documentation is not authoritative unless it links to an open GitHub issue.
4. Before proposing feature work, verify the current route, UI, tests and production behaviour.
5. Contradictions between documentation and code must be resolved by updating or archiving the document, not by rebuilding an existing feature.

## Known active work

- GitHub security-alert triage and credential rotation where required.
- Remaining backend Playwright quarantine tracked in issue #1355.
- Canonical-host and public-content consistency monitored by Production Synthetics.

For any other proposed task, first confirm it against current `main` and the live canonical site.
