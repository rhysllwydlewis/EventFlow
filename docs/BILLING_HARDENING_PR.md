# Billing and subscription hardening PR

This PR addresses the highest-risk payment, subscription, pricing and access-control findings that can be safely verified in this branch.

## Implemented changes

- Added `config/billingPlans.js` as the canonical server-side billing plan registry.
- Hardened the legacy payment checkout endpoint so browser-supplied `priceId`, `amount`, `currency`, `successUrl` and `cancelUrl` are not used as billing authority.
- Resolved Stripe price IDs server-side from canonical `planId` and `billingInterval`.
- Preserved compatibility for legacy plan names such as `Professional Plus` while normalising them to canonical `pro_plus`.
- Added canonical `planId` and `billingInterval` metadata to legacy Checkout Sessions and pending payment records.
- Normalised checkout and billing portal return URLs to the configured EventFlow origin.
- Hardened feature gating so paid access requires active/trialing subscription status with a valid current period or trial end.
- Hardened subscription service feature checks and user-tier persistence so stale `subscriptionTier` does not continue granting paid features after expiry.
- Added unit tests for plan resolution, aliases and off-origin return URLs.

## Known follow-up before production billing cutover

- Wire `routes/subscriptions-v2.js` checkout, direct subscription, upgrade and downgrade handlers to `config/billingPlans.js`.
- Remove remaining client-supplied `priceId` authority from the direct v2 subscription endpoint.
- Harden `webhooks/stripeWebhookHandler.js` so missing or unknown paid plan metadata is rejected instead of falling back to Pro.
- Run the full test suite and any deployment smoke tests before enabling live billing.

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

Do not configure `pro_plus` to use `STRIPE_PRO_PRICE_ID`. `pro_plus` must use `STRIPE_PRO_PLUS_PRICE_ID` or checkout should be rejected.
