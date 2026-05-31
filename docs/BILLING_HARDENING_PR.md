# Billing and subscription hardening PR

This PR addresses the highest-risk payment, subscription, pricing and access-control findings that can be safely verified in this branch.

## Implemented changes

- Added `config/billingPlans.js` as the canonical server-side billing plan registry.
- Hardened the legacy payment checkout endpoint so browser-supplied billing values are not used as billing authority.
- Wired `routes/subscriptions-v2.js` checkout, direct subscription, upgrade and downgrade handlers to the canonical billing registry.
- Removed client-supplied Stripe price authority from the v2 direct subscription and upgrade flows.
- Resolved Stripe price IDs server-side from canonical `planId` and `billingInterval`.
- Preserved compatibility for legacy plan names such as `Professional Plus` while normalising them to canonical `pro_plus`.
- Added canonical `planId` and `billingInterval` metadata to Stripe Checkout Sessions and pending payment records.
- Normalised checkout and billing portal return URLs to the configured EventFlow origin.
- Added v2 webhook entry-point validation for canonical billing metadata.
- Hardened feature gating so paid access requires active/trialing subscription status with a valid current period or trial end.
- Hardened subscription service feature checks and user-tier persistence so stale `subscriptionTier` does not continue granting paid features after expiry.
- Added unit tests for plan resolution, aliases and off-origin return URLs.

## Remaining check before production billing cutover

- Clean `public/assets/js/checkout.js` so the browser sends only `planId` and optional `billingInterval`. The backend now ignores/rejects unsafe billing authority, but the frontend should still be tidied to avoid confusing payloads.
- Run the full test suite and deployment smoke tests before enabling live billing.

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
