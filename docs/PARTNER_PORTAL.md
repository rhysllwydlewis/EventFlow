# Partner / Affiliate Portal

## Overview

The Partner Portal is a **hidden** area of EventFlow that allows influencers, Facebook group admins, and community promoters to earn credits by referring wedding suppliers to sign up and get started on EventFlow.

It lives at `/partner` — this URL is **not indexed** (`noindex, nofollow`) and not linked from public navigation. You share the URL directly with partners.

---

## User Flows

### Partner signs up

1. Partner visits `/partner`
2. Partner clicks "Join as partner" and fills in the signup form
3. Their account is **auto-activated** with role `partner`
4. A unique referral link is generated: `https://yourdomain.com/auth?ref=p_XXXXXXXX&role=supplier`
5. Partner is redirected to `/partner/dashboard`

### Supplier signs up via partner link

1. Partner shares their referral link
2. Supplier clicks the link — it lands on the existing `/auth` registration page
3. The `ref` code is passed in the form body and stored in the registration call
4. On successful registration, a `partner_referral` record is created linking the supplier to the partner

### Credits are earned

- **+5 credits** when the referred supplier **signs up** via the partner's referral link (immediate on registration)
- **+10 credits** when the referred supplier creates their **first-ever package** (within 30 days of their signup)
- **+15 credits** when the referred supplier receives their **first customer review**
- **+20 credits** when the referred supplier's **profile is approved** by an EventFlow admin
- **+100 credits** when the referred supplier makes their **first successful Stripe subscription payment** (within 30 days of their signup, **not** trial activations or £0 invoices)
- All bonuses are awarded **only once** per supplier (idempotent)

### Available vs maturing credits

Once earned, credits go through a **30-day maturation period** before they become available for cashout:

| Credit state  | Description                                                                             |
| ------------- | --------------------------------------------------------------------------------------- |
| **Maturing**  | Recently earned — not yet available for cashout (< 30 days old)                         |
| **Available** | Mature credits (≥ 30 days old) — can be used for gift card cashout                      |
| **Potential** | Credits that _could_ be earned from active referrals in their 30-day attribution window |

### Credit value and conversion

Credits convert to GBP at a rate configured by the `POINTS_PER_GBP` environment variable (default: 100 points = £1):

| Credits | GBP value |
| ------- | --------- |
| 1       | £0.01     |
| 10      | £0.10     |
| 100     | £1.00     |

---

## Pages

| URL                                | Who can access    | Description                                                   |
| ---------------------------------- | ----------------- | ------------------------------------------------------------- |
| `/partner`                         | Public (hidden)   | Entry — login or sign up as partner                           |
| `/partner/dashboard`               | Partners & admins | Dashboard with ref link, stats, referrals                     |
| `/admin-partners`                  | Admins only       | Standalone partner moderation dashboard                       |
| `/admin` (Partners section in nav) | Admins only       | Partner moderation also accessible from the main admin navbar |

---

## API Endpoints

### Partner (requires `partner` role)

| Method | Path                                           | Description                                               |
| ------ | ---------------------------------------------- | --------------------------------------------------------- |
| `POST` | `/api/v1/partner/register`                     | Create a new partner account                              |
| `GET`  | `/api/v1/partner/me`                           | Get current partner profile, ref code, balance            |
| `GET`  | `/api/v1/partner/referrals`                    | List referred suppliers with statuses                     |
| `GET`  | `/api/v1/partner/transactions`                 | List credit transaction history                           |
| `POST` | `/api/v1/partner/regenerate-code`              | Generate a new referral code (old code stays valid)       |
| `GET`  | `/api/v1/partner/code-history`                 | List previously used referral codes                       |
| `POST` | `/api/v1/partner/support-ticket`               | Raise a general support ticket from the partner dashboard |
| `GET`  | `/api/v1/partner/support-tickets`              | List all support tickets raised by the current partner    |
| `GET`  | `/api/v1/partner/tremendous/products`          | List available gift card products (partner-only)          |
| `POST` | `/api/v1/partner/tremendous/orders`            | Create a gift card order/reward (partner-only)            |
| `GET`  | `/api/v1/partner/tremendous/orders/:id`        | Fetch order / reward status (partner-only)                |
| `POST` | `/api/v1/partner/tremendous/orders/:id/resend` | Resend a gift card email (partner-only)                   |

> **Note:** All partner API endpoints return `403 { error: "...", disabled: true }` if the partner's account status is `disabled`. The dashboard will show a clear "account disabled" message in this case.

#### Support ticket fields (`POST /api/v1/partner/support-ticket`)

| Field     | Type   | Rules                              |
| --------- | ------ | ---------------------------------- |
| `subject` | string | **Required.** Max 150 characters.  |
| `message` | string | **Required.** Max 2000 characters. |

Validation errors return HTTP `400` with a JSON body `{ "error": "..." }` describing the problem.

#### Gift card cashout — Tremendous integration

Partners can send gift cards directly from the partner dashboard using the [Tremendous API](https://developers.tremendous.com/docs/introduction). The flow is:

1. Partner selects a gift card brand from the catalogue (`GET /tremendous/products`).
2. Partner enters the amount, recipient name, and recipient email.
3. Dashboard submits `POST /tremendous/orders`; Tremendous delivers the gift card by email.
4. Partner can check delivery status via `GET /tremendous/orders/:id`.
5. If needed, partner can resend via `POST /tremendous/orders/:id/resend`.

**Access control:** All `/tremendous/*` endpoints require `authRequired + roleRequired('partner')`.
Non-partner roles (supplier, customer, admin) receive `403 Forbidden`.

**Financial safety:**

- The server enforces that the partner has **sufficient available points** before creating an order.
- Points are debited atomically before calling Tremendous; if the API call fails the debit is automatically reversed.
- Every order is persisted to `partner_cashout_orders` for audit and support.
- An audit email copy is sent to `TREMENDOUS_AUDIT_EMAIL` (if configured) on every successful order.

**Configuration:**

| Env var                  | Required | Description                                          |
| ------------------------ | -------- | ---------------------------------------------------- |
| `TREMENDOUS_API_KEY`     | Yes      | Bearer token from the Tremendous dashboard           |
| `TREMENDOUS_ENV`         | No       | `sandbox` (default) or `production`                  |
| `TREMENDOUS_AUDIT_EMAIL` | No       | Email address to receive audit copies of every order |
| `POINTS_PER_GBP`         | No       | Conversion rate: points per £1 (default: `100`)      |

- Sandbox: `https://testflight.tremendous.com/api/v2`
- Production: `https://www.tremendous.com/api/v2`

**Sandbox testing:** Use `TREMENDOUS_ENV=sandbox` and a sandbox API key from [testflight.tremendous.com](https://testflight.tremendous.com).

### Admin (requires `admin` role)

| Method  | Path                                                      | Description                                               |
| ------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `GET`   | `/api/v1/admin/partners`                                  | List all partners (search & filter)                       |
| `GET`   | `/api/v1/admin/partners/:id`                              | Get full detail for a partner                             |
| `PATCH` | `/api/v1/admin/partners/:id/status`                       | Enable or disable a partner                               |
| `POST`  | `/api/v1/admin/partners/:id/credits`                      | Apply manual credit adjustment                            |
| `GET`   | `/api/v1/admin/partners/payout-requests`                  | List all payout request tickets                           |
| `PATCH` | `/api/v1/admin/partners/payout-requests/:ticketId/status` | Update payout ticket status                               |
| `GET`   | `/api/v1/admin/partners/cashout-orders`                   | List Tremendous cashout orders (query: partnerId, status) |

---

## Data Collections

Three collections are used (in `store.js` and MongoDB):

### `partners`

| Field       | Type       | Description                                                      |
| ----------- | ---------- | ---------------------------------------------------------------- |
| `id`        | string     | Unique ID (`prt_...`)                                            |
| `userId`    | string     | Links to `users` collection (**unique**: one user → one partner) |
| `refCode`   | string     | Unique referral code (e.g. `p_A1B2C3D4`) (**unique**)            |
| `status`    | string     | `active` or `disabled`                                           |
| `createdAt` | ISO string | Account creation time                                            |

### `partner_referrals`

| Field                   | Type       | Description                                                                          |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `id`                    | string     | Unique ID (`ref_...`)                                                                |
| `partnerId`             | string     | Links to `partners`                                                                  |
| `supplierUserId`        | string     | The referred supplier's user ID (**unique**: one supplier → one partner attribution) |
| `supplierCreatedAt`     | ISO string | When the supplier signed up                                                          |
| `attributionExpiresAt`  | ISO string | `supplierCreatedAt + 30 days`                                                        |
| `packageQualified`      | boolean    | Package bonus awarded                                                                |
| `subscriptionQualified` | boolean    | Subscription bonus awarded                                                           |

### `partner_credit_transactions`

| Field            | Type           | Description                                                                                                                               |
| ---------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string         | Unique ID (`ptx_...`)                                                                                                                     |
| `partnerId`      | string         | Links to `partners`                                                                                                                       |
| `supplierUserId` | string \| null | Supplier who triggered the credit (null for adjustments/debits)                                                                           |
| `type`           | string         | `PACKAGE_BONUS`, `SUBSCRIPTION_BONUS`, `REFERRAL_SIGNUP_BONUS`, `FIRST_REVIEW_BONUS`, `PROFILE_APPROVED_BONUS`, `ADJUSTMENT`, or `REDEEM` |
| `amount`         | number         | Credit amount (positive = earn, negative = deduct/redeem)                                                                                 |
| `notes`          | string         | Human-readable note                                                                                                                       |
| `adminUserId`    | string \| null | Set for admin adjustments                                                                                                                 |
| `externalRef`    | string \| null | Reference to cashout order (set on REDEEM transactions)                                                                                   |
| `createdAt`      | ISO string     | Transaction timestamp                                                                                                                     |

> **Maturity rule:** Credits with `type !== REDEEM` and `type !== ADJUSTMENT` are only included in `availableBalance` once they are ≥ 30 days old (`CREDIT_MATURITY_DAYS`). Younger credits appear in `maturingBalance`.

### `partner_cashout_orders`

| Field                | Type           | Description                                                   |
| -------------------- | -------------- | ------------------------------------------------------------- |
| `id`                 | string         | Unique ID (`pco_...`)                                         |
| `partnerId`          | string         | Links to `partners`                                           |
| `partnerUserId`      | string         | User ID of the partner who initiated the cashout              |
| `externalRef`        | string         | Idempotency key used as Tremendous `custom_identifier`        |
| `debitTxnId`         | string         | ID of the REDEEM transaction in `partner_credit_transactions` |
| `pointsDebited`      | number         | Number of points debited                                      |
| `valueGbp`           | number         | GBP value of the gift card                                    |
| `currency`           | string         | ISO 4217 currency code                                        |
| `productId`          | string         | Tremendous product ID                                         |
| `recipientName`      | string         | Gift card recipient name                                      |
| `recipientEmail`     | string         | Gift card recipient email                                     |
| `tremendousOrderId`  | string \| null | Tremendous order ID (after successful creation)               |
| `tremendousRewardId` | string \| null | Tremendous reward ID (first reward in the order)              |
| `tremendousStatus`   | string \| null | Order status from Tremendous at creation time                 |
| `status`             | string         | `created`, `failed`                                           |
| `createdAt`          | ISO string     | Record creation timestamp                                     |

### Database Indexes / Uniqueness

The following unique constraints are enforced via MongoDB indexes (see `db-init.js`):

| Collection          | Field(s)         | Constraint                                                  |
| ------------------- | ---------------- | ----------------------------------------------------------- |
| `partners`          | `userId`         | Unique — one user can only be one partner                   |
| `partners`          | `refCode`        | Unique — referral codes are globally unique                 |
| `partner_referrals` | `supplierUserId` | Unique — one supplier can only be attributed to one partner |

These indexes are created automatically when the database is initialised. If running a fresh deployment or migration, run `node db-init.js` to ensure indexes are applied.

---

## Disabled Partner Semantics

When an admin sets a partner's status to `disabled`:

- **API access blocked**: All partner dashboard API endpoints (`/me`, `/referrals`, `/transactions`) return `403` with `{ disabled: true }`.
- **Dashboard**: The partner dashboard will display a clear "Account disabled — please contact support" message.
- **No new credit awards**: `awardPackageBonus()` and `awardSubscriptionBonus()` both return `null` and skip the award for disabled partners.
- **Referral recording**: New supplier sign-ups via a disabled partner's ref link are **still recorded** in `partner_referrals` (the attribution exists), but no credits will be awarded until the partner is re-enabled.
- **Existing credits**: Disabling a partner does **not** remove existing credits or transactions from the ledger.
- **Re-enabling**: When a partner is re-enabled (status set back to `active`), future qualifying events will resume awarding credits. However, bonuses that were missed while disabled are **not** retroactively awarded.

---

## Technical Integration Points

### Package creation hook

`routes/packages.js` — after inserting a package, checks if it's the supplier's first package and calls `partnerService.awardPackageBonus(supplierUserId)`.

### Stripe webhook hook

`webhooks/stripeWebhookHandler.js` — inside `handleInvoicePaymentSucceeded()`, after updating subscription status, calls `partnerService.awardSubscriptionBonus(subscription.userId)`.

**Important**: The subscription bonus is only awarded when `invoice.amount_paid > 0`. This prevents awarding credits for:

- Trial activations (£0 first invoice)
- Free plan activations
- Any Stripe invoice with `amount_paid === 0`

### Referral sign-up hook

`routes/auth.js` — after `partnerService.recordReferral()` succeeds, calls `partnerService.awardReferralSignupBonus(supplierUserId)` (non-blocking).

### First review hook

`routes/reviews.js` — after a customer review is created (`POST /api/suppliers/:supplierId/reviews`), calls `partnerService.awardFirstReviewBonus(supplier.ownerUserId)` (non-blocking).

### Profile approval hook

`routes/supplier-admin.js` — after an admin approves a supplier profile (`POST /api/admin/suppliers/:id/approve`), calls `partnerService.awardProfileApprovedBonus(supplier.ownerUserId)` (non-blocking).

### Referral capture on registration

`routes/auth.js` — the `POST /register` handler accepts an optional `ref` field in the request body. When a supplier registers with a valid `ref` code belonging to an active partner, `partnerService.recordReferral()` is called.

### Frontend capture

The frontend can pass `ref` in the registration form body. The `/auth` page can be linked as:

```
https://yourdomain.com/auth?ref=p_XXXXXXXX&role=supplier
```

The `ref-capture.js` utility (or inline auth form logic) should read the `ref` query param and include it in the registration API call.

---

## Environment Variables

| Variable                 | Required      | Description                                                                |
| ------------------------ | ------------- | -------------------------------------------------------------------------- |
| `BASE_URL`               | No            | Full URL used to generate referral links (e.g. `https://event-flow.co.uk`) |
| `JWT_SECRET`             | Yes           | JWT signing secret (shared with rest of app)                               |
| `MONGODB_URI`            | Yes (prod)    | MongoDB connection string                                                  |
| `TREMENDOUS_API_KEY`     | Yes (cashout) | Tremendous API bearer token                                                |
| `TREMENDOUS_ENV`         | No            | `sandbox` (default) or `production`                                        |
| `TREMENDOUS_AUDIT_EMAIL` | No            | Email to receive audit copies of every gift card order                     |
| `POINTS_PER_GBP`         | No            | Conversion rate: points per £1 (default: `100`)                            |

---

## Admin Operations

### Accessing partner moderation

Partner moderation is available in **two places**:

1. **Main admin navigation** — the "Partners" entry (🤝) in the admin navbar links directly to `/admin-partners` from every admin page.
2. **Standalone page** — navigate directly to `/admin-partners`.

### Gift card payout requests (admin)

The admin payout requests tab (`GET /api/v1/admin/partners/payout-requests`) and status update endpoint (`PATCH /api/v1/admin/partners/payout-requests/:ticketId/status`) remain available for any legacy tickets already in the system. New payout requests via `/payout-request` now return 503 until the Tremendous integration is complete.

### Enable / Disable a partner

From `/admin-partners`, click "Disable" to prevent a partner from earning further credits. See [Disabled Partner Semantics](#disabled-partner-semantics) above for full behaviour details.

### Manual credit adjustment

Click "Credits" next to any partner to open the adjustment modal. Enter a positive or negative integer and a **required** audit note. All adjustments are stored in the `partner_credit_transactions` ledger with `type: ADJUSTMENT`.

### View partner details

Click "View" to open a side panel showing:

- Partner profile info
- Credit breakdown (balance, package bonuses, subscription bonuses)
- Transaction history
- Full referral list with qualification status

---

## Security Notes

- The `/partner` route is **not linked publicly** and carries `X-Robots-Tag: noindex, nofollow` on all `/partner*` sub-paths (enforced by `middleware/seo.js`).
- Partner role (`role: 'partner'`) can **only** be assigned via the partner signup endpoint (`POST /api/v1/partner/register`).
- The general registration endpoint (`POST /api/v1/auth/register`) only allows `supplier` and `customer` roles.
- All partner dashboard API routes require `authRequired + roleRequired('partner')` middleware.
- All admin partner API routes require `authRequired + roleRequired('admin')` middleware.
- Server-side HTML guards in `server.js` prevent unauthenticated access to `/partner/dashboard` and `/admin-partners` before `express.static()` serves the files.
- Disabled partner accounts are blocked at the API layer — the middleware check runs before any data is returned.
- **Tremendous gift card endpoints** (`/api/v1/partner/tremendous/*`) are protected by `authRequired + roleRequired('partner')` server-side. Supplier, customer, and admin accounts all receive `403 Forbidden`. UI gating is a secondary measure only.

---

## Running Tests

```bash
# Run partner service unit tests
npx jest tests/unit/partner-service.test.js --verbose

# Run partner points enhancements tests (new bonus types, available/maturing balance)
npx jest tests/unit/partner-points-enhancements.test.js --verbose

# Run new partner endpoints tests (support tickets, cashout balance enforcement)
npx jest tests/unit/partner-new-endpoints.test.js --verbose

# Run Tremendous gift card endpoint tests
npx jest tests/unit/partner-tremendous.test.js --verbose

# Run partner payout validation unit tests
npx jest tests/unit/partner-payout-validation.test.js --verbose

# Run admin partner payout security integration tests
npx jest tests/integration/admin-partner-payout.test.js --verbose

# Run Stripe webhook handler tests (includes partner bonus gating tests)
npx jest tests/unit/stripeWebhookHandler.test.js --verbose
```
