# EventFlow Sign in with Apple implementation

This document records the EventFlow "Sign in with Apple" implementation and
the Apple Developer configuration required to make it work in production.

## Currently switched off

The full implementation below is built and left in place, but the button is
switched off on the frontend — enrolling in the Apple Developer Program to
use it costs £79/$99 per year (see "Step-by-step: Apple Developer setup"),
and that hasn't been paid for yet.

To re-enable once enrolled:

1. Set `APPLE_SIGNIN_ENABLED = true` at the top of
   `public/assets/js/pages/auth-apple-init.js`.
2. Complete the Apple Developer setup below and set `APPLE_CLIENT_ID` (and
   the email-relay domain registration in step 5) in Railway.

Nothing else needs to change — the backend route, verification service and
tests are unaffected by the frontend switch.

## Current chosen flow

EventFlow uses Apple's web-based "Sign in with Apple JS" with a server-side
redirect (`form_post`) flow — the same shape as the existing Sign in with
Google implementation, so the two buttons behave consistently.

The intended flow is:

1. `/auth` loads `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`.
2. On button click, the browser fetches a one-time nonce from EventFlow
   (`GET /api/auth/apple/nonce`), which also sets a short-lived, httpOnly
   cookie holding that same value.
3. `AppleID.auth.init()` is called with the Services ID (`client_id`), the
   nonce, and an encoded `state` (which embeds the nonce again for CSRF
   binding, plus the intended destination and, for signups, the chosen
   account type/company/location).
4. `AppleID.auth.signIn()` redirects the browser to Apple to authenticate.
5. Apple redirects back with a `form_post` to
   `/api/auth/callback/apple`, carrying `id_token`, `state`, and — **only on
   the first authorization for a given Apple ID + client** — a `user` field
   with the person's name.
6. EventFlow verifies the returned `state` against the nonce cookie
   (Apple has no built-in double-submit cookie like Google's
   `g_csrf_token`, so EventFlow implements the equivalent itself).
7. EventFlow verifies the Apple ID token using
   `services/appleAuth.service.js`, including checking the token's `nonce`
   claim against the same value, and confirms the token's audience matches
   the configured Apple Services ID.
8. EventFlow finds, links, or creates the user.
9. EventFlow sets the normal auth cookie and redirects to the relevant
   dashboard.

Because EventFlow only needs to identify the signed-in Apple account (not
call Apple's token endpoint for a refresh token), **no Apple private key,
Team ID, or Key ID is required** — only the Services ID (`APPLE_CLIENT_ID`).

## Important files

Frontend:

- `public/assets/js/pages/auth-apple-init.js`
- `public/assets/css/auth.css` (`.auth-apple`, `.auth-apple-button`)
- `public/auth.html` (Apple buttons on the sign-in and sign-up panels)

Backend:

- `routes/apple-redirect-auth.js`
- `services/appleAuth.service.js`
- `routes/system.js` (`appleClientId` on `/api/v1/config`)
- `services/userProvenance.service.js` (`appleSignupProvenance`,
  `appleLinkProvenance`)

Tests:

- `tests/unit/apple-auth-service.test.js`
- `tests/integration/apple-auth-route.test.js`

## Step-by-step: Apple Developer setup

You need an active [Apple Developer Program](https://developer.apple.com/programs/)
membership (£79/$99 per year) to configure Sign in with Apple for a website.

### 1. Create an App ID

Sign in With Apple's web configuration (the "Services ID" in step 2) must be
linked to a "primary" App ID, even though EventFlow isn't a native app.

1. Go to [Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).
2. Click **+** → **App IDs** → **App** → Continue.
3. Description: `EventFlow`. Bundle ID (explicit): something like
   `uk.co.event-flow.app` (this is never shown to users — pick anything
   unique to your account).
4. Under **Capabilities**, tick **Sign In with Apple**, then Continue → Register.

### 2. Create a Services ID (this becomes your `APPLE_CLIENT_ID`)

1. Same [Identifiers](https://developer.apple.com/account/resources/identifiers/list)
   page → **+** → **Services IDs** → Continue.
2. Description: `EventFlow Web`. Identifier: e.g. `uk.co.event-flow.web`
   (must be different from the App ID's bundle ID). **Register this
   identifier — it is the value you set as `APPLE_CLIENT_ID`.**
3. Open the new Services ID, tick **Sign In with Apple**, click **Configure**:
   - **Primary App ID**: select the App ID created in step 1.
   - **Domains and Subdomains**: `event-flow.co.uk`
   - **Return URLs**: `https://event-flow.co.uk/api/auth/callback/apple`
     (no trailing slash — must match exactly).
4. Save, then Continue → Save on the Services ID itself.

### 3. Verify domain ownership

As part of step 2, Apple's "Configure" dialog will prompt you to verify the
domain. It provides a file named
`apple-developer-domain-association.txt` to download.

1. Download that file from Apple's dialog.
2. Add it to this repository at
   `public/.well-known/apple-developer-domain-association.txt`
   (the `public/.well-known/` directory already exists and is served
   statically — see `public/.well-known/security.txt` for reference).
3. Deploy, then click **Verify** in Apple's dialog once the file is live at
   `https://event-flow.co.uk/.well-known/apple-developer-domain-association.txt`.

### 4. Set the Railway environment variable

```env
APPLE_CLIENT_ID=uk.co.event-flow.web
BASE_URL=https://event-flow.co.uk
```

`BASE_URL` is already required for Google sign-in and email links, and is
reused here to build the Apple return URL — no separate variable needed.

There is nothing else to configure: no `APPLE_TEAM_ID`, `APPLE_KEY_ID`, or
private key, because EventFlow only verifies the ID token Apple posts back
— it does not call Apple's `/auth/token` endpoint. (Those extra
credentials would only be needed for a future feature such as revoking
tokens or requesting a refresh token.)

### 5. Register the sending domain for Apple's Private Email Relay (do this before launch)

If a user chooses to hide their email during Apple sign-in, Apple gives
EventFlow a private relay address (`@privaterelay.appleid.com`) instead of
their real one. Apple only forwards mail sent to that address **from a
sending domain you have registered with Apple** — unregistered senders are
silently dropped, so verification emails, notifications and password resets
would never reach these users otherwise.

1. In Apple Developer, go to **Certificates, Identifiers & Profiles → More →
   [Configure](https://developer.apple.com/account/resources/services/email-relay)**
   under "Sign in with Apple for Email Communication".
2. Add every domain Postmark actually sends from (the domain in
   `POSTMARK_FROM` / `EMAIL_DOMAIN`, e.g. `event-flow.co.uk` or a dedicated
   subdomain such as `mail.event-flow.co.uk`).
3. Apple also expects SPF/DKIM to be correctly configured for that sending
   domain (already required for Postmark deliverability generally — see
   Postmark's Sender Signatures/DKIM setup). If the sending domain differs
   from `event-flow.co.uk` (e.g. a dedicated `mail.` subdomain), Apple's
   Configure page may ask for a second domain-verification file specific to
   that domain — follow its on-screen instructions the same way as step 3.
4. Apple can disable relay forwarding for a domain that sends a high
   proportion of marketing/bulk mail to relay addresses. Keep relay-address
   mail to transactional messages (verification, password reset, booking and
   account notifications) consistent with EventFlow's existing marketing
   opt-in rules.

## Reference links

- [Configure Sign in with Apple for the web](https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web/)
- [Sign in with Apple JS documentation](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js)
- [Verifying a user (ID token) — Sign in with Apple REST API](https://developer.apple.com/documentation/sign_in_with_apple/verifying-a-user)
- [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
- [Communication using the private email relay service](https://developer.apple.com/help/account/configure-app-capabilities/communicate-using-the-private-email-relay-service/)
- [Sign in with Apple: Human Interface Guidelines (button style/logo)](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple) —
  EventFlow renders its own button (a solid-black pill, to match the existing
  Google button) rather than Apple's auto-rendered `#appleid-signin` widget;
  it is not pixel-identical to Apple's official button asset, which is an
  acceptable, commonly-used deviation for web integrations but can be revisited
  against this guide if desired.

## Redirect URI / Services ID mismatch checklist

When Apple shows an error on the authorize screen or silently redirects back
with `?apple=error`, check these in order:

1. Open `/api/v1/auth/apple/diagnostics` (or `/api/auth/apple/diagnostics`)
   and confirm `appleClientId` matches the Services ID identifier shown in
   Apple Developer exactly (case-sensitive).
2. Confirm the Services ID's **Return URLs** contains exactly
   `https://event-flow.co.uk/api/auth/callback/apple` — no trailing slash,
   no `www.`, correct scheme.
3. Confirm the Services ID's **Domains and Subdomains** contains
   `event-flow.co.uk`.
4. Confirm `public/.well-known/apple-developer-domain-association.txt` is
   live and matches what Apple issued (domain verification can silently
   expire/reset if the Services ID's domain is edited later).
5. Confirm Railway has redeployed after the PR merge and `APPLE_CLIENT_ID`
   is set.
6. Confirm there is no second Services ID being used unintentionally via
   `APPLE_CLIENT_IDS`.

## Manual callback behaviour

Opening this URL directly in a browser is not a successful login path:

```text
https://event-flow.co.uk/api/auth/callback/apple
```

A manual GET redirects back to `/auth?apple=callback_requires_post`. The
successful path is Apple's own `form_post` containing `id_token` and `state`.

## CSRF and replay protection

Apple has no equivalent of Google's automatic `g_csrf_token` double-submit
cookie for the redirect flow, so EventFlow implements the same protection
itself:

- `GET /api/auth/apple/nonce` issues a random value, returns it to the
  client, and stores it in a short-lived (10 minute), httpOnly,
  `SameSite=None; Secure` cookie (`apple_auth_nonce`) — `SameSite=None` is
  required because Apple's `form_post` back to EventFlow is a cross-site
  top-level navigation.
- The client embeds that same value in the encoded `state` sent to Apple,
  and also passes it as the OAuth `nonce` parameter.
- On callback, EventFlow requires the `state`'s embedded value to match the
  cookie (CSRF protection) **and** the ID token's `nonce` claim to match the
  same value (replay protection), then the cookie is cleared.

This only works over HTTPS in a real browser, so local testing against
`http://localhost` will not complete the Apple round trip — the same
constraint the existing Google flow already has via `BASE_URL`.
