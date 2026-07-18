# EventFlow autonomous quality and GitHub hardening

This document separates controls implemented in the repository from controls that must be enabled in GitHub or Railway settings. Repository workflows cannot silently change organisation/repository security settings, branch rules or environment secrets.

## Automated checks added by this change

### Pull requests

| Check                          | Purpose                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Build Verification             | Existing aggregate lint, formatting, smoke, full regression, security and production-image gate.    |
| Browser Verification           | Existing blocking Chromium auth, static E2E and visual prerequisite gate.                           |
| Dedicated Visual Verification  | Existing blocking visual regression and axe accessibility gate.                                     |
| Backend E2E                    | Runs tagged backend browser journeys against a real MongoDB replica set.                            |
| Changed executable lines (80%) | Requires newly changed instrumented JavaScript lines to be covered.                                 |
| Dependency delta security      | Blocks new high/critical dependency vulnerabilities introduced by a PR.                             |
| CodeQL Advanced                | Runs Actions and JavaScript/TypeScript security-extended queries.                                   |
| Lighthouse desktop/mobile      | Runs three samples per URL with blocking performance, accessibility, best-practice and SEO budgets. |

### Scheduled checks

| Cadence                 | Check                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Every two hours         | Read-only production deployment identity, health, readiness, config, public pages, robots and sitemap synthetics. |
| Nightly Monday-Saturday | CI-depth classified test audit with automatic issue creation and recovery closure.                                |
| Sunday                  | Full test audit including backend, visual, accessibility and dependency checks.                                   |
| Sunday                  | Open-handle detection without Jest `forceExit`, deterministic fuzzing and migration idempotency.                  |
| Sunday                  | Focused mutation testing for geocoding contracts.                                                                 |
| Sunday                  | Firefox, WebKit, desktop and mobile Playwright matrix.                                                            |
| Sunday                  | Read-only Artillery load thresholds against the configured staging URL.                                           |
| Tuesday and Friday      | Three-run desktop and mobile Lighthouse budgets.                                                                  |
| Friday                  | CodeQL scheduled deep scan.                                                                                       |
| Weekly                  | Dependabot grouped npm and GitHub Actions update PRs.                                                             |

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

The scheduled `Immutable GitHub Action reference inventory` deliberately begins in warning mode because existing workflows use version tags. Dependabot maintains those references while each action is migrated to a reviewed 40-character SHA. Change `ACTION_PIN_ENFORCEMENT` to `error` once the inventory reaches zero.

## Required environments and secrets

### Production environment

- `APP_URL`: canonical deployed application URL used by deployment verification.
- Railway must expose `RAILWAY_GIT_COMMIT_SHA` to the runtime. The startup script writes it to `public/deployment.json`.
- Use environment protection and required reviewers for manual production deployments.

The deployment workflow waits for `deployment.json` to report the exact target commit before running health/readiness checks. A healthy previous release can no longer make a new deployment appear successful.

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
