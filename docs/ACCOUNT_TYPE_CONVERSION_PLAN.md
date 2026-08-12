# Account Type Conversion — Implementation Plan

> Planning document only. No functional code has been changed. This is the design
> for a future PR that lets a signed-in user self-serve convert their account
> between `customer` and `supplier` from Account Settings — e.g. the reported case
> of a user who meant to sign up as a supplier but accidentally chose "customer" —
> **and** gives admins an equivalent, properly guarded conversion action for
> support cases, replacing today's unguarded role dropdown (§5).

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
supplier-provisioning and verification machinery as possible — plus a matching
admin-side capability (§5), since support will need to do this on a user's
behalf, and the investigation below found that even today's admin tooling
doesn't handle the `supplier → customer` direction correctly.

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
- Already used in **six** call sites total: registration (`routes/auth.js:462`),
  three places in `routes/admin-user-management.js` where an admin changes a
  user's role to `supplier` (lines 376, 1972, 2365 — each with rollback of the
  role change if provisioning fails), and two admin *repair* tools — a
  single-user re-provision action (line 2594) and a bulk backfill loop over
  all `role: 'supplier'` users missing a `suppliers` doc (line 2639). Those
  last two are a useful operational precedent: if the new conversion flow
  ever leaves a supplier user without a profile (e.g. a crash mid-transaction),
  this existing bulk-repair tool already fixes it — no new tooling needed
  there.
- This means an *admin-initiated* role-change-to-supplier flow already exists
  and is tested (`tests/unit/supplier-profile-provisioning-hardening.test.js`,
  `tests/unit/admin-supplier-maintenance.test.js`). We should reuse this
  service, not reinvent it, and extend the same safety pattern (transactional
  rollback on provisioning failure) to the self-service path.
- **Gap**: nothing today handles the reverse — going `supplier → customer`
  never touches the `suppliers` doc, so it would be left dangling (still
  `published`/live in the marketplace) if the raw admin PATCH endpoint is used
  today with no supplier-side cleanup at all.
- **Correction after re-verifying against the code directly** (an earlier pass
  of this plan over-generalized this): there are actually **two different**
  admin role-change code paths, with different behaviour, and only one of
  them is a real precedent for a clean customer↔supplier converter:
  - `PUT /api/admin/users/:id` (`routes/admin-user-management.js:1887-2011`,
    the general admin "edit user" form) accepts an arbitrary `role` field in
    its body. Going `!== 'supplier' → 'supplier'` provisions the `suppliers`
    doc via `ensureSupplierProfileForUser`, with rollback on failure
    (lines 1970-1989) — but its audit entry uses the **generic**
    `action: 'user_edited'` (line 1995), not a role-specific action, and
    **going `supplier → customer` through this endpoint does nothing to the
    `suppliers` doc at all** — it's just silently left `published`/live. This
    is the "edit any field" endpoint, not a dedicated conversion tool.
  - `POST /api/admin/users/:id/grant-admin` and
    `POST /api/admin/users/:id/revoke-admin`
    (`routes/admin-user-management.js:2230-2305` and `2310-2417`) are
    specifically for admin-privilege grant/revoke, **not** a general
    customer↔supplier tool — but they *do* set the pattern worth reusing:
    they stamp `previousRole` onto the user doc (lines 2271, 2353) and log
    `auditLog({ action: AUDIT_ACTIONS.USER_ROLE_CHANGED, ... })`
    (`middleware/audit-actions.js:20`, used at lines 2284 and 2396) — a
    dedicated, filterable audit action that the generic `user_edited` action
    doesn't give admins. `revoke-admin`'s `newRole: 'supplier'` branch also
    calls `ensureSupplierProfileForUser` with the same rollback pattern, but
    (same gap) its `newRole: 'customer'` branch does not touch `suppliers`.
  - **Conclusion: today, no code path fully and correctly handles
    `supplier → customer` — not even the admin ones.** This is a real,
    pre-existing gap, not just something new the self-service feature needs
    to solve. It strengthens the case in §5 for a single shared
    `accountTypeConversion.service.js` used by *both* the new self-service
    endpoint and a new/refactored admin action, rather than admin reusing the
    raw `PUT /api/admin/users/:id` body-field approach as-is.
- We should align with the `previousRole` field convention (rather than
  inventing a separate history array) and use `AUDIT_ACTIONS.USER_ROLE_CHANGED`
  (rather than generic `user_edited`) for both the self-service and the new
  admin conversion action, so all customer↔supplier conversions — regardless
  of who initiated them — show up consistently in admin activity views
  (detail: `{ initiatedBy: 'self' | 'admin', adminActorId?, from, to }`).
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
| Pro subscription / billing | `models/Supplier.js` (`isPro`, `stripeCustomerId`, `subscriptionStatus`) | A paying supplier converting to customer has a live Stripe subscription attached to the supplier doc, not the user — needs explicit handling (see §7) |
| Badges | `BADGE_TYPES` (`founder, pro, pro-plus, verified, featured, custom`) on `users.badges` | Some badges are supplier-earned (`verified`, `pro`); converting away from supplier should not silently keep a `verified` badge that no longer means anything |
| Messenger | `routes/messenger-v4.js:429`, `services/messenger-v4.service.js:1531-1536` | Displays participant role/label in conversations — cosmetic, but should reflect the new role going forward |
| Community | `services/community.service.js:1153-1187` | Role affects badge/label rendering (`isOfficial`, moderator flags) on posts — cosmetic, same as messenger |
| Dashboard redirects | `routes/dashboard.js:22-35`, `public/assets/js/pages/dashboard-redirect.js` | Both server- and client-side redirect logic branch on `role` — both need the refreshed role to avoid bouncing a converted user to the wrong dashboard |
| `GET /api/v1/auth/me` | `routes/auth.js:1779` onward | Already conditionally fetches the `suppliers` row and returns `supplierApproved` only when `role === 'supplier'` — natural place to also surface "eligible to convert" / cooldown-remaining metadata for the Settings UI |
| Admin dashboards | `services/adminUserSummary.service.js`, `/admin-users` | Already counts `byRole` and filters by role — will naturally reflect conversions once `role` changes; self-service conversions should be visible/auditable to admins (see §5) via the shared `USER_ROLE_CHANGED` audit action |
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

Decision needed (flagged as an open question in §7), but the recommended
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
  running against a suspended profile (see §7, open question).

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

`routes/settings.js` is mounted at `/api/v1/me/settings` (`server.js:840`), so a
new `router.post('/account-type', ...)` there resolves to:

`POST /api/v1/me/settings/account-type`

- Middleware: `authRequired`, `csrfProtection`, `writeLimiter` (or a
  dedicated, stricter limiter given the sensitivity). For the feature flag:
  note that `supplierApplications` is **not** gated via the generic
  `featureRequired()` factory — it's a manual conditional check inline in the
  route chain (`routes/auth.js:215-229`: `if (req.body.role === 'supplier') { const features = await getFeatureFlags(); if (!features.supplierApplications) return 503; }`),
  because it only applies when the target role is `supplier`. The conversion
  route should copy that same inline pattern (checking `req.body.targetRole`)
  rather than trying to force it through `featureRequired()`. Consider
  whether a separate `accountTypeSelfConversion` kill switch is warranted for
  an admin to disable the *conversion feature* independently of new-supplier
  signups — see §7.
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
| `routes/settings.js` | New `POST /account-type` (resolves to `POST /api/v1/me/settings/account-type`) |
| `services/supplierProfileProvisioning.service.js` | Extend to support reactivating a `suspended`-by-conversion profile instead of only "create or return as-is" |
| `models/index.js` | Add `previousRole`, `lastAccountTypeChangeAt` to the `users` `$jsonSchema` (additive, non-breaking; `USER_ROLE_CHANGED` audit action already exists, no new `AUDIT_ACTIONS` entry needed) |
| `models/Supplier.js` | Document the "suspended by self-conversion" convention if we track a reason (e.g. `suspendedReason: 'owner_converted_to_customer'`) |
| `public/settings.html` | New "Account Type" section markup (reusing the field set from `public/auth.html`'s `#supplier-fields` block) |
| `public/assets/js/pages/settings-init.js` | Conversion form, validation, confirmation modal, session refresh after success |
| `public/assets/js/pages/dashboard-redirect.js` | No logic change expected (already redirects on `role`), but must be exercised in QA/e2e immediately after a conversion to confirm it picks up the refreshed cookie |
| `services/adminUserSummary.service.js` / `/admin-users` | No functional change expected, but self-service conversions should already show up via existing `byRole` counts and audit log — verify in QA |

---

## 5. Admin-side conversion capability

Requested explicitly: admins need the same customer↔supplier conversion
capability, for support cases where the user can't/won't do it themselves.
This isn't additive complexity bolted on top of the self-service feature —
**a working admin path is a prerequisite**, because the current admin tooling
already lets a role slip into an inconsistent state and this plan should fix
that at the same time, not leave it as a second gap.

### 5.1 What already exists (verified directly in the code)

- The admin **User Detail** page already has a raw role `<select>` —
  `public/assets/js/pages/admin-user-detail-init.js:216-223` — inside the
  generic "Edit User" form (`#editUserForm`, alongside Name/Email/Verified/
  Marketing-opt-in). Changing it and clicking "Save Changes" calls
  `saveUserChanges()` (submits to `PUT /api/admin/users/:id`) with **no
  confirmation, no dedicated warning, and no distinct audit trail** — the
  role change is silently bundled into whatever else was edited in the form
  and logged as the generic `action: 'user_edited'`
  (`routes/admin-user-management.js:1995`), not the more specific
  `AUDIT_ACTIONS.USER_ROLE_CHANGED` that the (separate, admin-privilege-only)
  grant/revoke-admin endpoints already use.
- **Confirmed independently (matches §2.3's finding from the self-service
  side): `PUT /api/admin/users/:id` only handles customer→supplier.** Reading
  the full handler (`routes/admin-user-management.js:1930-1989`): when
  `role` flips **to** `supplier`, it calls `ensureSupplierProfileForUser()`
  with rollback-on-failure. When `role` flips **away from** `supplier` (to
  `customer` or `admin`), **nothing happens to the `suppliers` doc** — no
  suspension, no unpublishing, no ownership note. An admin can silently
  leave a fully live, publicly-listed supplier profile owned by an account
  that no longer has the supplier role. This is a real, currently-shippable
  bug in existing admin tooling, not just a gap for the new feature to avoid
  repeating.
- **A second, related bug**: `GET /api/admin/users/:id` — via
  `sanitizeAdminUser()` (`routes/admin-user-management.js:40-55`) — never
  returns a `supplierProfile` field. But `admin-user-detail-init.js`'s
  `renderUserDetails()` checks `user.supplierProfile` to decide whether to
  show a "Supplier Profile →" link or a "⚠️ Provision Profile" button. Only
  the newer `GET /users/:id/detail` endpoint (via
  `adminUserSummary.service.js`'s `getUserDetail()`) actually populates
  `supplierProfile`. Net effect: **today, every supplier-role user on this
  page shows "⚠️ Provision Profile", even ones who already have a profile** —
  the page can't currently tell an admin whether a role-supplier user has a
  real linked supplier record. This needs fixing regardless of the
  conversion feature, and matters directly for it: an admin deciding whether
  to convert someone needs accurate linkage state on screen.
- The **Admin Supplier Detail** page (`admin-supplier-detail-init.js`) has
  almost no awareness of the owning user at all. The Overview tab (the
  default landing tab) shows business/contact fields only — no `ownerUserId`,
  no role, no link. The only place a link to the user record appears is
  buried three clicks deep, inside the **Action Prompts** tab's diagnostics
  panel (`admin-supplier-detail-init.js:1188-1204`), which is really there
  for a different purpose (email-preference diagnostics) and happens to
  include a `View User Detail →` link as a side effect.
- Reusable UI building blocks already in `public/assets/js/admin-shared.js`
  fit this feature much better than a bare `<select>`:
  - `AdminShared.showConfirmModal()` (line 418) — already used for
    `deleteUser()` (`admin-user-detail-init.js:361-386`), which **already
    has the exact warning pattern this feature needs**: it appends
    `' This will delete the user, supplier profile, packages and public
    listing data.'` to the confirmation message when `user.role ===
    'supplier'`. A "convert to customer" confirmation should say the
    equivalent thing about *suspending* rather than deleting.
  - `AdminShared.showInputModal()` (line 616) — used throughout
    `admin-supplier-detail-init.js` for approve/reject/request-changes/
    suspend/verify, each with a required or optional reason field.
  - A **select-in-modal role picker precedent already exists**:
    `revokeAdmin()` in `public/assets/js/pages/admin-init.js:1295-1370`
    builds a `<select id="revoke-admin-role">` with customer/supplier
    options inside a modal, validated against
    `AdminShared.validateRole(value, ['customer', 'supplier'])` — this is
    the shape to copy for a "change account type" modal, not the bare form
    `<select>`.
  - `VALID_USER_ROLES = ['customer', 'supplier', 'admin']`
    (`routes/admin-user-management.js:37`) already exists server-side for
    validation and should be reused rather than re-declared.
- `config/adminRegistry.js` is a flat page registry
  (`REGISTRY` array, `route/htmlFile/label/icon/category/inNav`). Both
  `admin-user-detail` and `admin-supplier-detail` are already registered
  with `inNav: false` (accessed via query-string links). Adding a control to
  an **existing** page requires no registry change; a **new** top-level admin
  page would. The project has already stated a preference for evolving
  existing pages over adding new ones for exactly this kind of feature
  (`docs/ADMIN_USER_SYSTEMS_AUDIT.md`, "Why not Option B (new top-level
  page)?" — nav clutter without added clarity).

### 5.2 Where the control belongs: User Detail (primary), Supplier Detail (reflects it)

Weighing the two candidates directly:

| | Admin User Detail | Admin Supplier Detail |
| --- | --- | --- |
| Already has *a* role control | Yes (unsafe, unguarded `<select>`) | No |
| Natural point for "this account is now a customer/supplier" | Yes — it's the account record | No — it's the business-profile record |
| Handles the case with no supplier profile yet (customer→supplier) | Yes — user always exists | N/A — nothing to view until conversion happens |
| Handles the case with no user context | N/A | Would need to fetch the user anyway |
| Existing confirm-modal precedent to build on | Yes (`deleteUser`'s supplier warning) | Partial (approve/reject/suspend reason modals) |

**Recommendation: the control lives on Admin User Detail**, replacing the
current bare `<select>` + bundled-save with a dedicated action, because the
account type is fundamentally a property of the *user* record, and that page
already has the closest working precedent (the delete-user supplier warning).
**Admin Supplier Detail does not get a duplicate control** — instead:
- Promote the existing "View User Detail →" link out of the buried Action
  Prompts tab onto the main Overview tab (it's presently only reachable via
  `admin-supplier-detail-init.js:1196`, which the audit doc's own QA
  checklist assumed was a prominent "linked user panel" — it isn't, today).
- Show a passive status banner when the owning user's role no longer matches
  (e.g. "⚠ Owner account is no longer a supplier — this listing is
  suspended"), sourced from the same shared service, so an admin looking at
  the supplier side understands *why* a listing went dark without needing to
  separately go find and interpret the user record.

This mirrors §5.1's own evidence: Supplier Detail's current user-awareness is
an afterthought bolted onto an unrelated diagnostics tab, not a real "linked
account" panel — building the primary action there would be building on top
of that afterthought rather than fixing it.

### 5.3 Design

- **Reuse the same `services/accountTypeConversion.service.js`** designed in
  §4.1 for both entry points — an admin conversion is the same state
  transition with two differences: (a) no `supplierApplications` feature-flag
  gate and no `supplierRegistrationRiskGuard` (an admin acting on a support
  request isn't the anti-abuse scenario those exist for), and (b) no cooldown
  (an admin may need to fix a mistake immediately, possibly repeatedly during
  a single support conversation). The service functions should accept an
  `actor: { type: 'self' | 'admin', id }` parameter so validation/audit
  behaviour can branch on it without duplicating the core transaction logic.
- **New admin endpoint**, not a reused generic `PUT /api/admin/users/:id`
  body field: `POST /api/admin/users/:id/account-type` (`{ targetRole,
  supplierInfo? }`), `roleRequired('admin')` + `csrfProtection`, calling the
  shared service and logging `AUDIT_ACTIONS.USER_ROLE_CHANGED` with
  `previousRole`/`newRole`/`adminActorId` — matching the convention the
  grant/revoke-admin endpoints already use, instead of the generic
  `user_edited` action the current `PUT /:id` role field produces. This also
  finally gives admin-initiated customer↔supplier changes a dedicated,
  filterable audit trail, which they don't have today.
- **Remove `role` from the generic `PUT /api/admin/users/:id` edit-user
  payload** (or make it a no-op there) once the dedicated endpoint exists, so
  there's exactly one code path that can change a user's account type and it
  always goes through the shared service — no way to bypass the
  supplier-profile handling by editing the bare form field.
- **Frontend**: replace the `<select id="userRole">` block
  (`admin-user-detail-init.js:216-223`) with a read-only role badge plus a
  "Change Account Type…" button, opening a modal built from
  `AdminShared.showInputModal()` (or a small custom modal) containing: current
  role, target role picker (reusing the `revokeAdmin()` select-in-modal
  pattern and `VALID_USER_ROLES`), the supplier-info fields when targeting
  `supplier`, and — when targeting `customer` and a supplier profile exists —
  the same kind of explicit consequence warning `deleteUser()` already shows
  (adapted from "will delete" to "will suspend the supplier profile,
  packages and public listing").
- **Fix the `supplierProfile` propagation bug** (§5.1) as part of this work:
  either switch `admin-user-detail-init.js` to call `GET
  /users/:id/detail` (which already returns `supplierProfile` via
  `adminUserSummary.service.js`) instead of the plain `GET /users/:id`, or
  add `supplierProfile` to `sanitizeAdminUser()`'s output. Needed regardless
  of this feature, but the conversion UI depends on it being accurate.
- Unlike the self-service flow, an admin-initiated conversion does **not**
  need to reissue the *admin's own* session — it changes someone else's
  account. But if that user has an active session, their existing JWT will
  still carry the stale role for up to 7 days (§2.6's finding applies here
  too) — call this out explicitly in the confirmation modal copy ("the user
  may need to log out and back in, or their session will refresh within a
  browser reload of a fresh page load that re-verifies the DB role") since
  there's no server-push mechanism to invalidate their cookie early.

### 5.4 Touch points (admin-side, additive to §4.3)

| File | Change |
| --- | --- |
| `routes/admin-user-management.js` | New `POST /users/:id/account-type` endpoint using the shared service; remove/no-op the `role` field handling inside `PUT /users/:id` (lines 1942-1944, 1970-1989); add `supplierProfile` to `sanitizeAdminUser()` or switch the detail page to the `/detail` endpoint |
| `public/assets/js/pages/admin-user-detail-init.js` | Replace the `<select id="userRole">` block (216-223) and its bundled handling in `saveUserChanges()` with a dedicated "Change Account Type…" action + modal |
| `public/assets/js/pages/admin-supplier-detail-init.js` | Promote the "View User Detail →" link (currently only at line ~1196, Action Prompts tab) onto the Overview tab; add a passive "owner is no longer a supplier" banner when applicable |
| `middleware/audit-actions.js` | No new entry needed — reuse the existing `USER_ROLE_CHANGED` (line 20) |

---

## 6. Testing plan

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
- **Admin-side** (§5): new `tests/unit/admin-account-type-conversion.test.js`
  covering the new `POST /users/:id/account-type` endpoint — admin-only
  (403 for non-admin), no feature-flag/cooldown/risk-guard gating (unlike the
  self-service path), correct `USER_ROLE_CHANGED` audit entry with
  `adminActorId`, and the supplier→customer suspension path actually
  suspending the `suppliers` doc (regression-testing the bug found in §5.1,
  since today's `PUT /:id` silently doesn't). Also add a regression test
  asserting `PUT /api/admin/users/:id` no longer changes `role` (or 400s if
  a `role` field is present) once it's removed from that generic endpoint,
  so a future edit can't silently reopen the old bypass.
- **E2E** (`e2e/`): new `account-type-conversion.spec.js` (naming to match
  `e2e/customer-enquiry-flow.spec.js`, `e2e/auth.spec.js`) covering:
  customer converts to supplier via the Settings UI, fills the required
  business fields, lands on the supplier dashboard, unverified; supplier
  converts to customer, sees the confirmation modal with consequences, and
  loses supplier nav/routes after confirming.
- **Accessibility**: the repo runs an automated axe-core/WCAG 2.1 AA gate
  (`docs/A11Y_TESTING.md`, `tests/visual/visual-regression.spec.mjs`), but
  `/settings` is explicitly **excluded** from that baseline suite today
  because it's auth-gated (comment at
  `tests/visual/visual-regression.spec.mjs:27-30`: auth-gated pages "silently
  redirect... until full backend mode is available to this suite"). That
  means the new conversion section/modal gets **no automated a11y coverage**
  — plan for a manual WCAG 2.1 AA pass (keyboard navigation through the
  form/modal, focus trapping, `aria-live` status messages matching the
  existing `role="status"` pattern already used elsewhere on this page) as
  part of PR review, not CI.

---

## 7. Open questions (need a product decision before implementation)

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
7. **Admin override scope (§5).** Should an admin be able to bypass the
   30-day self-service cooldown *and* re-trigger it (i.e. does an
   admin-initiated conversion reset the user's own cooldown timer, or run
   independently of it)? Recommendation: admin conversions run independently
   and don't consume/reset the user's self-service cooldown, so a support fix
   doesn't lock the user out of converting again themselves later.
8. **Generic `PUT /api/admin/users/:id` role field (§5.3).** Removing `role`
   from that endpoint's accepted body is the safer long-term fix (single code
   path), but is a breaking change for any other internal caller of that
   endpoint that currently sets `role` — worth a quick audit of callers
   before committing to removal vs. leaving it as a deprecated/no-op field.

---

## 8. Suggested phasing

1. Backend: shared `accountTypeConversion.service.js` + self-service route +
   reuse of `ensureSupplierProfileForUser` + reactivation support + audit
   logging + unit/integration tests.
2. Backend: admin route (§5.3) on the same shared service, `supplierProfile`
   propagation fix (§5.1), removal of the `role` field from the generic
   `PUT /api/admin/users/:id` payload.
3. Frontend: self-service Settings UI (both directions) + e2e tests.
4. Frontend: admin "Change Account Type…" control on User Detail (§5.2) +
   Supplier Detail link promotion/status banner + admin e2e coverage.
5. Downgrade edge cases: subscription handling, badge handling, pending
   enquiry notices (depends on answers to §7).
6. Docs: new `docs/ACCOUNT_TYPE_CONVERSION.md` (user/support-facing,
   analogous to `docs/supplier-verification.md`) once behaviour is final.

---

## 9. Summary of files a future PR will likely touch

```
NEW    services/accountTypeConversion.service.js
NEW    tests/unit/account-type-conversion.test.js
NEW    tests/unit/admin-account-type-conversion.test.js
NEW    tests/integration/account-type-conversion-route.test.js
NEW    e2e/account-type-conversion.spec.js
NEW    docs/ACCOUNT_TYPE_CONVERSION.md              (post-implementation, user-facing)
EDIT   routes/settings.js
EDIT   routes/admin-user-management.js               (new admin endpoint; remove `role` handling from PUT /:id; fix supplierProfile propagation)
EDIT   services/supplierProfileProvisioning.service.js
EDIT   models/index.js
EDIT   public/settings.html
EDIT   public/assets/js/pages/settings-init.js
EDIT   public/assets/js/pages/admin-user-detail-init.js   (replace bare role <select> with guarded action + modal)
EDIT   public/assets/js/pages/admin-supplier-detail-init.js  (promote linked-user link; add owner-status banner)
```
