# Partner Programme Anti-Abuse — PR1 Identity, Device & Network Controls

This document describes the first layer of EventFlow's Partner Programme anti-abuse controls. It is intentionally focused on registration identity, traffic and network evidence. Reward qualification and cashout operations are handled by the existing partner anti-abuse controls and later hardening PRs.

## Principles

- No single shared-IP, VPN or public-email-domain signal automatically proves abuse.
- High-confidence signals can block registration; ambiguous signals are recorded for review.
- Registration risk thresholds are configurable and can be run in `monitor` mode before enforcement.
- Anti-abuse evidence is pseudonymised wherever it does not need to remain directly identifiable.
- Administrative overrides require an attributable administrator and a written reason.
- Users can appeal an automated registration block.
- Reward qualification continues to require verified email and approved supplier evidence.

## Registration signals

The registration risk engine can evaluate:

- Known disposable email services.
- Canonical email identity reuse, including common Gmail/Googlemail dot and `+` aliases.
- Registration velocity from the same IP hash.
- Registration velocity from the same network/subnet hash.
- Multiple identities sharing the same browser signature.
- Multiple identities sharing a combined browser/network signature.
- Partner and supplier accounts sharing the same pseudonymous device/network signature.
- Unusually fast use of one referral code.
- Unusually concentrated email-domain registration activity.
- Obvious headless/browser-automation user agents.
- Optional external IP reputation signals for VPN, proxy, Tor, datacentre/hosting and reputation risk.

Signals are additive and stored with reason codes so an administrator can see why an assessment reached its score.

## Pseudonymous technical evidence

Partner anti-abuse event records do **not** store the raw IP address, browser user-agent or registration email address. Those values are transformed using HMAC-SHA256 before being used for correlation.

The hashing secret is read from:

1. `PARTNER_ABUSE_HASH_SECRET`
2. `JWT_SECRET`
3. `SESSION_SECRET`

Production must provide one of these values. Rotating the anti-abuse hash secret intentionally breaks historical correlation and should therefore be treated as a controlled operational change.

The browser signature uses the user-agent, language and browser client-hint headers. It is a fraud signal, not a claim that EventFlow can uniquely identify a physical device. Browser/device evidence must be combined with other evidence before adverse manual action is taken.

## Enforcement modes

`PARTNER_ABUSE_ENFORCEMENT_MODE` supports:

- `off` — collect no blocking decision from risk score.
- `monitor` — score and flag registrations but do not automatically block high-risk registrations.
- `enforce` — block registrations at or above the configured block threshold unless an active admin override applies.

Default mode: `enforce`.

Recommended rollout for a materially changed rule set is `monitor`, review false positives, then enable `enforce`.

## Main configuration

- `PARTNER_ABUSE_RETENTION_DAYS` — technical risk evidence retention, default 90 days.
- `PARTNER_ABUSE_APPEAL_RETENTION_DAYS` — appeal retention, default 180 days.
- `PARTNER_ABUSE_REVIEW_SCORE` — score that requires review, default 35.
- `PARTNER_ABUSE_BLOCK_SCORE` — score that blocks in enforcement mode, default 70.
- `PARTNER_ABUSE_IP_WINDOW_HOURS` — velocity window, default 24 hours.
- `PARTNER_ABUSE_IP_REGISTRATION_MAX` — same-IP attempt threshold, default 8.
- `PARTNER_ABUSE_SUBNET_REGISTRATION_MAX` — subnet threshold, default 20.
- `PARTNER_ABUSE_BROWSER_REGISTRATION_MAX` — browser multi-account threshold, default 4.
- `PARTNER_ABUSE_DEVICE_NETWORK_REGISTRATION_MAX` — combined browser/network threshold, default 4.
- `PARTNER_ABUSE_REFERRAL_REGISTRATION_MAX` — referral-code threshold, default 12.
- `PARTNER_ABUSE_DOMAIN_REGISTRATION_MAX` — email-domain threshold, default 20.
- `PARTNER_ABUSE_DISPOSABLE_EMAIL_DOMAINS` — comma-separated additions to the built-in disposable-domain list.
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

Provider failure is treated as unavailable evidence rather than automatic fraud.

## Administrative review and overrides

Admin endpoints under `/api/admin/partner-abuse` expose:

- registration risk events;
- appeals;
- temporary registration overrides;
- the active risk configuration (without secrets).

Overrides:

- are scoped to one canonical email identity;
- require an administrator identity;
- require a meaningful reason;
- expire automatically;
- can be revoked with a recorded reason;
- do not delete the underlying risk signals.

An override means “allow this registration after review,” not “erase the fraud evidence.”

## Appeals

A blocked applicant can submit an appeal through `/api/partner/abuse-appeals`.

Appeals retain the contact email because EventFlow needs a way to investigate and respond. They are deliberately separate from pseudonymous technical risk events and have their own longer retention window.

## Email verification

New email/password partner accounts must verify their email before they can sign in or qualify referral rewards. Supplier reward guards continue to require verified supplier and partner identities.

## Privacy and false-positive handling

Shared offices, households, venues, mobile networks and privacy tools can cause multiple legitimate users to share technical signals. Therefore:

- a shared IP alone should be treated primarily as a velocity signal;
- ordinary VPN/proxy use contributes risk but is not, by itself, sufficient to block;
- public domains such as Gmail/Outlook are not suspicious merely because several users share the domain;
- administrators should review the signal combination, account evidence and appeal information before permanently excluding a legitimate person.

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
