# Account Type Conversion — Implementation Plan

> Planning document only. No functional code has been changed. This is the design
> for a future PR that lets a signed-in user self-serve convert their account
> between `customer` and `supplier` from Account Settings — e.g. the reported case
> of a user who meant to sign up as a supplier but accidentally chose "customer".

---

## 1. Trigger

A user reported they registered as a `customer` when they meant to register as a
`supplier`. Today there is **no self-service way to fix this** — the only options
are:

- Contact support and have an **admin** manually flip their role via
  `PATCH /api/admin/users/:id` (`routes/admin-user-management.js`), or
- Register a second account with a different email.

This plan adds a self-service "Account Type" section to `/settings` that lets a
`customer` become a `supplier` (and vice versa), reusing as much of the existing
supplier-provisioning and verification machinery as possible.

---

## 2. Current architecture (what already exists)

### 2.0 No ORM, no migration framework

EventFlow does not use Sequelize/Mongoose/Prisma. `db-unified.js` is a thin,
generic `read/find/findOne/insertOne/updateOne/deleteOne` abstraction over
MongoDB (or a JSON-file store in dev/test), and `models/*.js` files are
**documentation + `$jsonSchema` validator definitions**, not runtime classes.
Practically: there is no migration to write for this feature. "Schema change"
just means adding fields to the `$jsonSchema` validator in `models/index.js`
(additive, non-breaking) and starting to write them at runtime — existing
documents without the new fields remain valid.

### 2.1 Role model

- `role` is a single enum field on the `users` collection: `customer | supplier | admin`
  (`USER_ROLES` in `models/index.js:24`, enforced by the Mongo `$jsonSchema`
  validator at `models/index.js:58-150`).
- There is **no separate "player" concept** — the platform only has these three
  roles. (Confirmed with the user: "player" was a dictation slip for "supplier".)
- Suppliers are **not** just a role flag — a `supplier` user has a linked document
  in the separate `suppliers` collection, keyed by `ownerUserId` (`models/index.js:163`,
  `models/Supplier.js`). This is where business name, category, location, gallery,
  pricing, verification status, Pro subscription state, etc. live.
- A `customer` has no linked collection — all their fields live on the `users` doc.

### 2.2 Signup flow (`routes/auth.js`, `POST /register`)

- `role` is chosen at signup (`routes/auth.js:295`), defaulting to `customer`.
- The same registration handler also backs Google OAuth signup (`routes/auth.js`,
  ~line 861 onward) — same `roleFinal` resolution, same required-field rules, same
  risk guard. Any shared validation we extract for the conversion flow should be
  reused by (or kept in sync with) both entry points.
- The signup form itself lives in `public/auth.html`: a `#reg-role-picker`
  radiogroup with `data-role="customer"` / `data-role="supplier"` pills writing
  into a hidden `role` input, and a `#supplier-fields` block (company, job
  title, website, 4 social links) shown/hidden by
  `public/assets/js/pages/auth-form-init.js` / `auth-init.js`. This is the
  component to crib from for the new Settings conversion form, rather than
  building the field set from scratch.
- **Category is *not* collected at signup today** — new suppliers default to
  `category: 'Other'` (`supplierProfileProvisioning.service.js:127`) and set
  it later from the supplier dashboard. The conversion flow should decide
  deliberately whether to collect category up front (recommended — it's
  required for marketplace discovery and it's a small addition to the form)
  rather than silently inheriting the same "default to Other" gap.
- If `role === 'supplier'`:
  - Gated behind the `supplierApplications` feature flag (`routes/auth.js:217-226`).
  - `company` becomes a required field (`routes/auth.js:304-306`).
  - Runs through `supplierRegistrationRiskGuard` (anti-abuse) before the user is created.
  - After the user is created, `ensureSupplierProfileForUser()` provisions the
    linked `suppliers` doc (`routes/auth.js:460-486`); if provisioning fails the
    user row is rolled back — registration is all-or-nothing.
  - `partnerRegistrationRisk.completeRegistrationRisk()` runs supplier-specific
    fraud/risk scoring (`routes/auth.js:444-458`).
  - A referral (`?ref=`) is only recorded for `role === 'supplier'` signups
    (`routes/auth.js:489-495`).

### 2.3 The reusable building block: `supplierProfileProvisioning.service.js`

`services/supplierProfileProvisioning.service.js` already exports
`ensureSupplierProfileForUser(user)`:

- Idempotent — returns the existing `suppliers` doc if one already exists for
  `ownerUserId`, otherwise creates a `draft`, `profileComplete: false` one with
  safe defaults and correct verification defaults (auto-approve vs
  `unverified`, per the `autoApproveSupplierVerification` setting).
- Already used in **four** call sites: registration (`routes/auth.js`), and
  **three places in `routes/admin-user-management.js`** where an admin changes
  a user's role to `supplier` (lines ~374, ~1970, ~2364) — including rollback of
  the role change if provisioning fails.
- This means an *admin-initiated* role-change-to-supplier flow already exists
  and is tested (`tests/unit/supplier-profile-provisioning-hardening.test.js`,
  `tests/unit/admin-supplier-maintenance.test.js`). We should reuse this
  service, not reinvent it, and extend the same safety pattern (transactional
  rollback on provisioning failure) to the self-service path.
- **Gap**: nothing today handles the reverse — going `supplier → customer`
  never touches the `suppliers` doc, so it would be left dangling (still
  `published`/live in the marketplace) if the raw admin PATCH endpoint is used
  today with no supplier-side cleanup at all.
- A second admin endpoint, `POST /api/admin/users/:id/revoke-admin`
  (`routes/admin-user-management.js:2310-2417`), already tracks a
  **`previousRole` field** when changing a user's role (line ~2353). We should
  align with this existing convention (`previousRole` on the user doc) rather
  than inventing a separate history array, unless we specifically need a full
  multi-conversion audit trail (see §4.3).
- Both existing admin role-change endpoints already call
  `auditLog({ action: AUDIT_ACTIONS.USER_ROLE_CHANGED, ... })`
  (`middleware/audit.js`) — the self-service flow should emit the same
  `USER_ROLE_CHANGED` action (with an `initiatedBy: 'self'` detail) rather than
  a bespoke action type, so admin activity views don't need to know about two
  parallel logging schemes.
- `routes/profile.js`'s **`DELETE /` (full account deletion)** handler
  (lines 440-517) is the closest existing precedent for unwinding a supplier
  account: it calls `subscriptionService.cancelSubscriptionForAccountDeletion()`
  (`services/subscriptionService.js:532-563`) to cancel any live Stripe
  subscription, then deletes the user's `suppliers` row(s). A supplier→customer
  **conversion** should reuse the same subscription-cancellation call (deletion
  isn't right — the profile is suspended, not removed — but the billing
  teardown logic is exactly what's needed).

### 2.4 Supplier verification state machine

Documented in `docs/supplier-verification.md`. Every supplier profile has
`verificationStatus`: `unverified → pending_review → approved` (plus
`needs_changes`, `rejected`, `suspended`). A newly-provisioned supplier profile
starts `unverified`. **A customer→supplier conversion should plug into this
exact state machine** — the converted user lands in `unverified` (or
auto-approved per the same setting used at signup) and goes through the same
`POST /api/supplier/verification/submit` flow suppliers already use.

### 2.5 Settings page (`public/settings.html`, `routes/settings.js`, `routes/profile.js`)

- `routes/settings.js` currently only handles notification preferences
  (`GET/POST /api/me/settings`) — no account-type logic today.
- `routes/profile.js` handles profile field edits (`PUT /api/profile`), avatar
  upload/delete, and account deletion — again, no role logic.
- `public/settings.html` **already conditionally shows a supplier callout**
  (`#supplier-profile-callout`, line 384) that just links suppliers to
  `/dashboard/supplier` for business-profile edits — there's no UI today for
  changing account type at all. This is the natural home for the new section.

### 2.6 Auth/session: role is baked into the JWT

`middleware/auth.js:199-207` attaches `req.user.role` from the **decoded JWT
cookie**, not a fresh DB read (a separate DB read (`dbUser`) is done, but only
used for name/avatar/business fields, not role). `services/auth.service.js:372`
(`generateToken`) signs `{ id, email, role }` into the JWT at login/register.

**Consequence for this feature: flipping `role` in the database alone will not
change a logged-in user's effective permissions.** The conversion endpoint
must re-issue the auth cookie/JWT (same call as login) so `roleRequired()`
middleware, `/dashboard` redirects (`routes/dashboard.js:22-35`), and the
navbar all see the new role immediately, without forcing a logout/login.

### 2.7 Where `role` is read elsewhere (blast radius)

`user.role === 'supplier' | 'customer'` checks exist in 34 files. Most are
route guards (`roleRequired('supplier')`) that will just work once the token
is reissued. The ones that need explicit design attention for this plan:

| Area | File | Why it matters |
| --- | --- | --- |
| Referral/partner risk scoring | `routes/auth.js:444-458, 489-495` | Currently only runs at registration; a converted-to-supplier user skips it entirely unless we deliberately invoke the equivalent check |
| Anti-abuse | `middleware` used as `supplierRegistrationRiskGuard` | Same as above — designed for the register endpoint, needs a decision on whether/how to apply to conversion |
| Pro subscription / billing | `models/Supplier.js` (`isPro`, `stripeCustomerId`, `subscriptionStatus`) | A paying supplier converting to customer has a live Stripe subscription attached to the supplier doc, not the user — needs explicit handling (see §6) |
| Badges | `BADGE_TYPES` (`founder, pro, pro-plus, verified, featured, custom`) on `users.badges` | Some badges are supplier-earned (`verified`, `pro`); converting away from supplier should not silently keep a `verified` badge that no longer means anything |
| Messenger | `routes/messenger-v4.js:429`, `services/messenger-v4.service.js:1531-1536` | Displays participant role/label in conversations — cosmetic, but should reflect the new role going forward |
| Community | `services/community.service.js:1153-1187` | Role affects badge/label rendering (`isOfficial`, moderator flags) on posts — cosmetic, same as messenger |
| Dashboard redirects | `routes/dashboard.js:22-35`, `public/assets/js/pages/dashboard-redirect.js` | Both server- and client-side redirect logic branch on `role` — both need the refreshed role to avoid bouncing a converted user to the wrong dashboard |
| `GET /api/v1/auth/me` | `routes/auth.js:1779` onward | Already conditionally fetches the `suppliers` row and returns `supplierApproved` only when `role === 'supplier'` — natural place to also surface "eligible to convert" / cooldown-remaining metadata for the Settings UI |
| Admin dashboards | `services/adminUserSummary.service.js`, `/admin-users` | Already counts `byRole` and filters by role — will naturally reflect conversions once `role` changes; self-service conversions should be visible/auditable to admins (see §7) via the shared `USER_ROLE_CHANGED` audit action |
| Admin RBAC cache | `middleware/permissions.js` (`PermissionCache`, 5-min in-memory, keyed by `user.id`) | This is for the separate owner/admin/moderator/support RBAC layer, not customer/supplier — shouldn't need invalidation for this feature, but flagged here as the pattern to check for "is there a role-keyed cache we're forgetting" during implementation |

Bookings/enquiries/reviews were checked and are **not** role-gated by
`user.role` directly — they key off supplier/customer IDs on the
booking/review/enquiry record itself, so historical records are unaffected by
a role flip. That's good: it limits blast radius mostly to the *current*
capabilities and the linked `suppliers` doc, not historical data.

---

## 3. Proposed design

### 3.1 UX flow

**New "Account Type" section in `/settings`**, below Account Information:

- Shows current type (`Customer` / `Supplier`) with a short explanation of what
  each can do.
- **Customer → Supplier ("Become a supplier")**
  1. Click "Switch to a supplier account".
  2. Inline form collects the same required fields as signup for suppliers:
     business/company name, category (from `Supplier.VALID_CATEGORIES`),
     location, phone — reusing the registration form's client-side validation
     (`public/assets/js/pages/auth-init.js`) rather than duplicating it.
  3. Submit → backend flips `role`, provisions/reactivates the `suppliers` doc,
     reissues the session, and redirects to `/dashboard/supplier`, where the
     user completes the existing verification-submission flow
     (`docs/supplier-verification.md`) to go live in the marketplace.
  4. Gated behind the same `supplierApplications` feature flag used at
     signup, and the same anti-abuse guard, so this can't be used to bypass
     controls that already exist for becoming a supplier.
- **Supplier → Customer ("Switch to a customer account")**
  1. Click "Switch to a customer account".
  2. Confirmation modal explains the consequences in plain language (see §3.3)
     and requires explicit confirmation (typed confirmation or password
     re-entry — a step-up-auth pattern already used elsewhere for account
     deletion in `routes/profile.js`).
  3. Submit → backend flips `role`, suspends (not deletes) the `suppliers` doc,
     reissues the session, redirects to `/dashboard/customer`.

### 3.2 Reactivation, not re-creation, on repeat conversions

If a user converts `supplier → customer → supplier` again, we should **not**
create a second `suppliers` doc (the `ownerUserId` unique-per-owner assumption
used throughout the codebase must hold). `ensureSupplierProfileForUser()`
already returns the existing doc unchanged if one exists — we extend this
lightly so that a *suspended-by-conversion* profile is reactivated (status
reset to `draft`, previous business data preserved) rather than left
suspended, and the verification state resumes where the state machine already
allows it (`suspended → approved/rejected` per the admin table, so re-entry
should probably route back to `pending_review` for re-check rather than
silently going straight back to `approved`).

### 3.3 What "switch to customer" means for existing supplier data

Decision needed (flagged as an open question in §8), but the recommended
default: **suspend, don't delete.**

- `suppliers.status` → `suspended` (a value the schema already supports,
  `Supplier.VALID_STATUSES`), which already removes the listing from public
  marketplace/search per existing status-based query filters.
- Existing bookings/enquiries/reviews tied to the supplier profile are
  untouched (historical).
- Any **pending** enquiries/quote requests should surface a clear notice to
  the customers who sent them (existing `NOTIFICATION_TYPES` already includes
  `system`/`update`, reusable for this).
- Active Pro subscription: must be explicitly handled, not silently left
  running against a suspended profile (see §6, open question).

---

## 4. Backend changes

### 4.1 New service — `services/accountTypeConversion.service.js`

Single place owning the conversion transaction:

- `convertToSupplier(user, supplierInfo)` — validates required fields (mirrors
  `routes/auth.js:295-306` validation), updates `users.role`, calls
  `ensureSupplierProfileForUser()` (reactivating a suspended profile if one
  exists per §3.2), writes an audit trail entry, rolls back the role change if
  provisioning fails (same pattern as `routes/admin-user-management.js:1970-1989`).
- `convertToCustomer(user)` — updates `users.role`, suspends the linked
  `suppliers` doc, writes an audit trail entry. Returns enough detail for the
  route layer to warn about (e.g.) an active subscription.
- Both set `previousRole` on the user doc (aligning with the existing
  convention from `POST /api/admin/users/:id/revoke-admin`, rather than
  inventing a parallel field), and call the existing `auditLog()` helper
  (`middleware/audit.js`) with the **existing** `AUDIT_ACTIONS.USER_ROLE_CHANGED`
  action (detail: `{ initiatedBy: 'self', from, to }`) — reusing the same
  action type the admin-driven flows already emit means admin activity views
  don't need new logic to surface self-service conversions.
- Enforces a cooldown (e.g. one self-service conversion per rolling 30 days,
  tracked via `users.lastAccountTypeChangeAt`) to prevent role oscillation
  abuse (gaming referral bonuses, badge eligibility, or verification review
  queues).

### 4.2 New route(s) — extend `routes/settings.js` (or new `routes/account-type.js`)

`POST /api/settings/account-type`

- Middleware: `authRequired`, `csrfProtection`, `writeLimiter` (or a
  dedicated, stricter limiter given the sensitivity), `featureRequired`
  against a flag (reuse `supplierApplications` for the customer→supplier
  direction; consider whether a separate `accountTypeSelfConversion` kill
  switch is warranted for an admin to disable the *feature* independently of
  new-supplier-signups — see §6).
- Body: `{ targetRole: 'supplier' | 'customer', supplierInfo?: {...} }`.
- Explicitly rejects `targetRole === 'admin'` and rejects conversion *from*
  `admin` — admin role changes stay admin-only via the existing
  `admin-user-management.js` endpoints.
- On success: calls the service, **reissues the auth cookie** using the same
  `generateToken`/cookie-setting call used by `POST /register` and
  `POST /login` in `routes/auth.js`, and returns the new role + redirect
  target so the frontend can navigate without a full logout/login.
- Reuses `supplierRegistrationRiskGuard` for the customer→supplier direction
  so this can't be used as a side door around the anti-abuse checks that
  apply to normal supplier signup.

### 4.3 Touch points to update

| File | Change |
| --- | --- |
| `services/accountTypeConversion.service.js` | **New** |
| `routes/settings.js` | New `POST /api/settings/account-type` endpoint |
| `services/supplierProfileProvisioning.service.js` | Extend to support reactivating a `suspended`-by-conversion profile instead of only "create or return as-is" |
| `models/index.js` | Add `previousRole`, `lastAccountTypeChangeAt` to the `users` `$jsonSchema` (additive, non-breaking; `USER_ROLE_CHANGED` audit action already exists, no new `AUDIT_ACTIONS` entry needed) |
| `models/Supplier.js` | Document the "suspended by self-conversion" convention if we track a reason (e.g. `suspendedReason: 'owner_converted_to_customer'`) |
| `public/settings.html` | New "Account Type" section markup (reusing the field set from `public/auth.html`'s `#supplier-fields` block) |
| `public/assets/js/pages/settings-init.js` | Conversion form, validation, confirmation modal, session refresh after success |
| `public/assets/js/pages/dashboard-redirect.js` | No logic change expected (already redirects on `role`), but must be exercised in QA/e2e immediately after a conversion to confirm it picks up the refreshed cookie |
| `services/adminUserSummary.service.js` / `/admin-users` | No functional change expected, but self-service conversions should already show up via existing `byRole` counts and audit log — verify in QA |

---

## 5. Testing plan

Following existing repo conventions:

- **Unit** (`tests/unit/`): new `account-type-conversion.test.js` mirroring the
  style of `tests/unit/supplier-profile-provisioning-hardening.test.js` —
  idempotency, rollback-on-provisioning-failure, cooldown enforcement, audit
  log calls, rejection of `admin` as a source/target role, reactivation of a
  suspended profile.
- **Integration** (`tests/integration/`): new
  `account-type-conversion-route.test.js` mirroring
  `tests/integration/auth-account-security.test.js` and, more directly,
  `tests/unit/profile-account-deletion.test.js` /
  `tests/unit/profile-validation.test.js` (the closest existing analogs, since
  those cover `routes/profile.js`, the sibling settings/account route with
  its own subscription-cancellation and cascade-cleanup behaviour) — auth
  required, CSRF required, feature-flag gating (`supplierApplications` off →
  503), rate limiting, cookie reissued with new role claim, `suppliers` doc
  created/suspended/reactivated as expected.
- **Schema drift guard**: `previousRole` reuses the existing `USER_ROLES` enum
  values, so no new enum is introduced — but re-run
  `tests/integration/schema-enum-drift.test.js` to confirm the new
  `$jsonSchema` fields (`previousRole`, `lastAccountTypeChangeAt`) don't
  desync from the service layer.
- **Regression**: re-run `tests/unit/admin-user-systems.test.js`,
  `tests/unit/admin-supplier-maintenance.test.js`, and
  `tests/unit/supplier-profile-provisioning-hardening.test.js` to confirm the
  admin-initiated role-change path (which now shares the reactivation logic)
  is unaffected.
- **E2E** (`e2e/`): new `account-type-conversion.spec.js` (naming to match
  `e2e/customer-enquiry-flow.spec.js`, `e2e/auth.spec.js`) covering:
  customer converts to supplier via the Settings UI, fills the required
  business fields, lands on the supplier dashboard, unverified; supplier
  converts to customer, sees the confirmation modal with consequences, and
  loses supplier nav/routes after confirming.

---

## 6. Open questions (need a product decision before implementation)

1. **Active Pro subscription on downgrade.** If a supplier with an active paid
   subscription (`suppliers.isPro`, `stripeCustomerId`) converts to customer,
   do we auto-cancel the Stripe subscription, let it run out and then lapse,
   or block the conversion until they cancel billing themselves? A precedent
   already exists — `subscriptionService.cancelSubscriptionForAccountDeletion()`
   (`services/subscriptionService.js:532-563`) — used today when a supplier
   deletes their account entirely. **Recommendation: reuse that same
   cancellation call on supplier→customer conversion** (immediate cancel, not
   run-to-period-end, for consistency with the existing deletion behaviour)
   rather than inventing a new billing rule — but this still needs sign-off
   since it affects revenue, not just data cleanup.
2. **Re-verification on reactivation.** When a previously-approved supplier
   converts back, should they re-enter `pending_review` (safer, consistent
   with "changed profile → re-review") or resume `approved` if nothing about
   the business changed? Recommendation: `pending_review`, but confirm with
   whoever owns trust & safety for supplier verification.
3. **Cooldown length / max conversions.** Proposed 30-day cooldown — is that
   the right balance between "fix a genuine mistake quickly" and "prevent
   abuse"?
4. **Step-up auth for supplier→customer.** Password re-entry vs typed
   confirmation vs neither — how much friction is warranted given this is a
   less risky direction than customer→supplier (no anti-abuse guard needed)?
5. **Badge handling.** Do supplier-earned badges (`verified`, `pro`) get
   stripped on downgrade, kept dormant, or reinstated automatically on
   reactivation?
6. **Kill switch scope.** Reuse the existing `supplierApplications` flag for
   gating the customer→supplier conversion direction, or introduce a
   dedicated flag so support/product can disable self-service conversion
   independently of new-signup supplier applications?

---

## 7. Suggested phasing

1. Backend: service + route + reuse of `ensureSupplierProfileForUser` +
   reactivation support + audit logging + unit/integration tests.
2. Frontend: Settings UI (both directions) + e2e tests.
3. Downgrade edge cases: subscription handling, badge handling, pending
   enquiry notices (depends on answers to §6).
4. Docs: new `docs/ACCOUNT_TYPE_CONVERSION.md` (user/support-facing,
   analogous to `docs/supplier-verification.md`) once behaviour is final.

---

## 8. Summary of files a future PR will likely touch

```
NEW    services/accountTypeConversion.service.js
NEW    tests/unit/account-type-conversion.test.js
NEW    tests/integration/account-type-conversion-route.test.js
NEW    e2e/account-type-conversion.spec.js
NEW    docs/ACCOUNT_TYPE_CONVERSION.md              (post-implementation, user-facing)
EDIT   routes/settings.js
EDIT   services/supplierProfileProvisioning.service.js
EDIT   models/index.js
EDIT   public/settings.html
EDIT   public/assets/js/pages/settings-init.js       (or equivalent settings page script)
```
