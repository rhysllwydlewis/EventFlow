# EventFlow Continue with Facebook implementation

This document records the EventFlow "Continue with Facebook" implementation
and the Meta (Facebook) Developer configuration required to make it work in
production.

## Current chosen flow

Unlike Google and Apple, Facebook access tokens are opaque (no signed ID
token EventFlow can verify locally), and Facebook has no `form_post`
redirect mode. EventFlow therefore uses a plain OAuth 2.0 **authorization
code** redirect flow, with no Facebook JavaScript SDK loaded on the page at
all — this keeps `connect.facebook.net` and Facebook's own tracking cookies
off `/auth` entirely until a user actually clicks through to facebook.com.

The intended flow is:

1. On button click, the browser fetches a one-time CSRF token from
   EventFlow (`GET /api/auth/facebook/csrf`), which also sets a short-lived
   cookie holding that same value.
2. The browser is redirected (full page navigation, not a popup) to
   Facebook's OAuth dialog
   (`https://www.facebook.com/v23.0/dialog/oauth`) with `client_id`,
   `redirect_uri`, `scope=email`, `response_type=code`, and an encoded
   `state` that embeds the CSRF token plus the intended destination and,
   for signups, the chosen account type/company/location.
3. The user authenticates and approves on Facebook's own domain.
4. Facebook redirects back with a plain GET to
   `/api/auth/callback/facebook?code=...&state=...` (or `?error=...` if the
   user declined).
5. EventFlow verifies the returned `state` against the CSRF cookie.
6. EventFlow exchanges the authorization `code` for an access token via the
   Graph API (`services/facebookAuth.service.js`) — this step requires the
   app secret, which is what proves the code was legitimately issued to
   EventFlow's own Facebook app.
7. EventFlow verifies the token via Graph API's `debug_token` (confirms it
   is valid and was issued for this app) and fetches the profile via
   `/me?fields=id,name,first_name,last_name,email,picture.type(large)`.
8. If Facebook does not return an email (the user denied the `email`
   permission, or has no confirmed email on their account), EventFlow
   rejects the sign-in with a clear message — every other EventFlow account
   requires an email address, so there is no well-defined account to create
   otherwise.
9. EventFlow finds, links, or creates the user, sets the normal auth
   cookie, and redirects to the relevant dashboard.

## Important files

Frontend:

- `public/assets/js/pages/auth-facebook-init.js`
- `public/assets/css/auth.css` (`.auth-facebook`, `.auth-facebook-button`)
- `public/auth.html` (Facebook buttons on the sign-in and sign-up panels)

Backend:

- `routes/facebook-redirect-auth.js`
- `services/facebookAuth.service.js`
- `routes/system.js` (`facebookAppId` on `/api/v1/config` — the app
  **secret** is never exposed here or anywhere else to the frontend)
- `services/userProvenance.service.js` (`facebookSignupProvenance`,
  `facebookLinkProvenance`)

Tests:

- `tests/unit/facebook-auth-service.test.js`
- `tests/integration/facebook-auth-route.test.js`

## Step-by-step: Meta (Facebook) Developer setup

1. Create or sign in to a [Meta for Developers](https://developers.facebook.com/)
   account.
2. Go to **My Apps → Create App**. Choose the "Consumer" (or current
   equivalent) app type, name it `EventFlow`, and complete creation.
3. On the app dashboard, **Add Product → Facebook Login → Set Up**.
4. In **Facebook Login → Settings**, set:
   - **Valid OAuth Redirect URIs**: `https://event-flow.co.uk/api/auth/callback/facebook`
     (no trailing slash — must match exactly what the backend sends).
   - Leave "Client OAuth Login" and "Web OAuth Login" enabled; the
     deprecated "Use Strict Mode for Redirect URIs" setting should stay on.
5. In **App Settings → Basic**, fill in the required fields for Meta's app
   review — most of these already exist in this repository:
   - **Privacy Policy URL**: `https://event-flow.co.uk/privacy`
   - **Terms of Service URL**: `https://event-flow.co.uk/terms`
   - **User Data Deletion**: use the "Data Deletion Instructions URL" option
     and set it to `https://event-flow.co.uk/data-rights` (EventFlow
     handles deletion requests by email rather than an automated callback
     endpoint, which Meta's console accepts as an instructions URL).
   - App icon and category (any accurate category, e.g. "Events").
6. Copy the **App ID** (shown on the dashboard) → this is `FACEBOOK_APP_ID`.
7. Go to **App Settings → Basic**, click **Show** next to **App Secret**
   → this is `FACEBOOK_APP_SECRET`. Treat it like any other server secret:
   never commit it, never send it to the frontend.
8. Switch the app from **Development** to **Live** (top of the dashboard).
   While in Development mode, only accounts added as Admins/Developers/
   Testers on the app can sign in — everyone else will see an error on
   Facebook's dialog. `email` and `public_profile` are Meta's standard
   permissions and do not require App Review to use once the app is Live,
   but Meta may still ask you to complete its business verification step
   before allowing Live mode — follow its on-screen instructions.

## Set the Railway environment variables

```env
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret
BASE_URL=https://event-flow.co.uk
```

`BASE_URL` is already required for Google/Apple sign-in and email links,
and is reused here to build the Facebook redirect URI — no separate
variable needed for that.

## Reference links

- [Meta for Developers](https://developers.facebook.com/)
- [Facebook Login for the Web](https://developers.facebook.com/docs/facebook-login/guides/access-tokens)
- [Manually Build a Login Flow (authorization code)](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow)
- [Graph API: debug_token](https://developers.facebook.com/docs/graph-api/reference/debug_token)
- [App Review permissions and features](https://developers.facebook.com/docs/app-review)
- [User data deletion callback / instructions URL](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/)

## Redirect URI mismatch checklist

When Facebook shows "Can't Load URL" or similar on its dialog, or silently
redirects back with `?facebook=error`, check these in order:

1. Open `/api/v1/auth/facebook/diagnostics` (or `/api/auth/facebook/diagnostics`)
   and confirm `facebookAppId` matches the App ID shown on the Meta
   dashboard exactly.
2. Confirm **Valid OAuth Redirect URIs** contains exactly
   `https://event-flow.co.uk/api/auth/callback/facebook`.
3. Confirm the app is switched to **Live** mode, or that the signing-in
   account has an Admin/Developer/Tester role on the app.
4. Confirm Railway has redeployed after the PR merge and both
   `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` are set.
5. `facebook_403` on the callback means Facebook did not return an email —
   ask the user to check they approved the `email` permission on Facebook's
   dialog.

## Manual callback behaviour

Opening this URL directly in a browser is not a successful login path:

```text
https://event-flow.co.uk/api/auth/callback/facebook
```

Without a `code` and a matching `state`/CSRF cookie, it redirects back to
`/auth?facebook=error&reason=missing_code` (or `facebook_csrf`). The
successful path is Facebook's own redirect from its OAuth dialog.

## CSRF protection

Facebook's redirect back is a plain top-level GET (unlike Apple's
`form_post`), so the standard OAuth `state` double-submit pattern applies
directly: `GET /api/auth/facebook/csrf` issues a random value in both the
JSON response and a short-lived, httpOnly, `SameSite=Lax` cookie
(`facebook_auth_csrf`) — `Lax` is sufficient here because it still allows
the cookie on cross-site top-level **GET** navigations, unlike the `POST`
case Apple's flow has to work around. The client embeds that same value in
the encoded `state` sent to Facebook, and the callback requires it to match
the cookie before doing anything else.
