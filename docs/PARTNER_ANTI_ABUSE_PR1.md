# Partner Programme Anti-Abuse — PR1 Identity, Device & Network Controls

This document describes the first layer of EventFlow's Partner Programme anti-abuse controls. It focuses on registration identity, traffic, business-identity and network evidence. Reward qualification and cashout operations are handled by the existing partner anti-abuse controls and later hardening PRs.

## Principles

- No single shared-IP, VPN, Tor, hosting-network or public-email-domain signal automatically proves abuse.
- High-confidence evidence such as disposable identity use or deliberately high hard-velocity limits can block registration; ambiguous evidence is recorded for review.
- Registration risk thresholds are configurable and can be run in `monitor` mode before enforcement.
- Anti-abuse evidence is pseudonymised wherever it does not need to remain directly identifiable.
- Administrative overrides require an attributable administrator and a written reason.
- Users can appeal an automated registration block.
- Reward qualification continues to require verified email and approved supplier evidence.

## Registration signals

The registration risk engine can evaluate:

- Known disposable email services.
- Configured suspicious email domains, which trigger review rather than being treated as disposable.
- Canonical email identity reuse, including common Gmail/Googlemail dot and `+` aliases.
- Registration velocity from the same IP hash.
- Registration velocity from the same IPv4 `/24` or IPv6 `/64` network hash.
- Multiple identities sharing the same browser signature.
- Multiple identities sharing a combined browser/network signature.
- Multiple identities sharing a random first-party, HTTP-only pseudonymous device token.
- Partner and supplier accounts sharing the same pseudonymous device/browser/network evidence.
- Strong business-identity reuse, using protected phone, website, company-registration, VAT, company/postcode or company/address evidence when supplied.
- Unusually fast use of one referral code.
- Unusually concentrated **private** email-domain registration activity. Public providers such as Gmail and Outlook are excluded from this signal.
- Obvious headless/browser-automation user agents.
- Optional external IP reputation signals for VPN, proxy, Tor, datacentre/hosting and reputation risk.

Signals are stored with reason codes so an administrator can see why an assessment reached its score.

## Pseudonymous technical evidence

Partner anti-abuse event records do **not** store the raw IP address, browser user-agent, first-party device token or registration email address. Values used for correlation are transformed using HMAC-SHA256 before storage.

The hashing secret is read from:

1. `PARTNER_ABUSE_HASH_SECRET`
2. `JWT_SECRET`
3. `SESSION_SECRET`

Production must provide one of these values. Rotating the anti-abuse hash secret intentionally breaks historical correlation and should therefore be treated as a controlled operational change.

The browser signature uses the user-agent, language and browser client-hint headers. Registration may also set the HTTP-only, SameSite=Lax first-party random device token `ef_partner_device`; only its HMAC representation enters the anti-abuse event ledger. Neither mechanism is a claim that EventFlow can uniquely identify a physical device, and technical evidence must be combined with other evidence before adverse manual action is taken.

Technical event records expire through MongoDB TTL indexes. Registration queries use bounded indexed reads in MongoDB rather than loading the complete anti-abuse ledger on every signup.

## Enforcement modes

`PARTNER_ABUSE_ENFORCEMENT_MODE` supports:

- `off` — collect no blocking decision from risk score.
- `monitor` — score and flag registrations but do not automatically block high-risk registrations.
- `enforce` — block registrations at or above the configured block threshold unless an active admin override applies.

Default mode: `enforce`.

Recommended rollout for a materially changed rule set is `monitor`, review false positives, then enable `enforce`.

## Main configuration

- `PARTNER_ABUSE_RETENTION_DAYS` — pseudonymous technical risk evidence retention, default 90 days.
- `PARTNER_ABUSE_APPEAL_RETENTION_DAYS` — appeal retention, default 180 days.
- `PARTNER_ABUSE_OVERRIDE_AUDIT_RETENTION_DAYS` — retention for expired/revoked administrator override evidence, default 180 days. The override's active allow period remains limited to 1–30 days.
- `PARTNER_ABUSE_DEVICE_COOKIE_DAYS` — first-party anti-abuse device-token lifetime, default 180 days.
- `PARTNER_ABUSE_REVIEW_SCORE` — score that requires review, default 35.
- `PARTNER_ABUSE_BLOCK_SCORE` — score that blocks in enforcement mode, default 70.
- `PARTNER_ABUSE_IP_WINDOW_HOURS` — velocity window, default 24 hours.
- `PARTNER_ABUSE_IP_REGISTRATION_MAX` — same-IP review threshold, default 8.
- `PARTNER_ABUSE_IP_HARD_REGISTRATION_MAX` — deliberately high same-IP hard limit, default 50.
- `PARTNER_ABUSE_SUBNET_REGISTRATION_MAX` — subnet review threshold, default 20.
- `PARTNER_ABUSE_BROWSER_REGISTRATION_MAX` — browser multi-account threshold, default 4.
- `PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX` — combined browser/network and first-party device-token threshold, default 4.
- `PARTNER_ABUSE_HARD_VELOCITY_MULTIPLIER` — multiplier used only for the stable-device hard multi-account limit, default 2.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code review threshold, default 12.
- `PARTNER_ABUSE_REFERRAL_HARD_REGISTRATION_MAX` — deliberately high referral-code hard limit, default 100.
- `PARTNER_ABUSE_DOMAIN_REGISTRATION_MAX` — private-email-domain review threshold, default 20.
- `PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS` — comma-separated additions to the built-in disposable-domain list.
- `PARTNER_ABUSE_SUSPICIOUS_EMAIL_DOMAINS` — comma-separated domains that should trigger manual review without being automatically treated as disposable.
- `PARTNER_ABUSE_FAIL_OPEN=true` — emergency-only option allowing registration if the risk engine itself is unavailable. Do not use routinely in production.

## Optional external IP reputation provider

No external provider is required for the core controls.

When `PARTNER_ABUSE_IP_REPUTATION_URL` is configured it must contain an `{ip}` placeholder, for example:

`https://provider.example/check?ip={ip}`

Production requires HTTPS. `PARTNER_ABUSE_IP_REPUTATION_TOKEN` can provide a bearer token.

The provider response may include:

```json
{
  "riskScore": 85,
  "vpn": true,
  "proxy": false,
  "tor": false,
  "hosting": true,
  "provider": "provider-name"
}
```

Provider failure is treated as unavailable evidence rather than automatic fraud. Signals coming from the same reputation provider are capped as one evidence family, so multiple labels from a single provider cannot by themselves create an automatic block.

## Registration audit events

The risk layer records only final registration outcomes for velocity purposes:

- `created` — an account was durably created and registration-risk metadata persisted;
- `blocked` — the risk engine blocked the registration;
- `failed` / `completed_without_user` — audit evidence for a request that did not create an account; these outcomes are excluded from velocity counting.

Historical PR1 records that briefly contained both `attempt` and `created` entries for one assessment are deduplicated by assessment ID while they age out.

## CAPTCHA and email verification

The dedicated partner registration form uses the self-hosted ALTCHA proof-of-work challenge. Production fails closed if neither the injected verifier nor `ALTCHA_HMAC_KEY` is available.

New email/password partner accounts must verify their email before they can sign in or qualify referral rewards. Supplier reward guards continue to require verified supplier and partner identities.

## Administrative review and overrides

Admin endpoints under `/api/admin/partner-abuse` expose:

- registration risk events;
- appeals;
- temporary registration overrides;
- the active risk configuration without secrets.

Overrides:

- are scoped to one canonical email identity;
- require an administrator identity;
- require a meaningful reason;
- expire automatically as an active allow decision;
- remain auditable after the active period ends until the configured audit-retention expiry;
- can be revoked with a recorded reason;
- do not delete the underlying risk signals.

An override means “allow this registration after review,” not “erase the fraud evidence.”

## Appeals

A blocked applicant can submit an appeal through `/api/partner/abuse-appeals`.

Appeals retain the contact email because EventFlow needs a way to investigate and respond. They are deliberately separate from pseudonymous technical risk events and have their own longer retention window.

## Privacy and false-positive handling

Shared offices, households, venues, mobile networks and privacy tools can cause multiple legitimate users to share technical signals. Therefore:

- a shared IP alone is primarily a velocity/review signal;
- ordinary VPN/proxy, Tor or hosting-network evidence is review evidence and is capped as one provider evidence family;
- public domains such as Gmail/Outlook are not suspicious merely because several users share the domain;
- a company name by itself is not treated as strong business-identity reuse;
- administrators should review the signal combination, account evidence and appeal information before permanently excluding a legitimate person.

The public privacy notice explains the fraud-prevention purpose, pseudonymous network/browser/email processing, optional external network reputation processing, decision evidence and retention periods. The general technical-data section also covers device information used by the service.

## Operational review

At least monthly during launch, review:

- number of registrations assessed;
- block and review rates;
- confirmed abuse rate per signal;
- successful appeal rate;
- false-positive rate;
- thresholds generating the most manual work;
- unusually concentrated partner referral codes.

Adjust thresholds through configuration only after reviewing evidence. Avoid exposing exact fraud thresholds publicly.

The registration risk layer is mounted after normal CSRF, rate-limit and CAPTCHA controls so malformed, rate-limited or failed verification traffic does not inflate persistent fraud counters.
