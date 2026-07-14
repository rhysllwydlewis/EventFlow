# Independent Post-Deployment Analytics Review

Date: 14 July 2026

## Review basis

This review was carried out independently after PR #1339 had been merged and deployed. It did not rely on the earlier pre-merge conclusion. The merged implementation, surrounding consent code, template injection, PostHog SDK lifecycle behaviour, token-bearing public routes, caching policy and regression coverage were re-examined from first principles.

## Findings

### 1. High: PostHog custom events could inherit complete query strings

EventFlow deliberately supplied query-free URLs for its manual `$pageview` and `$pageleave` events. However, PostHog enriches every captured event with browser-derived properties, including `$current_url`, referrer and session-entry URL fields. EventFlow's ordinary custom events did not override or sanitise those inherited values.

This was material because EventFlow issues email-verification links in the form `/verify?token=...`. A consented visit to that page could therefore allow the token-bearing URL to be attached to a PostHog event even though the explicit lifecycle URL was query-free.

#### Correction

- `/verify` is now treated as a sensitive analytics page.
- The effective analytics consent returned on that page is forced to `false` for the page lifecycle, without changing the user's stored preference.
- The privacy bridge prevents PostHog from loading there.
- A final `before_send` guard strips query strings and fragments from PostHog URL, referrer and session-entry properties on every event.
- The guard runs after any pre-existing `before_send` hook so another hook cannot reintroduce a sensitive URL.
- PostHog personal-data masking and URL-hash suppression are enabled as additional defence in depth.

### 2. Medium: Accept All produced two conflicting consent transitions

The legacy consent component still treated Accept All as `analytics:false`. PR #1339 compensated with a capture-phase listener that allowed the original handler to run and then replaced the cookie with `analytics:true` on a zero-delay timer.

That produced a false consent event followed by a true consent event. For a returning user, the false transition could stop and reset PostHog immediately before it was started again. The result was unnecessarily brittle and could split anonymous identity or session continuity.

#### Correction

The bridge now intercepts the legacy Accept All action before its target handler runs, prevents the obsolete false decision and applies one canonical full-consent event. The banner or preferences dialog is then closed directly.

### 3. Medium: the deployed fix retained its old one-week asset URL

PR #1339 changed `analytics-consent-upgrade.js`, but the HTML injector continued requesting `analytics-consent-upgrade.js?v=1`. EventFlow's static-cache policy gives ordinary JavaScript assets a one-week browser cache lifetime. Returning users could therefore continue running the pre-fix bridge after deployment.

#### Correction

The injected URL is now `analytics-consent-upgrade.js?v=2`, forcing browsers and intermediaries to retrieve the independently reviewed implementation.

## Confirmed controls

The independent review also reconfirmed that:

- analytics remains opt-in;
- the first-party collector stores pathnames rather than query strings;
- admin traffic is excluded server-side;
- PostHog person profiles remain disabled;
- replay inputs remain masked;
- explicit `$pageview` and `$pageleave` events use query-free URLs;
- `$pageleave` uses `sendBeacon` transport and PostHog's standard previous-pageview fields;
- PostHog's automatic pageview and pageleave capture remain disabled, avoiding duplicate lifecycle ownership.

## Regression coverage added

The new tests execute the browser bridge in an isolated VM and verify that:

1. sensitive inherited URL properties are stripped after an existing `before_send` hook;
2. verification pages force analytics off and do not load PostHog;
3. Accept All emits one full-consent decision rather than false then true transitions; and
4. the rendered HTML uses the new `v=2` bridge URL.

## Post-deployment verification

After this follow-up PR is deployed:

1. open `/verify?token=test-value` in a clean browser with analytics previously accepted;
2. confirm no PostHog network requests or first-party analytics collection requests are initiated from that page;
3. on a normal public page, capture a custom EventFlow event and confirm `$current_url`, referrer and session-entry URL properties contain no query string or fragment;
4. use both Accept All buttons and confirm only one `cookieConsentChanged` event is emitted with `analytics:true`;
5. confirm the page source requests `analytics-consent-upgrade.js?v=2`; and
6. repeat the existing `$pageview` then `$pageleave` Installation Health check.

## Independent conclusion

PR #1339 corrected the missing PostHog pageleave lifecycle event, but it was not sufficient as a complete privacy and deployment hardening pass. The follow-up changes close the independently identified query-string exposure, remove the conflicting consent transition and ensure deployed browsers actually receive the corrected bridge.
