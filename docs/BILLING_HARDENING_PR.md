# Billing and subscription hardening PR

This PR addresses the highest-risk items raised in the payment, subscription, pricing and access-control audit.

## Implemented changes

- Added `config/billingPlans.js` as the canonical server-side billing plan registry.
- Wired the registry into both live checkout entry points: `routes/payments.js` and `routes/subscriptions-v2.js`.
- Stopped subscription checkout from trusting browser-supplied `priceId`, `amount`, `currency`, `successUrl` or `cancelUrl` as billing authority.
- Resolved Stripe price IDs server-side from canonical `planId` and `billingInterval`.
- Preserved compatibility for legacy plan names such as `Professional Plus` while normalising them to canonical `pro_plus`.
- Added canonical `planId` and `billingInterval` metadata to Checkout Sessions and Stripe subscriptions.
- Added Stripe idempotency keys for Checkout creation and plan-change calls.
- Normalised checkout and billing portal return URLs to the configured EventFlow origin.
- Hardened webhook provisioning so missing or unknown paid plan metadata is rejected instead of defaulting to Pro.
- Closed the paid-access-after-Stripe-deletion gap by never granting a paid tier once the Stripe subscription has ended.
- Hardened feature gating so paid access requires an active/trialing subscription with a valid period or trial end.
- Added unit tests for plan resolution, aliases, invalid intervals and off-origin return URLs.

## Acceptance checks

Run before merging:

```bash
npm test -- tests/unit/billingPlans.test.js --runInBand
npm run test:ci
npm run lint
```

## Deployment notes

Set the correct Railway Stripe price variables before enabling paid checkout:

```env
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_PLUS_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_PRO_PLUS_YEARLY_PRICE_ID=price_...
BASE_URL=https://event-flow.co.uk
STRIPE_WEBHOOK_SECRET=whsec_...
```

Do not configure `pro_plus` to use `STRIPE_PRO_PRICE_ID`. `pro_plus` must use `STRIPE_PRO_PLUS_PRICE_ID` or checkout will be rejected.
