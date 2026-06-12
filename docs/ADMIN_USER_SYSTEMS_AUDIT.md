# Admin User Systems Audit

> Produced for PR #1156 — Improve admin user management, supplier linkage and dashboard user overview.

---

## Current architecture (pre-PR)

### API endpoints powering each page

| Page                     | Primary endpoints                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `/admin` (Dashboard)     | `GET /api/admin/users` (full list, counted in JS), `GET /api/admin/metrics`, `GET /api/admin/suppliers/pending-verification` |
| `/admin-users` (Users)   | `GET /api/admin/users` (full list, filtered in JS)                                                                           |
| `/admin-user-detail`     | `GET /api/admin/users/:id` (raw user doc, minus password)                                                                    |
| `/admin-suppliers`       | `GET /api/admin/suppliers`                                                                                                   |
| `/admin-supplier-detail` | `GET /api/admin/suppliers/:id`                                                                                               |

### User→Supplier link

Suppliers are keyed by `ownerUserId`. The user list endpoint did not return supplier linkage data, so the Users page and dashboard had no way to show supplier profile status per user without a second N request per row.

---

## Gap analysis

| Gap                                                                                                                                                    | Impact                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `GET /users` returned only 7 fields — no `signupMethod`, `authProvider`, `verificationMethod`, or supplier link                                        | Admin could not see provenance or supplier status in the user list |
| `GET /users/:id` returned the raw user document minus only `password` — exposed `googleSub`, `resetToken`, `emailVerificationToken`, `authProviderIds` | Security: raw secrets visible in API response to any admin         |
| Dashboard fetched the full `/users` list and counted in JS                                                                                             | Performance: all user data loaded to count 4 numbers               |
| Dashboard and Users page used different counting logic                                                                                                 | Consistency: counts could diverge as code changed                  |
| User detail page was a single flat card with no provenance, no supplier link, no activity                                                              | Missing information: admin had to know where to look separately    |
| Admin registry label `'Users'` — not descriptive                                                                                                       | Navigation: unclear vs "Supplier Management"                       |
| No dynamic URL filter state                                                                                                                            | Linking: dashboard cards couldn't link to pre-filtered user views  |
| Bulk verify/suspend/delete had no role guards                                                                                                          | Safety: admin and owner accounts could be bulk-deleted             |

---

## Architecture decision

**Option C selected:** `/admin` remains the high-level dashboard; `/admin-users` becomes the Users Centre with summary cards, filters, and the full user table. `/admin-suppliers` is preserved (it has significant operational workflow for supplier approvals, package management, etc.) and linked from Users Centre.

**Why not Option B (new top-level page)?** Adding another tile would increase nav clutter without improving clarity. The existing `/admin-users` route is already in the nav and bookmarks; evolving it in-place is lower risk.

**Why not Option D (tabs)?** The prompt asks to avoid tabs if filters+cards are better. Filters + summary cards give the same segmentation with less UI friction and work better on mobile.

---

## Shared service: `services/adminUserSummary.service.js`

Created as the single source of truth for all user counting and projection logic:

- `buildUserSummary()` — used by dashboard AND Users Centre; counts are always identical
- `listUsers(opts)` — filtered, paginated, safe user projections
- `getUserDetail(id)` — safe enriched projection with supplier linkage
- `classifySignupMethod()` / `classifyVerificationMethod()` — provenance logic
- `buildAccountIssues()` — account health flag generator
- `projectUser()` — strips all secrets (passwordHash, googleSub, resetToken, verificationToken, authProviderIds)

---

## New API endpoints

| Endpoint                                 | Purpose                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/users/summary`           | Aggregated counts (total, byRole, bySignup, byVerification, supplier stats)                                                   |
| `GET /api/admin/users/list`              | Paginated, filtered, safe user list. Params: `role`, `signupMethod`, `verificationMethod`, `issue`, `search`, `page`, `limit` |
| `GET /api/admin/users/:id/detail`        | Safe enriched user projection with supplier linkage and account health                                                        |
| `GET /api/admin/users/summary?audience=` | Extended recipient count for campaigns page                                                                                   |

`GET /api/admin/users/:id` is also hardened to strip `googleSub`, `resetToken`, `resetTokenExpiresAt`, `verificationToken`, `emailVerificationToken`, `authProviderIds` in addition to `password`.

---

## Secrets that were exposed (now fixed)

The old `GET /api/admin/users/:id` stripped only `password`. The following were previously returned:

- `googleSub` — Google OAuth subject identifier
- `resetToken` — active password reset token (could be used to reset password)
- `resetTokenExpiresAt`
- `verificationToken` / `emailVerificationToken` — active verification tokens
- `authProviderIds` — contains the Google subject ID

All of the above are now stripped by both `GET /api/admin/users/:id` and by `projectUser()` in the service.

---

## File changes

| File                                               | Change                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `services/adminUserSummary.service.js`             | **New** — shared counting, projection, provenance service                                   |
| `routes/admin-user-management.js`                  | Added 3 new endpoints; hardened GET /users/:id secret stripping                             |
| `config/adminRegistry.js`                          | Renamed `'Users'` → `'Users Centre'`                                                        |
| `public/admin-users.html`                          | **Rewritten** as Users Centre (summary grid, filters, table, bulk bar)                      |
| `public/assets/js/pages/admin-users-init.js`       | **Rewritten** — summary cards, filter/search/pagination, safe bulk actions with role guards |
| `public/admin-user-detail.html`                    | **Rewritten** — proper panel structure (summary, provenance, supplier link, edit, activity) |
| `public/assets/js/pages/admin-user-detail-init.js` | **Rewritten** — uses `/detail` endpoint; renders provenance and supplier panels             |
| `public/assets/js/pages/admin-init.js`             | Updated to use `/users/summary` endpoint                                                    |
| `public/assets/css/admin-enhanced.css`             | Users Centre CSS (summary cards, filters, table, panels)                                    |
| `tests/unit/admin-user-systems.test.js`            | **New** — 47 tests for service, secret stripping, filtering, supplier linkage               |
| `tests/unit/admin-regression.test.js`              | Updated to match new Users Centre patterns                                                  |
| `tests/unit/admin-api-fixes.test.js`               | Updated to match new API endpoint patterns                                                  |
| `docs/ADMIN_USER_SYSTEMS_AUDIT.md`                 | This file                                                                                   |

---

## Manual QA checklist

1. Visit `/admin` — confirm user overview cards load with correct counts
2. Click a count card — should open Users Centre (URL-based filter pending JS update)
3. Visit `/admin-users` — confirm Users Centre loads with summary cards and user table
4. Confirm Google sign-up users show "Google" badge in sign-up column
5. Confirm email/password pending users show "Pending" in verification column
6. Confirm supplier users show supplier profile status and link
7. Try searching by name and email — results should update
8. Try role filter — confirm customer/supplier/admin filtering works
9. Open a user detail — confirm Account Provenance panel is visible
10. Confirm supplier-linked user has supplier profile panel with link
11. Confirm no raw googleSub, resetToken or password hashes appear in browser (DevTools → Network → API response)
12. Try bulk-selecting admin/owner accounts and confirm bulk delete/suspend are blocked with a message
13. Visit `/admin-supplier-detail?id=X` — verify linked user panel shows with link to user detail
