# PostHog and Admin Analytics Installation Health Audit

Date: 14 July 2026

## Scope reviewed

- Consent-gated PostHog loading and public-page lifecycle tracking
- EventFlow's first-party behaviour analytics collector
- Sensitive/private route exclusions
- Conversion event capture
- Session replay privacy controls
- Admin Analytics refresh and PostHog dashboard configuration
- The PostHog Web Analytics Installation Health warning shown for `$pageleave`
- The PostHog reverse-proxy recommendation

## Findings

### Fixed in this change

PostHog received `$pageview` events but no matching `$pageleave` lifecycle event. This can make PostHog bounce rate and session duration incomplete or inaccurate, which matches the Installation Health warning.

The public analytics bridge now emits one `$pageleave` on `pagehide`, but only when:

- analytics consent remains enabled;
- the same public URL previously emitted a `$pageview`;
- the page is not in EventFlow's sensitive/private route exclusions;
- PostHog is available; and
- a pageleave has not already been emitted.

The event includes the query-free current URL, pathname and elapsed pageview duration. Regression coverage verifies the lifecycle pairing and privacy gates.

### Existing controls confirmed

- Browser analytics remains opt-in and consent-gated.
- PostHog is anonymous (`person_profiles: 'never'`) and does not identify users.
- Query strings are removed from captured URLs.
- Admin, authentication, checkout/payment, messages and other sensitive areas remain excluded.
- Replay inputs are masked.
- EventFlow's first-party collector measures active time separately and uses `sendBeacon` during page lifecycle shutdown.
- Admin Analytics refreshes only while visible and does not mislabel the generic PostHog homepage as the configured project dashboard.

### Reverse proxy recommendation

No reverse proxy is added in this PR. PostHog marks it as a setup recommendation rather than a correctness requirement. Adding one changes ingestion routing, caching, CSP and deployment behaviour and should be treated as a separate infrastructure change with live verification and rollback. The current direct EU PostHog ingestion remains valid.

A future reverse-proxy change should include:

1. a dedicated same-origin ingestion path that cannot shadow application routes;
2. forwarding for both event ingestion and PostHog static assets;
3. CSP and rate-limit review;
4. Railway/proxy timeout validation;
5. consent and sensitive-route regression tests; and
6. live confirmation that events, replay and feature payloads still reach the correct PostHog project.

## Post-deployment verification

1. Deploy the PR.
2. Open a public page in a clean browser session and grant analytics consent.
3. Navigate to another public page or close the tab.
4. In PostHog Live Events, confirm a `$pageview` followed by `$pageleave` for the same query-free URL.
5. Confirm no events are emitted from `/admin`, authentication, payment, messaging or other excluded routes.
6. Allow PostHog Installation Health time to re-evaluate, then refresh the check.
7. Confirm Admin Analytics continues to refresh every 15 seconds only while its tab is visible.

## Expected outcome

The `$pageleave` Installation Health warning should clear after PostHog observes production traffic containing the new lifecycle event. Bounce-rate and session-duration calculations should then have the event pairing PostHog expects.