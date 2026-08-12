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
  `public/assets/js/pages/auth-init.js:117`
  (`getElementById('supplier-fields')`) — **not** `auth-form-init.js`, which
  only wires up login-form validation and has no role/supplier logic at all
  despite the similar filename. This is the component to crib from for the
  new Settings conversion form, rather than building the field set from
  scratch.
- **Category is _not_ collected at signup today** — new suppliers default to
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
  `ownerUserId`, otherwise creates one with `profileComplete: false` and
  correct verification defaults (auto-approve vs `unverified`, per the
  `autoApproveSupplierVerification` setting). **Correction**: it does not
  actually write a `status` field at all — the inserted document has no
  `status` (not literally `'draft'`); a separate creation path,
  `services/supplier.service.js:162` (`status: data.status || 'draft'`),
  is the one that defaults a missing `status` to `'draft'`. Worth knowing
  since §3.2/§3.3 below talk about setting/resetting `status` explicitly —
  the conversion service should set it explicitly rather than relying on
  this function's defaults for it.
- Already used in **six** call sites total: registration (`routes/auth.js:462`),
  three places in `routes/admin-user-management.js` where an admin changes a
  user's role to `supplier` (lines 376, 1972, 2365 — each with rollback of the
  role change if provisioning fails), and two admin _repair_ tools — a
  single-user re-provision action (line 2594) and a bulk backfill loop over
  all `role: 'supplier'` users missing a `suppliers` doc (line 2639). Those
  last two are a useful operational precedent: if the new conversion flow
  ever leaves a supplier user without a profile (e.g. a crash mid-transaction),
  this existing bulk-repair tool already fixes it — no new tooling needed
  there.
- This means an _admin-initiated_ role-change-to-supplier flow already exists
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
    (`routes/admin-user-management.js:2246-2305` and `2310-2417`) are
    specifically for admin-privilege grant/revoke, **not** a general
    customer↔supplier tool — but they _do_ set the pattern worth reusing:
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
    `accountTypeConversion.service.js` used by _both_ the new self-service
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
  (`GET/POST /api/v1/me/settings`, per the actual mount in `server.js:840`
  — corrected here for consistency with §4.2, which already had the right
  path) — no account-type logic today.
- `routes/profile.js` handles profile field edits (`PUT /api/v1/profile`,
  `server.js:1097`), avatar upload/delete, and account deletion — again, no
  role logic.
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

**This only fixes it for the person doing the converting.** For an
_admin_-initiated conversion, the reissued cookie belongs to the admin, not
the target user — the target user's own existing JWT (if they have an active
session) still carries the pre-conversion role for up to 7 days, and there's
no server-side mechanism here to force it to refresh early or to invalidate
it. Two options, not mutually exclusive:

1. **Authorize from the fresh DB role instead of the JWT claim** — the
   simplest fix, and importantly not new work: `authRequired`
   (`middleware/auth.js:184-185`) already does `const dbUser = await
dbUnified.findOne('users', { id: u.id })` on _every_ request — the fresh
   role is already being fetched, just discarded. Changing
   `middleware/auth.js:202` from `role: u.role` (JWT) to `role: dbUser.role`
   (fresh DB read) fixes both the self-service and the admin-initiated case
   uniformly, at zero extra query cost, without any token
   revocation/versioning scheme. This is the recommended primary fix.
2. **Reissue the cookie on the _next_ authenticated request** — even with
   fix 1 in place, reissuing a fresh cookie (matching the new role) the next
   time the converted user's browser makes an authenticated request keeps
   the JWT payload itself from drifting out of sync with the DB
   indefinitely over a long-lived session; worth doing as a belt-and-braces
   measure, but not load-bearing for correctness once fix 1 is in place.

Fix 1 is the one this plan treats as required (see §5.3 for how it resolves
the admin-conversion case specifically) — without it, a downgraded supplier
retains supplier-route access and an upgraded customer stays denied until
their token naturally expires or they log out, regardless of what the
conversion UI's modal copy tells them.

### 2.7 Where `role` is read elsewhere (blast radius)

`user.role === 'supplier' | 'customer'` checks exist in 34 files. Most are
route guards (`roleRequired('supplier')`) that will just work once the token
is reissued. The ones that need explicit design attention for this plan:

| Area                          | File                                                                                                                                                                                                                                                                                                                        | Why it matters                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Referral/partner risk scoring | `routes/auth.js:444-458, 489-495`                                                                                                                                                                                                                                                                                           | Currently only runs at registration; a converted-to-supplier user skips it entirely unless we deliberately invoke the equivalent check                                                                                                                     |
| Anti-abuse                    | `middleware` used as `supplierRegistrationRiskGuard`                                                                                                                                                                                                                                                                        | Same as above — designed for the register endpoint, needs a decision on whether/how to apply to conversion                                                                                                                                                 |
| Pro subscription / billing    | `models/Supplier.js` (`isPro`, `stripeCustomerId`, `subscriptionStatus`)                                                                                                                                                                                                                                                    | A paying supplier converting to customer has a live Stripe subscription attached to the supplier doc, not the user — needs explicit handling (see §7)                                                                                                      |
| Badges                        | `BADGE_TYPES` (`founder, pro, pro-plus, verified, featured, custom`) on `users.badges`                                                                                                                                                                                                                                      | Some badges are supplier-earned (`verified`, `pro`); converting away from supplier should not silently keep a `verified` badge that no longer means anything                                                                                               |
| Messenger                     | `routes/messenger-v4.js:421` (role stamped onto conversation participants: `role: user.role \|\| 'customer'`), and `routes/messenger-v4.js:429` (a functional branch — reuses/creates a direct conversation when a supplier starts a "generic new message" to a non-supplier), `services/messenger-v4.service.js:1531-1536` | Not purely cosmetic in one spot — the conversation-reuse logic at line 429 keys off the participant's role at message-send time, so a role that changes mid-conversation affects behaviour, not just a displayed label                                     |
| Community                     | `services/community.service.js:1153-1187`                                                                                                                                                                                                                                                                                   | Role affects badge/label rendering (`isOfficial`, moderator flags) on posts — cosmetic, same as messenger                                                                                                                                                  |
| Dashboard redirects           | `routes/dashboard.js:22-35`, `public/assets/js/pages/dashboard-redirect.js`                                                                                                                                                                                                                                                 | Both server- and client-side redirect logic branch on `role` — both need the refreshed role to avoid bouncing a converted user to the wrong dashboard                                                                                                      |
| `GET /api/v1/auth/me`         | `routes/auth.js:1779` onward                                                                                                                                                                                                                                                                                                | Already conditionally fetches the `suppliers` row and returns `supplierApproved` only when `role === 'supplier'` — natural place to also surface "eligible to convert" / cooldown-remaining metadata for the Settings UI                                   |
| Admin dashboards              | `services/adminUserSummary.service.js`, `/admin-users`                                                                                                                                                                                                                                                                      | Already counts `byRole` and filters by role — will naturally reflect conversions once `role` changes; self-service conversions should be visible/auditable to admins (see §5) via the shared `USER_ROLE_CHANGED` audit action                              |
| Admin RBAC cache              | `middleware/permissions.js` (`PermissionCache`, 5-min in-memory, keyed by `user.id`)                                                                                                                                                                                                                                        | This is for the separate owner/admin/moderator/support RBAC layer, not customer/supplier — shouldn't need invalidation for this feature, but flagged here as the pattern to check for "is there a role-keyed cache we're forgetting" during implementation |

Bookings/enquiries/reviews were checked and are **not** role-gated by
`user.role` directly — they key off supplier/customer IDs on the
booking/review/enquiry record itself, so historical records are unaffected by
a role flip. That's good: it limits blast radius mostly to the _current_
capabilities and the linked `suppliers` doc, not historical data.

---

## 3. Proposed design

### 3.1 UX flow

Full visual/CSS spec (exact classes, tokens, motion, responsive behaviour) is
in §9 — this subsection covers the functional flow only.

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
lightly so that a _suspended-by-conversion_ profile is reactivated (status
reset to `draft`, previous business data preserved) rather than left
suspended, and the verification state resumes where the state machine already
allows it (`suspended → approved/rejected` per the admin table, so re-entry
should probably route back to `pending_review` for re-check rather than
silently going straight back to `approved`).

### 3.3 What "switch to customer" means for existing supplier data

Decision needed (flagged as an open question in §7), but the recommended
default: **suspend, don't delete.**

- **Correction after verifying the actual public-listing gates** (an earlier
  pass of this plan assumed `status` alone would suffice — it does not):
  visibility across the codebase is gated inconsistently, and `status` is
  the _minority_ gate, not the dominant one:
  - `services/searchService.js:335` (`/api/search`, `/api/v1/search` — the
    primary discovery surface) filters **only** on `s.approved`, never
    `s.status`. Setting `status: 'suspended'` alone would leave an approved
    listing fully visible and searchable here.
  - The bulk of `routes/suppliers.js` (supplier directory, packages,
    profile visibility, similar suppliers, personalization) and
    `routes/marketplace.js:115` likewise filter on `s.approved` only.
  - `services/supplier.service.js:451-453,580-581` is the one path that
    genuinely does require both: `s.status === 'published' && s.approved
=== true`.
  - **Conclusion: the conversion must set `approved: false` (and record
    `approvedAt`/`approvedBy` appropriately), not just flip `status`** —
    `approved: false` is what actually hides the listing across nearly
    every consumer-facing surface, `status: 'suspended'` alone would not.
  - **There is an existing admin endpoint that already does almost exactly
    this — reuse its logic rather than reinventing it**: an earlier pass of
    this plan incorrectly claimed `routes/supplier-admin.js`'s own
    suspend/approve/reject endpoints don't call `catalogCache.invalidate()`
    either. They do — every one of them
    (`routes/supplier-admin.js` lines ~320, ~393, ~462, ~532, ~670, ~750).
    In particular, `POST /suppliers/:id/suspend`
    (`routes/supplier-admin.js:~480-536`) is the closest existing precedent
    for the whole downgrade operation, not just the cache-invalidation
    piece — it already sets:
    ```js
    const updates = {
      verificationStatus: VERIFICATION_STATES.SUSPENDED,
      verified: false,
      approved: false,
      verificationNotes: reason,
      suspendedAt: now,
      suspendedBy: req.user.id,
      updatedAt: now,
    };
    ```
    then writes an audit log entry, sends a "suspended" notification email,
    and calls `catalogCache.invalidate()` — the complete recipe this
    section was independently re-deriving. **The conversion service should
    call this same update logic (or a shared helper extracted from it)**,
    adapted to look the supplier up by `ownerUserId` instead of an
    admin-supplied `:id`, rather than writing a parallel implementation.
  - **Two distinct fields both happen to have a `'suspended'` value — don't
    conflate them.** `verificationStatus` (`unverified | pending_review |
approved | rejected | suspended | needs_changes`,
    `docs/supplier-verification.md`) is the admin verification state
    machine — this is the field the existing suspend endpoint above sets.
    `status` (`draft | published | suspended`, `Supplier.VALID_STATUSES`)
    is a _separate_, simpler publishing-workflow field that the suspend
    endpoint above does **not** touch, but which still needs to move away
    from `'published'` for `supplier.service.js`'s stricter
    `status === 'published' && approved === true` check to correctly
    exclude the listing. **The full, correct set for the conversion's
    downgrade path is four fields**: `approved: false`, `verified: false`,
    `verificationStatus: 'suspended'` (mirroring the existing endpoint
    exactly) **and** `status: 'suspended'` (the one field that endpoint
    doesn't set, but which this plan's own research found is still needed
    for `supplier.service.js`'s surface) — plus the same
    `catalogCache.invalidate()` call the existing endpoint already makes.
  - On **reactivation** (§3.2), the reverse applies: don't blindly restore
    `approved: true` — route back through `pending_review` (as already
    recommended in §3.2) and let the normal verification-approval flow set
    `approved` again, rather than the conversion service silently
    re-approving a previously-approved listing.
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
  - **Needs the same rollback discipline as `convertToSupplier`, not less**:
    `db-unified.js` has no transaction/session support (confirmed — no
    `startSession`/multi-document-transaction API anywhere in it), so the
    two writes (`users.role` update, then `suppliers` suspend update) are
    independent, non-atomic operations. If the role write succeeds and the
    supplier-suspend write then fails or returns no document, the account
    is left as a `customer` whose `suppliers` doc is still `approved`/live
    — the exact inconsistency this whole feature exists to prevent, just
    approached from the other direction. `convertToCustomer` must revert
    `users.role` back to `supplier` on a failed suspend, mirroring
    `convertToSupplier`'s existing rollback-on-provisioning-failure
    pattern (and the admin precedent at
    `routes/admin-user-management.js:1970-1989`) exactly — this needs to
    be a stated requirement and a tested code path, not an implicit
    assumption.
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
  an admin to disable the _conversion feature_ independently of new-supplier
  signups — see §7.
- Body: `{ targetRole: 'supplier' | 'customer', supplierInfo?: {...} }`.
- Explicitly rejects `targetRole === 'admin'` and rejects conversion _from_
  `admin` — admin role changes stay admin-only via the existing
  `admin-user-management.js` endpoints.
- On success: calls the service, **reissues the auth cookie** using the same
  `generateToken`/cookie-setting call used by `POST /register` and
  `POST /login` in `routes/auth.js`, and returns the new role + redirect
  target so the frontend can navigate without a full logout/login.
- **Correction after reading the guard's actual implementation** (an earlier
  pass of this plan said "reuse `supplierRegistrationRiskGuard`" as if it
  were a drop-in — it needs adaptation, not a bare reuse):
  `registrationRiskGuard({ roleResolver })`
  (`services/partnerRegistrationRiskService.js:951-1001`) resolves the role
  via the injected `roleResolver`, but internally still reads
  `req.body?.email` and `req.body?.ref` directly (hardcoded field names,
  not configurable) for the risk assessment
  (`assessRegistration({ req, email: req.body?.email, role: resolvedRole,
refCode: req.body?.ref })`, line 959-962). The registration route's own
  instance (`routes/auth.js:43-45`) is configured with
  `roleResolver: req => (req.body?.role === 'supplier' ? 'supplier' :
null)` — reading `role`, not `targetRole`. Two concrete adjustments are
  needed, not zero:
  1. **A separate guard instance** for this route, with its own
     `roleResolver: req => (req.body?.targetRole === 'supplier' ?
'supplier' : null)` — the existing instance would never fire for this
     route's body shape.
  2. **The acting user's email must land in `req.body.email`** before the
     guard runs (e.g. the route handler sets
     `req.body.email = req.body.email || req.user.email` ahead of the
     guard middleware), since the guard reads that field directly and a
     self-service conversion's identity comes from the session, not a
     submitted registration form field.
  - **Also must call `completeRegistrationRisk(req, userId)`
    (`partnerRegistrationRiskService.js:1003-1010`) on success**, exactly
    as `routes/auth.js:446` does after a successful registration — using
    the _existing_ user's id (this isn't user creation, it's a role
    change on an existing account). Skipping this isn't just an omission:
    the guard's own `res.once('finish', ...)` handler
    (lines 979-988) auto-records the attempt as outcome
    `'completed_without_user'` if `completeRegistrationRisk` was never
    called, and that outcome is explicitly excluded from the
    velocity/repeat-abuse checks the risk service otherwise runs on
    `'created'` outcomes — so a successful conversion that skips this call
    would silently fall outside the abuse-detection signal, defeating the
    reason for reusing the guard at all.

### 4.3 Touch points to update

| File                                                    | Change                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/accountTypeConversion.service.js`             | **New**                                                                                                                                                                                                                                                                                         |
| `middleware/auth.js`                                    | **Required, not optional** — line 202: change `role: u.role` (JWT claim) to `role: dbUser.role` (already-fetched fresh DB value) in `authRequired`, per §2.6 fix 1. Without this, neither the self-service nor the admin conversion path is actually correct within the token's 7-day lifetime. |
| `routes/settings.js`                                    | New `POST /account-type` (resolves to `POST /api/v1/me/settings/account-type`)                                                                                                                                                                                                                  |
| `services/supplierProfileProvisioning.service.js`       | Extend to support reactivating a `suspended`-by-conversion profile instead of only "create or return as-is"                                                                                                                                                                                     |
| `models/index.js`                                       | Add `previousRole`, `lastAccountTypeChangeAt` to the `users` `$jsonSchema` (additive, non-breaking; `USER_ROLE_CHANGED` audit action already exists, no new `AUDIT_ACTIONS` entry needed)                                                                                                       |
| `models/Supplier.js`                                    | Document the "suspended by self-conversion" convention if we track a reason (e.g. `suspendedReason: 'owner_converted_to_customer'`)                                                                                                                                                             |
| `public/settings.html`                                  | New "Account Type" section markup (reusing the field set from `public/auth.html`'s `#supplier-fields` block)                                                                                                                                                                                    |
| `public/assets/js/pages/settings-init.js`               | Conversion form, validation, confirmation modal, session refresh after success                                                                                                                                                                                                                  |
| `public/assets/js/pages/dashboard-redirect.js`          | No logic change expected (already redirects on `role`), but must be exercised in QA/e2e immediately after a conversion to confirm it picks up the refreshed cookie                                                                                                                              |
| `services/adminUserSummary.service.js` / `/admin-users` | No functional change expected, but self-service conversions should already show up via existing `byRole` counts and audit log — verify in QA                                                                                                                                                    |

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
    equivalent thing about _suspending_ rather than deleting.
  - `AdminShared.showInputModal()` (line 616) — used throughout
    `admin-supplier-detail-init.js` for approve/reject/request-changes/
    suspend/verify, each with a required or optional reason field.
  - A **select-in-modal role picker precedent already exists**:
    `revokeAdmin()` in `public/assets/js/pages/admin-init.js:1295-1394`
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

|                                                                   | Admin User Detail                     | Admin Supplier Detail                          |
| ----------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Already has _a_ role control                                      | Yes (unsafe, unguarded `<select>`)    | No                                             |
| Natural point for "this account is now a customer/supplier"       | Yes — it's the account record         | No — it's the business-profile record          |
| Handles the case with no supplier profile yet (customer→supplier) | Yes — user always exists              | N/A — nothing to view until conversion happens |
| Handles the case with no user context                             | N/A                                   | Would need to fetch the user anyway            |
| Existing confirm-modal precedent to build on                      | Yes (`deleteUser`'s supplier warning) | Partial (approve/reject/suspend reason modals) |

**Recommendation: the control lives on Admin User Detail**, replacing the
current bare `<select>` + bundled-save with a dedicated action, because the
account type is fundamentally a property of the _user_ record, and that page
already has the closest working precedent (the delete-user supplier warning).
**Admin Supplier Detail does not get a duplicate control** — instead:

- Promote the existing "View User Detail →" link out of the buried Action
  Prompts tab onto the main Overview tab (it's presently only reachable via
  `admin-supplier-detail-init.js:1196`, which the audit doc's own QA
  checklist assumed was a prominent "linked user panel" — it isn't, today).
- Show a passive status banner when the owning user's role no longer matches
  (e.g. "⚠ Owner account is no longer a supplier — this listing is
  suspended"), sourced from the same shared service, so an admin looking at
  the supplier side understands _why_ a listing went dark without needing to
  separately go find and interpret the user record.

This mirrors §5.1's own evidence: Supplier Detail's current user-awareness is
an afterthought bolted onto an unrelated diagnostics tab, not a real "linked
account" panel — building the primary action there would be building on top
of that afterthought rather than fixing it.

### 5.3 Design

Visual/CSS spec for the modal, badges, and colours referenced below is in
§9.3 — this subsection covers the functional design only.

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
  need to reissue the _admin's own_ session — it changes someone else's
  account, and the admin has no way to reissue a cookie the target user's
  browser holds. This is exactly the case §2.6's fix 1 exists for: with
  `middleware/auth.js:202` reading `role` from the fresh `dbUser` lookup
  instead of the JWT claim, the target user's _very next_ authenticated
  request after the admin's change is correctly authorized — no waiting for
  logout, token expiry, or a lucky page reload. **Modal copy alone
  ("the user may need to log out and back in") is not sufficient on its
  own** — without §2.6's fix 1, a downgraded supplier would keep
  supplier-route access and an upgraded customer would stay denied for up
  to 7 days regardless of what the modal says, so treat that fix as a
  prerequisite for shipping the admin conversion action, not an optional
  hardening step.

### 5.4 Touch points (admin-side, additive to §4.3)

| File                                                   | Change                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/admin-user-management.js`                      | New `POST /users/:id/account-type` endpoint using the shared service; remove/no-op the `role` field handling inside `PUT /users/:id` (lines 1942-1944, 1970-1989); add `supplierProfile` to `sanitizeAdminUser()` or switch the detail page to the `/detail` endpoint |
| `public/assets/js/pages/admin-user-detail-init.js`     | Replace the `<select id="userRole">` block (216-223) and its bundled handling in `saveUserChanges()` with a dedicated "Change Account Type…" action + modal                                                                                                           |
| `public/assets/js/pages/admin-supplier-detail-init.js` | Promote the "View User Detail →" link (currently only at line ~1196, Action Prompts tab) onto the Overview tab; add a passive "owner is no longer a supplier" banner when applicable                                                                                  |
| `middleware/audit-actions.js`                          | No new entry needed — reuse the existing `USER_ROLE_CHANGED` (line 20)                                                                                                                                                                                                |

---

## 6. Testing plan

Following existing repo conventions:

- **Unit** (`tests/unit/`): new `account-type-conversion.test.js` mirroring the
  style of `tests/unit/supplier-profile-provisioning-hardening.test.js` —
  idempotency, rollback-on-provisioning-failure, cooldown enforcement, audit
  log calls, rejection of `admin` as a source/target role, reactivation of a
  suspended profile. Also, specifically (from §3.3/§4.1's corrections):
  `convertToCustomer` sets both `approved: false` **and** `status:
'suspended'` (not `status` alone), calls `catalogCache.invalidate()`, and
  rolls `users.role` back if the supplier-suspend write fails; a supplier
  reactivated via `convertToSupplier` after a prior downgrade does **not**
  come back `approved: true` automatically — it re-enters `pending_review`.
- **`middleware/auth.js` regression test** (§2.6 fix 1): assert
  `authRequired` populates `req.user.role` from the freshly-read `dbUser`,
  not the JWT payload — construct a request with a JWT carrying a stale role
  and a DB user with a different current role, and assert `req.user.role`
  matches the DB, not the token. This is the test that would have caught
  the original design gap and is the one guarding against it regressing.
- **Integration** (`tests/integration/`): new
  `account-type-conversion-route.test.js` mirroring
  `tests/integration/auth-account-security.test.js` and, more directly,
  `tests/unit/profile-account-deletion.test.js` /
  `tests/unit/profile-validation.test.js` (the closest existing analogs, since
  those cover `routes/profile.js`, the sibling settings/account route with
  its own subscription-cancellation and cascade-cleanup behaviour) — auth
  required, CSRF required, feature-flag gating (`supplierApplications` off →
  503), rate limiting, cookie reissued with new role claim, `suppliers` doc
  created/suspended/reactivated as expected. Also (from §4.2's correction):
  assert the route's own `registrationRiskGuard` instance actually fires for
  a `targetRole: 'supplier'` body (not just `role`), that `req.body.email`
  gets populated from `req.user.email` before the guard runs, and that
  `completeRegistrationRisk(req, userId)` is called on success — assert via
  a spy/mock that the risk event is recorded with outcome `'created'`, not
  left to fall through to `'completed_without_user'`.
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
   30-day self-service cooldown _and_ re-trigger it (i.e. does an
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

## 9. Visual design & responsive specification

Requested explicitly: this needs to look genuinely on-brand and premium, not
generic placeholder styling, and needs to work across devices. Rather than
prescribe a new visual language, everything below is built from **components
that already exist and already ship on the exact pages being modified** —
verified directly against the CSS actually loaded on `/settings`,
`/admin-user-detail`, and `/admin-supplier-detail`, not against the design
token files that turned out not to be loaded there (see §9.1).

### 9.1 Design-token reality check (read this before writing any CSS)

The repo has _three_ token stylesheets that each define their own
`--ef-*`-prefixed variable set (`design-tokens.css`, `tokens.css`,
`design-system.css` — confusingly, not the same values as each other despite
sharing a prefix) plus a fourth, admin-specific one (`admin-tokens.css`,
`--admin-*`). **Which of these actually apply differs per page — this is not
a blanket "none of them are loaded" situation** (an earlier pass of this plan
stated it that way and was wrong for two of the four pages):

- `public/settings.html` and `public/auth.html` load `styles.css` first,
  which defines its _own_, different `:root` block
  (`public/assets/css/styles.css:2`, redefined again at line 721), and
  **none** of the four token stylesheets above are `<link>`ed on either page
  — this is the actual live token set here:
  ```css
  --bg: #fff;
  --text: #0b1220;
  --muted: #667085;
  --ink: #0b8073;
  --accent: #13b6a2;
  --border: #e7eaf0;
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  --radius: 14px;
  --max: 1480px;
  ```
  On these two pages: write the hex values / `--ink`/`--accent`/`--border`/
  `--radius`/`--shadow` from `styles.css` directly — `--ef-*` custom
  properties are genuinely undefined here.
- `public/admin-user-detail.html` and `public/admin-supplier-detail.html` are
  **different**: they don't `<link>` `admin-tokens.css` (`--admin-*` is
  correctly undefined there), but they **do** `<link>` `tokens.css`
  (`admin-user-detail.html:9`, `admin-supplier-detail.html:16`) — a real,
  separate `--ef-*` token file (distinct from `design-tokens.css`, despite
  the shared prefix) that **is** live on both admin pages, alongside
  `styles.css` + `admin.css` + `admin-enhanced.css` + `admin-navbar.css`
  (plus `admin-cards.css`/`admin-supplier-detail.css`). Its relevant values:
  ```css
  --ef-primary: #0b8073;
  --ef-primary-hover: #097267;
  --ef-success: #10b981;
  --ef-warning: #f59e0b;
  --ef-error: #ef4444;
  --ef-info: #3b82f6;
  --ef-radius-sm: 6px;
  --ef-radius-md: 10px;
  --ef-radius-lg: 14px;
  --ef-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --ef-shadow-lg: 0 10px 30px rgba(15, 23, 42, 0.1);
  --ef-gradient-primary: linear-gradient(135deg, var(--ef-primary) 0%, var(--ef-accent) 100%);
  ```
  In practice almost nothing in the _existing_ admin CSS/JS actually
  references these variables — colours are hardcoded hex throughout the
  files this plan touches, and happen to match the token values exactly —
  so §9.3's guidance to write raw hex remains the _lower-risk, consistent-
  with-neighbours_ choice for this feature specifically. But it's worth
  knowing `var(--ef-primary)` etc. would genuinely resolve correctly on
  these two pages if a future cleanup wanted to move toward tokens; it is
  not the undefined-variable trap that `--admin-*` is here.

**Practical rule for implementation: write the hex values / `--ink`,
`--accent`, `--border`, `--radius`, `--shadow` variables from `styles.css`
directly (customer side), or the matching raw hex (admin side, for
consistency with this feature's neighbouring code) — do not reference
`--admin-*` custom properties anywhere, or `--ef-*` on the customer side;
those specific combinations will resolve to nothing.**

**Dark mode: not applicable, skip entirely.** `public/assets/css/dark-mode.css`
is an explicit no-op stub (`/* Dark mode has been disabled — EventFlow uses
light theme only. */`), and there are zero `prefers-color-scheme` or
`data-theme` rules anywhere in `public/assets/css/*.css` or on either target
page. Building light-theme-only, matching every other section on both pages,
is correct — not a shortcut.

### 9.2 Customer-facing: the new "Account Type" section (`/settings`)

- **Card wrapper**: plain `<div class="card">` + `<h2 class="settings-section-title">`,
  identical structure to the existing "Account Information" and "Change
  Password" cards, inserted between them in DOM order — not a new visual
  component, the same card rhythm the page already has.
- **Current-type indicator**: a small status chip using the teal-glass
  treatment from `.badge-verified` (`public/assets/css/badges.css`) reading
  "Currently: Customer" / "Currently: Supplier". **Do not** reuse
  `.badge-pro`'s amber gradient for this — that gradient already has an
  established, different meaning elsewhere in the app (a paid Pro
  subscription tier), and borrowing it for "any supplier account" would
  visually overclaim something that isn't true.
- **Role picker — the premium element**: reuse `auth.html`'s `.role-pill` /
  `.auth-role-option` radiogroup **verbatim** (markup + CSS, copied into
  `settings.css` since `auth.css`'s scoped variables like
  `--auth-teal-border` aren't loaded on `/settings`) — this is the _exact_
  customer-vs-supplier choice the user already saw at signup, so reusing it
  here (rather than inventing a new selector) is also a recognition win, not
  just a styling shortcut. Wrap it in a scaled-down version of
  `.auth-signup-choice`'s glass card
  (`public/assets/css/auth.css:861-876` — dual radial-gradient teal glow +
  linear gradient background, `border-radius:22px`, layered shadow) instead
  of dropping the pills flat on the plain card background. `auth.html`
  already renders this identical decision at elevated visual weight
  elsewhere in the app — reusing that exact treatment here is the most
  direct, lowest-risk way to make this section read as premium rather than
  bolted-on, without inventing new visual language.
  The full rule set to actually copy (`auth.css:1401-1443` —
  the block below abbreviates the earlier summary, which dropped the
  hover/focus-visible states and the width-override needed for the
  `styles.css` global `button{width:100%}` reset):
  ```css
  /* auth.css:1401-1443 — copy into settings.css */
  .role-pill,
  .auth-role-option {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 9px 13px;
    border: 1.5px solid rgba(11, 128, 115, 0.2);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
    cursor: pointer;
    transition: all 0.2s ease;
    /* overrides styles.css's global button{width:100%;margin-top:6px} reset */
    width: auto !important;
    margin-top: 0 !important;
    text-align: center;
  }
  .role-pill:hover,
  .auth-role-option:hover {
    border-color: rgba(11, 128, 115, 0.5);
    background: rgba(11, 128, 115, 0.06);
    color: #0b8073;
  }
  .role-pill.is-active,
  .auth-role-option.auth-role-option--active,
  .auth-role-option--active {
    border-color: #0b8073;
    background: rgba(11, 128, 115, 0.1);
    color: #0b8073;
    font-weight: 600;
  }
  .role-pill:focus-visible,
  .auth-role-option:focus-visible {
    outline: 2px solid #0b8073;
    outline-offset: 2px;
  }
  ```
  **One open call to flag for design sign-off, not to resolve silently**: the
  pill uses emoji icons (🎉/🏪); the rest of `/settings` uses inline stroke
  SVG icons (24×24, `stroke="currentColor"`). Recommendation: keep the emoji
  here specifically, for continuity with the identical signup-time choice —
  but this is a genuine visual-consistency trade-off worth a design nod, not
  a default to make unilaterally.
- **Supplier-specific fields** (company, category, location, phone), shown
  inline below the pill only when "Supplier" is selected: use the page's
  plain global input treatment (the one the Account Information form above
  already uses — `input,select,textarea{padding:12px 14px;border:1px solid
var(--border);border-radius:12px}` from `styles.css:38`), not
  `.settings-input` (which today is scoped to the delete-modal's email
  field only) — so the new fields feel continuous with the form immediately
  above them, not a visually distinct sub-component. Category as a
  `<select>` populated from `Supplier.VALID_CATEGORIES`.
- **Primary CTA** (customer→supplier, the safe/promotional direction): a
  filled teal `.cta`/`.ef-cta` button — the same CTA treatment used for
  "Save Changes" directly above it in the Account Information card.
- **Downgrade trigger** (supplier→customer): `.settings-sm-btn--danger`
  (outline red, `border-color:#ef4444;color:#ef4444` —
  `settings.css:113`), the page's existing idiom for "risky action trigger"
  already used in the Danger Zone card — visually de-emphasized relative to
  the primary CTA, signalling "available but not the encouraged path"
  without needing new copy to explain that.
- **Confirmation modal for downgrade**: clone `#delete-account-modal`'s
  exact structure and classes
  (`.settings-delete-overlay`/`-card`/`-header`/`-body`,
  `.settings-footer-actions`, `settings.html:586-683` /
  `settings.css:150-169`) — new IDs, new copy, same family, so it reads as
  native to this page rather than a different modal system appearing out of
  nowhere. Consider echoing step 2 of the delete modal's pattern (retype
  your email to proceed) with a lighter equivalent for downgrade — e.g. type
  "CONVERT" or your business name — rather than a plain OK/Cancel, matching
  the amount of friction the page already applies to its other
  irreversible-ish action.
  - **Premium polish, specifically**: the delete modal, as built today, has
    **zero entrance animation** — it's a flat `display:none` → `display:flex`
    toggle (`settings.css:151-157`). Layer the `components.css` treatment on
    top of the cloned markup: the **backdrop** (`.modal-overlay`,
    `components.css:4-20`) uses `backdrop-filter: blur(12px) saturate(160%)`
    fading in over `opacity 0.3s`; the **card itself** (`.modal`,
    `components.css:27-45`) uses the stronger `blur(24px) saturate(200%)`
    plus the entrance transform: `transform: scale(0.94) translateY(8px) →
scale(1) translateY(0)` via `transition: transform 0.3s
cubic-bezier(0.34, 1.56, 0.64, 1)` (two different blur strengths for two
    different layers — don't apply the card's stronger blur to the backdrop
    or vice versa). This is the single highest-leverage, lowest-risk change
    available to make the new modal read as more premium than its nearest
    sibling on this exact page, without introducing a new visual system —
    it borrows a treatment the codebase already has, just not on this
    particular modal yet.
- **Status/info framing**: reuse the existing green tint already established
  by the supplier callout (`#f0fdf4` bg / `#bbf7d0` border / `#166534` text,
  `settings.html:384`) for "you're currently X, here's what changes" copy;
  use the amber verification-banner tint (`#fffbeb` / `#fcd34d` / `#78350f`,
  matching `customer-dashboard-improvements.css`'s email-verify banner) for
  a specific caution note if one's needed (e.g. "your listing will be
  paused while you're a customer").
- **Cascade gotcha to flag for whoever implements this**: `styles.css`'s
  "Modern cards" rule forces every `.card`'s `border`/`background` with
  `!important`. If the new card needs a custom border or tint (e.g. a
  subtle teal wash framing the "become a supplier" direction), it needs the
  same `!important`-scoped override pattern `settings.css` already uses for
  `.settings-danger-zone-box` (`settings.css:134-142`) — a plain new class
  alone will silently get overridden back to the default white card.

### 9.3 Admin: "Change Account Type" control (`/admin-user-detail`)

- **Current-role display**: replace the raw `<select id="userRole">`
  (`admin-user-detail-init.js:216-223`) with the existing role-badge
  markup already produced by `getRoleBadge()`/`roleBadge()` in this same
  file (`.badge.badge-admin` / `.badge-customer` / `.badge-supplier-account`,
  `admin-enhanced.css:1445-1478`), placed in the page's existing `.ud-badges`
  row alongside the "Suspended" badge — reusing the exact badge component
  already rendered elsewhere on this same page, not a new one.
- **Trigger**: a "Change Account Type…" button in the existing
  `.action-buttons` row (`admin-user-detail-init.js:236-242`), styled
  `ef-cta btn btn-secondary` — matching **Reset Password**
  (`resetPasswordBtn`) and **Resend Verification Email**, not "Suspend
  User" (that one is actually `btn-danger`, same as Delete User). Changing
  account type is a significant action but not inherently destructive the
  way suspend/delete are, so the secondary (not danger) button style is the
  right visual register — it just needed the right precedent cited.
- **Modal implementation — use the `Modal` class, not `AdminShared.showInputModal`**:
  `admin-user-detail.html` already loads `components.js`, so the `Modal`
  class (`public/assets/js/components.js:20`, CSS `components.css:4-100`) is
  available — and it's the **only** option here with real `<select>`
  support, since `AdminShared.showInputModal` only renders `text`/`textarea`
  inputs (confirmed by reading the full function body — there is no
  `type:'select'` branch). This is exactly the pattern `revokeAdmin()`
  already uses in `public/assets/js/pages/admin-init.js:1295-1394` for
  "pick a new role in a modal" — replicate it directly:
  ```js
  const content = document.createElement('div');
  content.innerHTML = `
    <p>Change this account's type.</p>
    <div style="margin-top:1rem;">
      <label style="display:block;margin-bottom:4px;font-weight:600;">New account type</label>
      <select id="account-type-target" style="width:100%;padding:8px;border:1px solid #d4d4d8;border-radius:4px;">
        <option value="customer">Customer</option>
        <option value="supplier">Supplier</option>
      </select>
    </div>`;
  const modal = new Modal({ title: 'Change Account Type', content, confirmText: 'Continue', cancelText: 'Cancel', onConfirm: ... });
  modal.show();
  ```
  `Modal` renders the panel's nicest-looking chrome available on this page
  (blurred glass overlay `rgba(15,23,42,.45)` + `backdrop-filter:
blur(12px)`, glass card `rgba(255,255,255,.92)`, `border-radius:16px`,
  layered shadow) — a genuine precedent for "premium" already in production
  use for essentially the same interaction, not something to build from
  scratch.
- When the target is `supplier`, extend the same modal `content` block with
  the supplier-info fields (company/category/location), styled with the
  plain admin input/select rules already defined in `admin.css`:
  `select{}` is a bare tag selector (`admin.css:112`), but the input rule is
  the attribute selector `input[type="text"]{}` (`admin.css:95`) — so any
  new `<input>` markup needs an explicit `type="text"` attribute, or it
  won't pick up the existing styling
  (`padding:6px 8px;border-radius:4px;border:1px solid #d4d4d8`) at all.
- When the target is `customer` and a supplier profile exists, prepend a
  warning line to the modal content in the admin danger colour
  (`color:#ef4444;font-weight:600`), phrased like the existing
  `deleteUser()` supplier-warning sentence
  (`admin-user-detail-init.js:364-367`: _"This will delete the user,
  supplier profile, packages and public listing data."_) adapted to
  _suspend_ rather than delete — same voice, same visual weight, no new
  component.
- **Feedback**: `AdminShared.showToast(message, 'success' | 'error' |
'warning')` — matches exactly what every other action on this page already
  does (`deleteUser`, `toggleSuspend`, `resetPassword`). **Correction to an
  earlier pass of this plan**, which assumed `showToast` always falls back
  to a plain, flat, top-right toast on this page: it doesn't. `showToast`
  (`admin-shared.js:368-373`) checks `typeof Toast !== 'undefined'` first
  and, if so, delegates to `Toast[type](message)` — and a `class Toast`
  **is** defined in `public/assets/js/components.js:160` (the same file
  that supplies the `Modal` class used above), which
  `admin-user-detail.html` already loads. So `Toast.success`/`.error`/
  `.warning`/`.info` (static methods at `components.js:235-247`) are what
  actually render here, not the inline-styled fallback further down in
  `showToast`'s body. Those render via the shared `.toast-container`/`.toast`
  classes, which get their final appearance from whichever loaded
  stylesheet wins the cascade — and since `admin-enhanced.css`
  (`admin-enhanced.css:2050-2129`) is `<link>`ed _after_ `components.css`
  in this page's `<head>`, its bottom-right positioning wins over
  `components.css`'s top-right rule. **But the per-type left-border colour
  does not actually apply — worth getting right, not glossing over**:
  `Toast.show()` (`components.js:183`) sets `toast.className =
  \`toast toast-${type}\``(e.g.`"toast toast-success"`), while
  `admin-enhanced.css`'s colour rules are the _compound_ selectors
  `.toast.success`/`.toast.error`/etc. (`admin-enhanced.css:2073-2087`) —
  requiring a literal `success`class on the element, which never exists
  (only`toast-success`does), so those colour rules never match. The
  unconditional`.toast { border-left: 4px solid; }`(line 2070, no colour
  specified) still applies, rendering a plain uncoloured border rather than
  a colour-coded accent. The icon _does_ still get the right colour, but via
  a different, correctly-matching selector in`components.css`
  (`.toast-success .toast-icon`, a descendant selector that only needs
  `.toast-success`to exist anywhere as an ancestor class, not compounded
  with`.toast`). **Net effect: `showToast`on this page renders
  bottom-right with a correctly-coloured icon but an uncoloured left
  border** — closer to`showEnhancedToast`'s intended look than a plain
  flat toast, but not identical to it. Still use `showToast`(it's what
  every neighbouring action on this page already calls), just don't
  describe the result as fully matching`showEnhancedToast`'s styling —
  it's a pre-existing CSS bug in the admin panel (a compound selector that
  doesn't match the class the JS actually generates), not something this
  feature needs to fix, but also not something to mischaracterize as
  working.
- **Supplier Detail page** (§5.2's promoted link + status banner): style the
  "owner is no longer a supplier" banner with the admin warning palette
  already established for verification notices (`#fef3c7` background /
  `#f59e0b` border / `#92400e` text) rather than inventing new colours.

### 9.4 Responsive behaviour (both sides)

- **Customer settings**: no bespoke breakpoints needed. `.card`/`.form-row`/
  `.cta` are already responsive at the site's established 768px/640px/480px
  cascade (`styles.css`, `ui-ux-fixes.css`,
  `signed-in-mobile-fixes.css`), and the reused role-pill component ships
  its own `@media (max-width:640px)` stacking rule spread across two
  adjacent selectors in `auth.css:1788-1798` — `.role-toggle,
.auth-role-picker{flex-direction:column;gap:.5rem}` (the wrapper) plus
  `.role-pill, .auth-role-option{width:100% !important;text-align:center}`
  (the pills themselves) — it already goes full-width-stacked on phone
  without extra work, just make sure both rules get copied together, not
  only one. On mobile, `.card` corner
  radius is normalized to 12px automatically by the existing
  `signed-in-mobile-fixes.css` patch (site-wide, applies to any `.card`).
  One thing to verify in manual QA rather than assume: the page reserves a
  fixed bottom tab bar on ≤768px (`.ef-bottom-nav`, glassmorphic, ~64px)
  that the existing delete-modal doesn't currently account for either —
  confirm the new confirmation modal isn't clipped or overlapped by it on a
  real phone viewport.
- **Admin**: the panel is not desktop-only — it already has substantial
  phone/tablet coverage (16 `@media` blocks in `admin-enhanced.css` alone,
  plus a panel-wide `mobile-optimizations.css` patch that generically
  targets `.modal`/`.modal-content` at `max-width:768px`). Build the new
  modal at percentage width, mirroring the `Modal`/`AdminShared` convention
  already in use (`width:90%; max-width:500px`), and it inherits that
  coverage for free — nothing new to design here, just confirm in QA on a
  tablet-width viewport since that's plausibly how support staff check
  things on the move.

### 9.5 Motion (the concrete answer to "premium")

- **Site-wide micro-interaction standard**: ~150–200ms `ease` for
  hover/focus states (buttons, toggles) — already built into the reused
  role-pill and `.settings-sm-btn`/`.settings-primary-btn` hover rules, no
  new work needed there.
- **Larger-surface standard**: ~300ms `cubic-bezier(0.4, 0, 0.2, 1)` for
  overlays/menus — the same curve the mobile nav slide-in already uses
  (`admin-navbar.css`/`navbar.css`).
- The one deliberate addition this plan calls for on both target modals is
  the `components.css` `.modal` entrance treatment described in §9.2 and
  §9.3 (spring-scale + backdrop blur fade) — the single most direct lever
  available for the "premium" ask, because it's an existing, already-shipped
  treatment being applied to two modals that currently lack it, not a new
  animation system.
- Every new transition/animation is automatically covered by the site's
  blanket `prefers-reduced-motion` rule (`animations.css`, universal
  selector) — no extra accessibility work needed, provided the new
  transitions use standard CSS `transition`/`animation` properties rather
  than JS-driven motion (which the blanket rule wouldn't catch).

---

## 10. Summary of files a future PR will likely touch

```
NEW    services/accountTypeConversion.service.js
NEW    tests/unit/account-type-conversion.test.js
NEW    tests/unit/admin-account-type-conversion.test.js
NEW    tests/integration/account-type-conversion-route.test.js
NEW    e2e/account-type-conversion.spec.js
NEW    docs/ACCOUNT_TYPE_CONVERSION.md              (post-implementation, user-facing)
EDIT   middleware/auth.js                            (required: authRequired must read role from the fresh DB user, not the JWT claim — §2.6/§5.3)
EDIT   routes/settings.js
EDIT   routes/admin-user-management.js               (new admin endpoint; remove `role` handling from PUT /:id; fix supplierProfile propagation)
EDIT   services/supplierProfileProvisioning.service.js
EDIT   services/catalogCache.js                       (no code change expected — just confirm `invalidate()` is called after every approved/status change made by the conversion service, §3.3)
EDIT   models/index.js
EDIT   public/settings.html
EDIT   public/assets/css/settings.css                (§9.2: role-pill + glass-card + modal-entrance rules — copied/adapted from auth.css and components.css, since neither is loaded on /settings)
EDIT   public/assets/js/pages/settings-init.js
EDIT   public/assets/js/pages/admin-user-detail-init.js   (replace bare role <select> with guarded action + Modal-based picker, §9.3)
EDIT   public/assets/js/pages/admin-supplier-detail-init.js  (promote linked-user link; add owner-status banner, §9.3)
```

No new CSS file is needed on the admin side — §9.3's modal, badges, and
colours are all produced by classes/hex values `admin-user-detail-init.js`
and its already-loaded stylesheets (`admin.css`, `admin-enhanced.css`,
`components.css`) already ship.
