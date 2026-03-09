# Supplier Verification

This document describes the end-to-end supplier verification process in EventFlow, including the state machine, admin workflow, and how to run tests.

---

## State Machine

### States

| State            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `unverified`     | Supplier signed up but has **never submitted** for review      |
| `pending_review` | Supplier submitted their profile; **awaiting admin review**    |
| `needs_changes`  | Admin has reviewed and **requested changes** from the supplier |
| `approved`       | Admin has **approved** the supplier; listing is active         |
| `rejected`       | Admin has **rejected** the supplier                            |
| `suspended`      | Admin has **suspended** a previously-approved supplier         |

The canonical state is stored in the `verificationStatus` field on the supplier record, alongside the legacy `verified` boolean (kept for backward compatibility). The `verified` boolean is `true` only when `verificationStatus === 'approved'`.

### Transitions

```
unverified ──[supplier submits]──► pending_review ──[admin approves]──► approved ──[admin suspends]──► suspended
                                         │                                               │
                              [admin requests changes]                        [admin reinstates]
                                         │                                               │
                                    needs_changes ──[supplier resubmits]──► pending_review
                                         │
                              [admin rejects]
                                         │
                                      rejected ──[supplier resubmits]──► pending_review

unverified/rejected ──[admin approves directly]──► approved
```

### Valid Transitions Table

| From             | Actor    | Allowed Next States                       |
| ---------------- | -------- | ----------------------------------------- |
| `unverified`     | supplier | `pending_review`                          |
| `unverified`     | admin    | `approved`, `rejected`                    |
| `pending_review` | supplier | _(none – cannot re-submit while pending)_ |
| `pending_review` | admin    | `approved`, `rejected`, `needs_changes`   |
| `needs_changes`  | supplier | `pending_review`                          |
| `needs_changes`  | admin    | `rejected`                                |
| `approved`       | admin    | `suspended`, `rejected`                   |
| `rejected`       | supplier | `pending_review`                          |
| `rejected`       | admin    | `approved`                                |
| `suspended`      | admin    | `approved`, `rejected`                    |

---

## Supplier-Facing Flow

### 1. Sign Up

When a supplier registers, their profile is created with:

```json
{
  "verified": false,
  "verificationStatus": "unverified"
}
```

### 2. Check Verification Status

```http
GET /api/supplier/verification/status
Authorization: Bearer <supplier-token>
```

Response:

```json
{
  "verificationStatus": "unverified",
  "verified": false,
  "submittedAt": null,
  "reviewedAt": null
}
```

If `verificationStatus` is `needs_changes` or `rejected`, the response also includes:

```json
{
  "verificationNotes": "Please provide proof of insurance"
}
```

### 3. Submit for Verification

```http
POST /api/supplier/verification/submit
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "name": "My Business Name",
  "category": "Venues",
  "email": "contact@mybusiness.com",
  "phone": "07700000000",
  "location": "London, UK"
}
```

**Server-side validation** ensures these fields are present (either on the existing profile or in the request body):

- `name` – Business name
- `category` – Category
- `email` – Contact email
- `phone` – Contact phone
- `location` – Location / address

On success:

```json
{
  "message": "Verification submitted successfully. An admin will review your profile shortly.",
  "verificationStatus": "pending_review",
  "submittedAt": "2026-03-09T12:00:00.000Z"
}
```

Invalid transitions (e.g. submitting when already `approved`) return HTTP **409 Conflict**.

---

## Admin Workflow

### Verification Queue

```http
GET /api/admin/suppliers/pending-verification
```

Returns suppliers in `unverified` or `pending_review` states. The response includes `verificationStatus` and `submittedAt` for each entry.

### Approve a Supplier

```http
POST /api/admin/suppliers/:id/approve
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "notes": "Identity and documents verified"
}
```

Sets `verificationStatus → approved`, `verified → true`. Logs `supplier_approved` audit event.

### Reject a Supplier

```http
POST /api/admin/suppliers/:id/reject
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "reason": "Incomplete documentation"
}
```

A **reason is required**. Sets `verificationStatus → rejected`, `verified → false`. Logs `supplier_rejected` audit event.

### Request Changes

```http
POST /api/admin/suppliers/:id/request-changes
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "reason": "Please upload proof of insurance and update your business address"
}
```

Only available from `pending_review` state. Sets `verificationStatus → needs_changes`. Logs `supplier_needs_changes` audit event. The supplier must resubmit before the admin can approve.

### Suspend a Supplier

```http
POST /api/admin/suppliers/:id/suspend
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "reason": "Reported policy violation under investigation"
}
```

Only available from `approved` state. Sets `verificationStatus → suspended`, `verified → false`. Logs `supplier_suspended` audit event.

### Verify (Legacy / Combined Approve/Reject)

```http
POST /api/admin/suppliers/:id/verify
Content-Type: application/json
X-CSRF-Token: <csrf-token>

{
  "verified": true,
  "verificationNotes": "Manual verification by admin"
}
```

Retained for backward compatibility with existing admin UI. Uses the state machine internally.

### Audit Trail

```http
GET /api/admin/suppliers/:id/audit
```

Returns all verification events for a supplier in reverse chronological order:

```json
{
  "supplierId": "sup-001",
  "supplierName": "My Venue",
  "currentState": "approved",
  "audit": [
    {
      "id": "log-1",
      "action": "supplier_approved",
      "actor": "admin@eventflow.com",
      "details": { "name": "My Venue", "notes": "Documents verified" },
      "timestamp": "2026-03-09T14:00:00.000Z"
    }
  ]
}
```

---

## Admin Dashboard UI

The **Supplier Detail** page (`/admin-supplier-detail.html?id=<id>`) exposes the following action buttons. Each button is enabled/disabled based on the current verification state:

| Button              | Enabled States                                                           | Disabled States |
| ------------------- | ------------------------------------------------------------------------ | --------------- |
| **Approve**         | `unverified`, `pending_review`, `needs_changes`, `rejected`, `suspended` | `approved`      |
| **Request Changes** | `pending_review`                                                         | all others      |
| **Reject**          | all except `rejected`                                                    | `rejected`      |
| **Suspend**         | `approved`                                                               | all others      |
| **Verify Supplier** | all non-approved                                                         | `approved`      |

---

## Audit Log Events

| Event                             | When                            |
| --------------------------------- | ------------------------------- |
| `supplier_verification_submitted` | Supplier submits for review     |
| `supplier_approved`               | Admin approves                  |
| `supplier_rejected`               | Admin rejects                   |
| `supplier_needs_changes`          | Admin requests changes          |
| `supplier_suspended`              | Admin suspends                  |
| `supplier_reinstated`             | Admin reinstates from suspended |

Each event includes: actor (admin email), timestamp, supplier ID and name, and a reason/note.

---

## Running Tests

### Integration / Unit Tests

```bash
# All supplier verification tests
npx jest --testPathPattern="supplier-verification-flow" --no-coverage

# Full test suite
npm test
```

### E2E Tests (Playwright)

```bash
# Supplier verification E2E tests only
npx playwright test e2e/supplier-verification-flow.spec.js

# All E2E tests
npx playwright test
```

E2E tests use route mocking (no live database required) and run deterministically in CI.

---

## Implementation Files

| File                                                   | Purpose                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `utils/supplierVerificationStateMachine.js`            | State definitions, allowed transitions, `canTransition()` helper  |
| `routes/supplier-admin.js`                             | Admin endpoints: approve, reject, request-changes, suspend, audit |
| `routes/admin-user-management.js`                      | Legacy `/verify` endpoint (state-machine-backed)                  |
| `routes/supplier.js`                                   | Supplier-facing: `/verification/status`, `/verification/submit`   |
| `middleware/audit.js`                                  | Audit action constants                                            |
| `public/admin-supplier-detail.html`                    | Admin UI with all action buttons                                  |
| `public/assets/js/pages/admin-supplier-detail-init.js` | Button wiring, state-aware enable/disable logic                   |
| `tests/integration/supplier-verification-flow.test.js` | Unit + integration tests (63 tests)                               |
| `e2e/supplier-verification-flow.spec.js`               | E2E Playwright tests                                              |
