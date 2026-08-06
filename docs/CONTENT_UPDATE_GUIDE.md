# Content and policy metadata guide

EventFlow replaces server-side `{{PLACEHOLDER}}` values before returning public
HTML. General site values live in `config/content-config.js`; reviewed policy
dates and versions live in `config/policyMetadata.js`.

## Policy dates are editorial facts

Do not derive a public policy date from the current month, server clock, deploy
time, file modification time or the latest commit in the repository.

Each policy record has four reviewed fields:

- `version`: the public policy version;
- `lastMaterialUpdate`: when wording or legal effect last changed;
- `effectiveFrom`: when that version takes effect;
- `lastReviewed`: the latest completed review, including a review that required
  no wording change.

Dates use ISO `YYYY-MM-DD` in configuration. The server formats them in UK
English for display. This keeps comparisons deterministic and avoids timezone
or hydration differences.

Example:

```js
terms: policy({
  title: 'Terms of Use',
  url: '/terms',
  sourcePath: 'public/terms.html',
  version: '1.1',
  lastMaterialUpdate: '2026-08-06',
  effectiveFrom: '2026-08-06',
  lastReviewed: '2026-08-06',
}),
```

## Updating a policy

1. Review the product behaviour and the current policy wording.
2. Change the policy document.
3. Update that policy's `lastMaterialUpdate`, `effectiveFrom`, `lastReviewed`
   and `version` in the same pull request.
4. If no wording changes, update only `lastReviewed` and record the reasoning in
   the pull request.
5. Run the policy metadata tests, formatting, lint and relevant application
   tests.
6. Obtain legal review where appropriate. Repository wording is not a
   substitute for advice from a qualified solicitor.

Runtime and admin-panel date overrides are deliberately disabled. Deployed
containers may be read-only or ephemeral, and a date change without reviewed
wording is misleading.

## Placeholders

Policy placeholder names are generated from their metadata key:

```html
{{POLICY_TERMS_LAST_UPDATED}} {{POLICY_TERMS_EFFECTIVE_DATE}} {{POLICY_TERMS_LAST_REVIEWED}}
{{POLICY_TERMS_VERSION}}
```

Equivalent placeholders exist for `legalHub`, `privacy`, `dataRights`,
`communityGuidelines`, `communityHelp`, `cookiePolicy`, `acceptableUse`,
`copyright`, `supplierTerms` and `marketplaceTerms`.

General placeholders remain available for company, contact and copyright-year
information, including:

- `{{CURRENT_YEAR}}` and `{{COPYRIGHT_YEAR}}`;
- `{{COMPANY_NAME}}`, `{{COMPANY_NUMBER}}` and `{{REGISTERED_OFFICE}}`;
- `{{SUPPORT_EMAIL}}`, `{{PRIVACY_EMAIL}}`, `{{ABUSE_EMAIL}}` and
  `{{ADMIN_EMAIL}}`.

`{{LEGAL_LAST_UPDATED}}` and `{{LEGAL_EFFECTIVE_DATE}}` remain as compatibility
aliases for the Legal Hub only. New or edited policy pages must use their own
`POLICY_*` placeholders.

## Review reminders

The date management service performs an optional monthly review check. It may
use Git history to flag a policy source file changed after the recorded review
date. Git data is diagnostic only:

- it never changes public metadata;
- it never assumes that every source edit is a material policy change;
- it reports missing Git history instead of inventing a date;
- an administrator or reviewer decides whether wording, `lastReviewed` or
  `lastMaterialUpdate` needs to change.

The Policy Reviews tab in the admin area shows the committed metadata and can
run this check. Enabling or disabling reminders changes only the reminder
schedule.

## Template rendering and cache behaviour

`utils/template-renderer.js` replaces placeholders on the server. Its production
cache key includes both `content-config.js` and `policyMetadata.js`, so a
deployed metadata change invalidates cached HTML. Community shells use the same
replacement function before their route-specific server rendering.

The current year is the only legal-page date intentionally derived from the
clock, and it is used for copyright notices rather than policy currency.

## Review checklist

When a product change is material, consider:

- public or user-generated content;
- profiles, search indexing and discovery;
- reports, moderation, restrictions and appeals;
- personal data, retention and third-party recipients;
- uploads, messaging and notifications;
- supplier locations, service areas and external geocoding;
- pricing, recurring subscriptions, upgrades, downgrades and cancellation;
- content ownership and the licence needed to operate the service;
- new public routes and links from the Legal Hub.

The pull request should distinguish policies changed from policies reviewed but
unchanged, explain why, and list any decisions still requiring operator or
solicitor confirmation.
