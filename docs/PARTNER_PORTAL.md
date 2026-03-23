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
- **+10 credits** when the referred supplier creates their **first-ever package** (within 30 days of their signup)
- **+100 credits** when the referred supplier makes their **first successful Stripe subscription payment** (within 30 days of their signup)
- Both bonuses **can stack** for the same supplier (max +110 credits per supplier)
- Each bonus is awarded **only once** per supplier (idempotent)

### Credit value
| Credits | GBP value |
|---------|-----------|
| 1       | £0.01     |
| 10      | £0.10     |
| 100     | £1.00     |

---

## Pages

| URL | Who can access | Description |
|-----|----------------|-------------|
| `/partner` | Public (hidden) | Entry — login or sign up as partner |
| `/partner/dashboard` | Partners & admins | Dashboard with ref link, stats, referrals |
| `/admin-partners` | Admins only | Partner moderation dashboard |

---

## API Endpoints

### Partner (requires `partner` role)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/partner/register` | Create a new partner account |
| `GET`  | `/api/v1/partner/me` | Get current partner profile, ref code, balance |
| `GET`  | `/api/v1/partner/referrals` | List referred suppliers with statuses |
| `GET`  | `/api/v1/partner/transactions` | List credit transaction history |

### Admin (requires `admin` role)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/v1/admin/partners` | List all partners (search & filter) |
| `GET`    | `/api/v1/admin/partners/:id` | Get full detail for a partner |
| `PATCH`  | `/api/v1/admin/partners/:id/status` | Enable or disable a partner |
| `POST`   | `/api/v1/admin/partners/:id/credits` | Apply manual credit adjustment |

---

## Data Collections

Three new collections are added (in `store.js` and MongoDB):

### `partners`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`prt_...`) |
| `userId` | string | Links to `users` collection |
| `refCode` | string | Unique referral code (e.g. `p_A1B2C3D4`) |
| `status` | string | `active` or `disabled` |
| `createdAt` | ISO string | Account creation time |

### `partner_referrals`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`ref_...`) |
| `partnerId` | string | Links to `partners` |
| `supplierUserId` | string | The referred supplier's user ID |
| `supplierCreatedAt` | ISO string | When the supplier signed up |
| `attributionExpiresAt` | ISO string | `supplierCreatedAt + 30 days` |
| `packageQualified` | boolean | Package bonus awarded |
| `subscriptionQualified` | boolean | Subscription bonus awarded |

### `partner_credit_transactions`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (`ptx_...`) |
| `partnerId` | string | Links to `partners` |
| `supplierUserId` | string \| null | Supplier who triggered the credit (null for adjustments) |
| `type` | string | `PACKAGE_BONUS`, `SUBSCRIPTION_BONUS`, `ADJUSTMENT`, or `REDEEM` |
| `amount` | number | Credit amount (positive = earn, negative = deduct/redeem) |
| `notes` | string | Human-readable note |
| `adminUserId` | string \| null | Set for admin adjustments |
| `createdAt` | ISO string | Transaction timestamp |

---

## Technical Integration Points

### Package creation hook
`routes/packages.js` — after inserting a package, checks if it's the supplier's first package and calls `partnerService.awardPackageBonus(supplierUserId)`.

### Stripe webhook hook
`webhooks/stripeWebhookHandler.js` — inside `handleInvoicePaymentSucceeded()`, after updating subscription status, calls `partnerService.awardSubscriptionBonus(subscription.userId)`.

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

No new environment variables are required. The partner portal uses:
- `BASE_URL` — used to generate full referral link URLs (e.g. `https://yourdomain.com`)
- `JWT_SECRET` — existing JWT secret for authentication
- `MONGODB_URI` — existing MongoDB connection (or falls back to local file storage)

---

## Admin Operations

### Enable / Disable a partner
From `/admin-partners`, click "Disable" to prevent a partner from earning further credits. Existing credits are unaffected.

### Manual credit adjustment
Click "Credits" next to any partner to open the adjustment modal. Enter a positive or negative integer and an audit note. All adjustments are stored in the `partner_credit_transactions` ledger.

### View partner details
Click "View" to open a side panel showing:
- Partner profile info
- Credit breakdown (balance, package bonuses, subscription bonuses)
- Transaction history
- Full referral list with qualification status

---

## Security Notes

- The `/partner` route is **not linked publicly** and has `noindex, nofollow` meta tag
- Partner role (`role: 'partner'`) can **only** be assigned via the partner signup endpoint (`POST /api/v1/partner/register`)
- The general registration endpoint (`POST /api/v1/auth/register`) only allows `supplier` and `customer` roles
- All partner dashboard API routes require `authRequired + roleRequired('partner')` middleware
- All admin partner API routes require `authRequired + roleRequired('admin')` middleware
- Server-side HTML guards in `server.js` prevent unauthenticated access to `/partner/dashboard` and `/admin-partners` before `express.static()` serves the files

---

## Running Tests

```bash
# Run partner service unit tests
npx jest tests/unit/partner-service.test.js --verbose
```
