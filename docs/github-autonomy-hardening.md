# EventFlow autonomous quality and GitHub hardening

This document separates controls implemented in the repository from controls that must be enabled in GitHub or Railway settings. Repository workflows cannot silently change organisation/repository security settings, branch rules or environment secrets.

## Automated checks added by this change

### Pull requests

| Check                          | Purpose                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Build Verification             | Existing aggregate lint, formatting, smoke, full regression, security and production-image gate.    |
| Browser Verification           | Existing blocking Chromium auth, static E2E and visual prerequisite gate.                           |
| Dedicated Visual Verification  | Existing blocking visual regression and axe accessibility gate.                                     |
| Backend E2E                    | Runs backend browser journeys against a real MongoDB replica set.                                   |
| Changed executable lines (80%) | Requires newly changed instrumented JavaScript lines to be covered.                                 |
| Dependency delta security      | Blocks new high/critical dependency vulnerabilities introduced by a PR.                             |
| CodeQL Advanced                | Runs Actions and JavaScript/TypeScript security-extended queries.                                   |
| Lighthouse desktop/mobile      | Runs three samples per URL with blocking performance, accessibility, best-practice and SEO budgets. |
| Resource leaks and mutation    | Runs focused open-handle, fuzz, migration and mutation checks when their foundations change.        |

### Scheduled checks

| Cadence                 | Check                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Every two hours         | Read-only production deployment identity, health, readiness, config, public pages, robots and sitemap synthetics. |
| Nightly Monday-Saturday | CI-depth classified test audit with automatic issue creation and recovery closure.                                |
| Sunday                  | Full test audit including backend, visual, accessibility and dependency checks.                                   |
| Sunday                  | Full open-handle detection without Jest `forceExit`, deterministic fuzzing and migration idempotency.             |
| Sunday                  | Focused mutation testing for geocoding and provider-failure contracts.                                            |
| Sunday                  | Firefox, WebKit, desktop and mobile Playwright matrix.                                                            |
| Sunday                  | Read-only Artillery load thresholds against the configured staging URL.                                           |
| Tuesday and Friday      | Three-run desktop and mobile Lighthouse budgets.                                                                  |
| Friday                  | CodeQL scheduled deep scan.                                                                                       |
| Weekly                  | Dependabot grouped npm and GitHub Actions update PRs.                                                             |

## Backend suite classification

The first broad real-server run discovered 210 historical `@backend` tests. It completed with 164 expected results, 43 unexpected attempts and 3 flaky attempts. The failures were concentrated in mixed-purpose historical specs that still expected removed admin or supplier interfaces, used `networkidle` on pages with persistent sockets, or asserted retired validation behaviour.

The pull-request gate now runs ten current blocking spec files against the real application and a MongoDB replica set. Eleven historical files are listed in `e2e/backend-suite-classification.json` with specific repair reasons. `scripts/run-backend-e2e.mjs` fails before launching Playwright when any `@backend` file is missing, stale, duplicated, both blocking and quarantined, or left unclassified. New backend tests therefore cannot silently escape either the blocking set or visible repair debt.

The quarantine is not treated as a pass. The full diagnostic set remains runnable with:

```bash
npm run test:e2e:backend -- --include-quarantined --project=chromium
```

A quarantined file should return to the blocking set only after its fixtures and assertions represent the current product and it passes repeatedly against the real server. GitHub issue #1355 tracks that work.

## Lighthouse regression baselines

Lighthouse uses the pessimistic result from three runs so one poor sample cannot be hidden by two stronger samples. These are regression floors based on the measured pre-existing pages, not claims that the current experience is ideal.

- Desktop pages require performance 70, accessibility 90 and SEO 90. Most pages require best practices 85. Guides and article pages currently use a best-practices floor of 70 because third-party cookie diagnostics and the expected logged-out auth response reduce the measured score.
- Mobile pages require accessibility 90, best practices 80 and SEO 90. Marketplace and pricing require performance 60. The homepage currently has a performance floor of 50 after its three-run audit measured 55, 62 and 61.
- The existing suppliers mobile page has a performance floor of 35 and a cumulative-layout-shift ceiling of 0.70. The initial three-run baseline was 37 with substantial unused public assets and layout movement. This explicit exception prevents further regression while leaving a measurable optimisation target instead of making every pull request permanently red.

Raise the exceptional floors after the underlying public-page work lands. Do not lower them merely to clear a failing pull request.

## Required repository settings

Apply a ruleset to `main` with these controls:

1. Require a pull request before merging.
2. Require the branch to be up to date before merging.
3. Require all conversations to be resolved.
4. Require review from Code Owners for protected paths.
5. Block force pushes and branch deletion.
6. Do not permit coding agents or repository administrators to bypass failed required checks for ordinary merges.
7. Require these status checks when they are present on the pull request:
   - `Build Verification`
   - `Mongo Replica Set Transactions`
   - `Browser Verification`
   - `Dedicated Visual Verification`
   - `Mongo-backed browser journeys`
   - `Changed executable lines (80%)`
   - `Dependency delta security`
   - CodeQL JavaScript/TypeScript and Actions analysis
   - `Lighthouse desktop`
   - `Lighthouse mobile`
   - `Resource leaks, fuzzing and migrations`
   - `Focused mutation score`
8. Allow auto-merge only for reviewed, low-risk dependency patch updates after every required check succeeds. Authentication, payments, database migrations, deployment, permissions and workflow changes must remain human-approved.

## Required security settings

In **Settings → Code security and analysis**:

- enable Dependabot alerts and security updates;
- enable secret scanning and push protection;
- enable validity checks where GitHub supports the secret type;
- keep CodeQL/default code scanning alerts visible and triaged.

In **Settings → Actions → General**:

- set the default `GITHUB_TOKEN` permission to read repository contents;
- allow write permissions only in explicitly scoped jobs;
- require actions to be pinned to a full commit SHA after the current migration inventory is cleared.

New third-party Actions introduced by this change are pinned to reviewed 40-character commits. The scheduled `Immutable GitHub Action reference inventory` deliberately begins in warning mode because older workflows still use version tags. Dependabot maintains those references while each existing action is migrated. Change `ACTION_PIN_ENFORCEMENT` to `error` once the inventory reaches zero.

## Required environments and secrets

### Production environment

- `APP_URL`: canonical deployed application URL used by deployment verification.
- Railway must expose `RAILWAY_GIT_COMMIT_SHA` to the runtime. The startup script writes it to `public/deployment.json`.
- Use environment protection and required reviewers for manual production deployments.

The deployment workflow waits for `deployment.json` to report the exact target commit before running health/readiness checks. Production synthetics also require a real 40-character deployment SHA. A healthy previous release or an `unknown` placeholder can no longer make a new deployment appear successful.

Synthetic reports persist only fixed check paths, local durations and controlled outcome labels. Raw remote error messages, response bodies and status values are not written to artefacts or issue summaries.

### Staging environment

- `STAGING_URL`: isolated non-production URL for the read-only Artillery resilience profile.
- Do not point this secret at production unless the load phases and limits have been reviewed for production use.

When `STAGING_URL` is absent, the workflow records a visible skip rather than inventing a target or testing production.

## Test expansion rules

New tests should prioritise risk rather than raw test count:

- concurrency and idempotency around bookings, quote acceptance, payments, webhooks, messaging and scheduled jobs;
- migrations that prove preservation, repeatability, partial-failure recovery and restore compatibility;
- external-service timeout, malformed-response, rate-limit and retry behaviour;
- authenticated accessibility and visual states for customer, supplier and admin journeys;
- property tests for dates, money, postcodes, uploads, search filters and tokens;
- mutation testing for authentication, authorisation, payment and state-transition services after the initial focused baseline stabilises.

A new critical service should include unit contracts, real-persistence integration coverage and at least one browser journey before its feature flag can be enabled.

## Automatic issue behaviour

Scheduled test audits, staging resilience checks and production synthetics maintain one issue per failing monitor. Repeated failures add comments to the existing issue rather than creating noise. A later successful run comments with recovery evidence and closes the issue automatically.

## Safe autonomy boundary

Automation may open issues, produce evidence and create dependency pull requests. It must not automatically merge changes involving:

- authentication or authorisation;
- payment or subscription handling;
- database migrations or destructive scripts;
- deployment and workflow permissions;
- privacy, analytics consent or secret handling;
- customer, supplier or admin data mutations.

Those areas are protected by `CODEOWNERS` and should retain explicit human review.
