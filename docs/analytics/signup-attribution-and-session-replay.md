# Signup attribution and PostHog session replay

## What this change records

After a visitor consents to analytics, EventFlow stores a privacy-safe 90-day first-touch and last-touch record in the browser. A completed email/password registration is sent to PostHog with:

- signup method
- first and last channel
- first and last referring domain
- first and last landing path
- UTM source, medium and campaign when supplied

The PostHog distinct ID is EventFlow's opaque internal user ID. The account role is attached to the identified profile. Email addresses, names, passwords, form values and message content are not sent as identification properties.

For a new Google signup, the same consented attribution fields and opaque analytics session reference are carried through the Google redirect state. EventFlow then records a privacy-safe first-party `registration_completed` event after the account is created. Email/password registrations are also attached to the opaque EventFlow user in PostHog; Google registrations remain first-party-only in this change.

## Admin dashboard reporting

The Total Users trend now uses a genuine rolling seven-day comparison: users created during the latest seven days are compared with those created during the immediately preceding seven days. It no longer treats the previous period as zero or describes the rolling window as a calendar week.

The EventFlow admin behaviour dashboard includes a **Where registrations came from** card. It reports privacy-safe first-touch channel and source totals for consented completed registrations, without exposing names or email addresses. Read the card as an acquisition indicator rather than a complete census, because registrations without analytics consent are deliberately not attributed.

Attribution starts when this change is deployed. Existing historical registrations cannot be assigned a reliable source retrospectively.

## Session replay

Session replay is enabled by default when `POSTHOG_PROJECT_KEY` is configured and the visitor has accepted analytics cookies.

Recordings remain disabled on sensitive areas, including authentication, verification, password reset, checkout, payment, messages, dashboards, settings, plans and supplier account-management pages. All form inputs are masked and query strings are removed from captured URLs and network request names.

To turn replay off immediately, set:

```text
POSTHOG_SESSION_RECORDING_ENABLED=false
```

To make the setting explicit while leaving replay enabled, set:

```text
POSTHOG_SESSION_RECORDING_ENABLED=true
```

The injected analytics bridge asset is versioned, so returning visitors receive this attribution update instead of continuing to use a cached earlier script.

## Viewing signup sources in PostHog

Create an insight using the `registration_completed` event and break it down by one of:

- `first_channel`
- `first_referrer_domain`
- `first_landing_path`
- `first_utm_source`
- `first_utm_campaign`
- `signup_method`

The identified profile also contains the EventFlow account `role`.

For recordings, filter session recordings by the `registration_completed` event. The authentication page itself is intentionally not recorded, but the consented journey before registration can be replayed and the completed registration is attached to the identified EventFlow user.

## Validation

The Google redirect integration test verifies that a newly created consented account produces one allow-listed, hashed first-party registration event while excluding unapproved state values. The broader suite also covers attribution sanitisation, consent withdrawal, replay configuration, rolling user comparisons and existing conversion compatibility.

The final quality pass fixes the mobile password-toggle geometry and makes keyboard-tab E2E input target the focused tab directly, preventing icon-size drift and asynchronous focus races from obscuring genuine authentication regressions. It also replaces repeated manual null guards with optional chaining while preserving the consent UI's compatible parent-node removal behaviour.

The production dependency override and lockfile pin `fast-uri` to the patched `3.1.5` line. The repository's production audit and clean-install checks verify the resolved tree before merge.

## Limitations

Attribution only exists for visitors who accept analytics cookies. Withdrawing analytics consent removes the browser attribution record. Browser privacy tools, cleared storage and cross-device journeys can prevent a complete match. First-touch attribution should therefore be read alongside self-reported acquisition data where practical.
