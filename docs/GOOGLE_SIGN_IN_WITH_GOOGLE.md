# EventFlow Google Sign-In implementation

This document records the current EventFlow Sign in with Google implementation, the investigation carried out during the Google login fault, and the required Google Cloud configuration.

## Current chosen flow

EventFlow uses Google Identity Services with a server-side redirect/login URI flow.

The intended flow is:

1. `/auth` loads `https://accounts.google.com/gsi/client`.
2. `google.accounts.id.initialize()` is called with the public OAuth web client ID.
3. The Google button is rendered with `google.accounts.id.renderButton()`.
4. Google posts the returned ID credential to EventFlow at `/api/auth/callback/google`.
5. EventFlow verifies Google's `g_csrf_token` double-submit token.
6. EventFlow verifies the Google ID token using `services/googleAuth.service.js`.
7. EventFlow finds, links, or creates the user.
8. EventFlow sets the normal auth cookie and redirects to the relevant dashboard.

## Important files

Frontend:

- `public/assets/js/pages/auth-google-init.js`

Backend:

- `routes/google-redirect-auth.js`
- `routes/auth.js`
- `services/googleAuth.service.js`
- `routes/system.js`

Tests:

- `tests/unit/google-auth-init-context.test.js`
- `tests/integration/google-auth-route.test.js`
- `tests/unit/google-auth-service.test.js`

## Required Google Cloud configuration

Google Auth Platform / OAuth Client must be a Web application client.

Authorised JavaScript origins:

```text
https://event-flow.co.uk
```

Authorised redirect URIs:

```text
https://event-flow.co.uk/api/auth/callback/google
```

There must be no trailing slash.

## Required Railway environment variables

The Google OAuth client ID must match the exact OAuth client that contains the redirect URI above.

```env
GOOGLE_CLIENT_ID=your-google-web-client-id.apps.googleusercontent.com
BASE_URL=https://event-flow.co.uk
JWT_SECRET=long-random-secret
MONGODB_URI=your-mongodb-uri
```

The Google client ID is public, but it must still point to the correct OAuth client. A common cause of `redirect_uri_mismatch` is editing one OAuth client in Google Cloud while Railway is serving a different client ID.

## Redirect URI mismatch checklist

When Google shows `Error 400: redirect_uri_mismatch`, check these in order:

1. Open `/api/v1/config` and confirm `googleClientId` is the same client ID shown in Google Cloud.
2. Confirm the Google Cloud OAuth client for that exact client ID contains `https://event-flow.co.uk/api/auth/callback/google`.
3. Confirm `public/assets/js/pages/auth-google-init.js` uses the same callback path.
4. Confirm Railway has redeployed after the PR merge.
5. Confirm the browser is not serving an old cached `auth-google-init.js` asset.
6. Confirm there is no second Google OAuth client being used via `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_CLIENT_IDS`.

## MongoDB note

MongoDB is only involved after Google successfully posts a credential back to EventFlow. If Google shows `redirect_uri_mismatch`, the request has not reached MongoDB or the EventFlow callback route yet.

## Manual callback behaviour

Opening this URL directly in a browser is not a successful login path:

```text
https://event-flow.co.uk/api/auth/callback/google
```

A manual GET should redirect back to `/auth?google=callback_requires_post`. The successful path is a Google form POST containing a credential and `g_csrf_token`.
