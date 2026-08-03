# Signup attribution and PostHog session replay

## What this change records

After a visitor consents to analytics, EventFlow stores a privacy-safe 90-day first-touch and last-touch record in the browser. A completed email/password registration is sent to PostHog with:

- signup method
- first and last channel
- first and last referring domain
- first and last landing path
- UTM source, medium and campaign when supplied

The PostHog distinct ID is EventFlow's opaque internal user ID. The account role is attached to the identified profile. Email addresses, names, passwords, form values and message content are not sent as identification properties.

Google registration attribution is not included in this browser-side change because Google completes through a server redirect. It should be added separately by carrying the same attribution fields through the signed Google state and recording the conversion after account creation.

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

## Limitations

Attribution only exists for visitors who accept analytics cookies. Browser privacy tools, cleared storage and cross-device journeys can prevent a complete match. First-touch attribution should therefore be read alongside self-reported acquisition data where practical.
