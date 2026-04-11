# Supplier Verification Gating & Duplicate Cleanup — Pre-Merge Checklist

**PR scope:** Mop-up for PRs #879 and #880 — supplier verification gating, duplicate
supplier cleanup safety, and supplier directory diagnostics.

---

## 1. Running Tests, Lint, and the Server Locally

### Install dependencies

```bash
npm install
```

### Run the full unit-test suite

```bash
npx jest --no-coverage
# or, to run only relevant suites:
npx jest --testPathPatterns="supplier-duplicate-prevention|verification-gating|supplier-directory-health" --no-coverage
```

### Lint (if ESLint is configured)

```bash
npx eslint routes/ services/ utils/ middleware/ tests/
```

### Start the server locally

```bash
# Copy example env and set required values (see Section 5)
cp .env.example .env
# Then:
node server.js
# or with auto-restart:
npx nodemon server.js
```

---

## 2. Manual Smoke Tests

### 2a. Signup → Verify Email → Access Supplier Dashboard

1. Register a new account at `/signup.html`.
2. Check your inbox for the verification email (link should be `/verify?token=...`).
3. Click the link — you should be redirected to `/dashboard-supplier.html`
   (supplier) or `/dashboard-customer.html` (customer).
4. Without verifying, log in as the same user and try to create a plan or
   marketplace listing — you should get a `403 EMAIL_NOT_VERIFIED` response.

### 2b. Unverified User Blocked from Protected Actions

Using a user account whose email has **not** been verified, confirm each of the
following returns `403` with `code: "EMAIL_NOT_VERIFIED"`:

| Action                             | Endpoint                                      |
| ---------------------------------- | --------------------------------------------- |
| Create a plan                      | `POST /api/v1/me/plans`                       |
| Update a plan                      | `PATCH /api/v1/me/plans/:id`                  |
| Delete a plan                      | `DELETE /api/v1/me/plans/:id`                 |
| Save budget items                  | `POST /api/v1/me/plans/:id/budget`            |
| Create a marketplace listing       | `POST /api/v1/marketplace/listings`           |
| Update a marketplace listing       | `PUT /api/v1/marketplace/listings/:id`        |
| Delete a marketplace listing       | `DELETE /api/v1/marketplace/listings/:id`     |
| Save a marketplace listing         | `POST /api/v1/marketplace/saved/:listingId`   |
| Unsave a marketplace listing       | `DELETE /api/v1/marketplace/saved/:listingId` |
| Save a supplier/package            | `POST /api/v1/me/saved`                       |
| Unsave an item                     | `DELETE /api/v1/me/saved/:id`                 |
| Post a review (main reviews route) | `POST /api/v1/suppliers/:supplierId/reviews`  |
| Post a review (verified reviews)   | `POST /api/v1/reviews/with-verification`      |
| Create a messaging conversation    | `POST /api/v4/messenger/conversations`        |

These endpoints are gated by `requireVerifiedUser` in addition to `authRequired`.

### 2c. Admin Duplicate Scan + Dry-Run + Confirmed Cleanup

```bash
# 1. Identify duplicates (read-only, safe)
GET /api/admin/suppliers/duplicates
# Expected: { duplicateGroups: [...], missingOwnerSuppliers: [...] }

# 2. Run a dry-run cleanup (safe-by-default, dryRun=true is the default)
POST /api/admin/suppliers/cleanup-duplicates
Content-Type: application/json
{ "ownerUserId": "<user-id-with-duplicates>" }
# Expected: { ok: true, dryRun: true, wouldRemove: N, reassignmentPlan: {...} }

# 3. Trigger actual cleanup (requires confirm=true; dryRun must be explicitly false)
POST /api/admin/suppliers/cleanup-duplicates
Content-Type: application/json
{ "ownerUserId": "<user-id>", "dryRun": false, "confirm": true }
# Expected: { ok: true, dryRun: false, removed: N, reassignmentPlan: {...} }
```

Safety rules enforced by the endpoint:

- Empty / whitespace-only `ownerUserId` → `400 INVALID_OWNER_ID`
- `ownerUserId = "__no_owner__"` → `400 INVALID_OWNER_ID`
- `dryRun = false` without `confirm: true` → `400 CONFIRMATION_REQUIRED`

### 2d. Supplier Appears in Public Directory Only When Approved/Verified

1. Create a supplier profile for a user (it will be unapproved by default).
2. Search for the supplier at `GET /api/v1/search/suppliers?q=<name>` — it should
   **not** appear (only `approved === true` suppliers are listed publicly).
3. Approve the supplier via `POST /api/admin/suppliers/:id/approve`.
4. Repeat the search — the supplier should now appear.

**Investigating missing suppliers:**
Use the admin diagnostic endpoint to surface why a supplier might be excluded:

```bash
GET /api/admin/suppliers/directory-health
```

This returns:

- `noProfile` — users with `role=supplier` but no supplier profile record
- `notApproved` — profiles that exist but have `approved !== true`
- `orphaned` — profiles with no `ownerUserId`
- `missingName` — profiles with neither `name` nor `businessName`

---

## 3. Deployment Configuration Toggles

Set these in `.env` (or your cloud environment) before deploying:

| Variable           | Description                                                                          | Required           |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------ |
| `JWT_SECRET`       | Secret for signing JWT auth tokens                                                   | **Yes**            |
| `MONGODB_URI`      | MongoDB connection string                                                            | **Yes**            |
| `BASE_URL`         | Public base URL (e.g. `https://event-flow.co.uk`) — used in verification email links | **Yes**            |
| `POSTMARK_API_KEY` | Postmark API key for sending emails                                                  | For email features |
| `NODE_ENV`         | Set to `production` to enable production guards                                      | Recommended        |
| `CSRF_SECRET`      | CSRF protection secret                                                               | **Yes**            |

---

## 4. Key Code Locations

| Area                                | File(s)                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| Verification gating middleware      | `middleware/auth.js` → `requireVerifiedUser`                   |
| Plans write endpoints (gated)       | `routes/plans.js`                                              |
| Marketplace write endpoints (gated) | `routes/marketplace.js`                                        |
| Saved-items write endpoints (gated) | `routes/saved.js`                                              |
| Duplicate cleanup endpoint          | `routes/admin.js` → `POST /suppliers/cleanup-duplicates`       |
| Duplicate detection endpoint        | `routes/admin.js` → `GET /suppliers/duplicates`                |
| Supplier directory health           | `routes/supplier-admin.js` → `GET /suppliers/directory-health` |
| Supplier search service             | `services/searchService.js`                                    |
| Search relevance scoring            | `utils/searchWeighting.js`                                     |

---

## 5. Regression Test Coverage

The following test suites cover the changes in this PR:

- `tests/unit/supplier-duplicate-prevention.test.js` — duplicate cleanup safety
- `tests/unit/verification-gating-reviews-messenger.test.js` — reviews + messenger gating
- `tests/unit/verification-gating-plans-marketplace-saved.test.js` — plans / marketplace / saved gating _(new)_
- `tests/unit/supplier-directory-health.test.js` — directory diagnostics + businessName fix _(new)_
