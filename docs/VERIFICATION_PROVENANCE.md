# Verification provenance and email diagnostics

This document explains how EventFlow should describe user verification in admin tools.

## Why this exists

A user can be verified for different reasons. The admin UI should not show only `verified: true` without context.

Expected verification sources:

- `eventflow_email` — the user completed the EventFlow email confirmation flow.
- `google_verified_email` — the user signed in with Google and Google reported the email as verified.
- `admin_created` — the account was created by an admin and is pre-verified by policy.
- `owner_account` — the owner/system account is pre-verified by policy.
- `pending` — the user still needs to complete EventFlow email verification.
- `unknown` — legacy or incomplete records where the source cannot be proven.

## Google sign-up behaviour

Google users do not need an EventFlow verification email when the Google ID token has already confirmed that the email is verified. Admin tools must make this visible as `Google verified`, not simply `Verified`.

## Email/password sign-up behaviour

Email/password users should have a verification email attempt recorded in Email Centre. If a recent email/password user exists with no matching verification email log, the Email Centre health panel should flag this as a diagnostic issue.

## Admin-created users

Admin-created users may remain pre-verified, but the admin UI must show that the verification source is `admin_created`.

## Production email delivery

Critical account emails, including verification and reset emails, should not silently fall back to local outbox in production. If Postmark is unavailable in production, the diagnostic panel should show a critical issue.

## Privacy

The admin UI should show metadata only. It must not expose raw Google subjects, reset links, verification links, full email bodies, Postmark API keys or webhook credentials.

## Follow-up completion after PR1157/PR1158

This follow-up standardises persisted account provenance on user records for all auth write paths:

- Email/password registration starts as `signupMethod=email_password`, `authProvider=local`, `verificationMethod=pending` and records the verification email log/Postmark IDs after a successful critical send.
- EventFlow verification links set `verificationMethod=eventflow_email`, `verifiedAt` and a safe `verifiedBy.type=user` summary.
- Google sign-up/linking records `signupMethod=google` or `authProvider=mixed` as appropriate, `verificationMethod=google_verified_email`, `verifiedBy.type=google`, and `emailDeliveryStatus=not_required`.
- Admin-created accounts record `signupMethod=admin_created`, `authProvider=admin`, `verificationMethod=admin_created` and safe admin actor provenance.
- Owner/system accounts record `verificationMethod=owner_account` and `emailDeliveryStatus=not_required`.

Critical auth emails (`verification` and `password-reset`) now use `criticalDelivery=true`; in production they fail clearly if Postmark is unavailable instead of silently treating an outbox fallback as success. The Admin Users API includes safe provenance fields without raw `googleSub`, tokens, email body content or verification/reset links.

A safe dry-run backfill is available:

```bash
node scripts/backfill-user-verification-provenance.js
```

Apply with:

```bash
node scripts/backfill-user-verification-provenance.js --apply
```
