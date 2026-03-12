# Shortlist now requires login (guest shortlist removed)

**Date:** March 2026

## What changed

Guest/unauthenticated shortlist via `localStorage` has been removed.

Previously, `shortlist-manager.js` fell back to storing shortlist items in the browser's
`localStorage` when the user was not logged in. This produced a confusing UX where the
navbar showed **"Log in"** but supplier cards displayed **"❤️ Saved"**, as if the item
had been saved to an account.

## New behaviour (Option A)

- **Clicking "Save" while logged out** on the `/suppliers` page shows a brief toast:
  > "Please log in to save suppliers to your shortlist."
  …and redirects to `/auth?redirect=<encoded current URL>` (including all query params /
  filters) so the user lands back on the exact results page after signing in.
- **`hasItem()` always returns `false`** for unauthenticated users — no supplier card will
  ever be pre-marked as "Saved" for a guest.
- **`addItem()` / `removeItem()`** return `{ success: false, requiresAuth: true }` when
  unauthenticated, rather than mutating `localStorage`.
- **`mergeLocalStorageOnLogin()`** has been removed — there is no guest data to merge.
- **Stale `eventflow_shortlist` / `eventflow_shortlist_merged` localStorage keys** are
  cleared on the next page load so existing users are not affected by lingering data.

## Impact on authenticated users

None. Server-backed shortlist behaviour for logged-in users is unchanged.
