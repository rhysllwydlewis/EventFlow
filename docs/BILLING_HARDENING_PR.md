# Billing and subscription hardening PR

This PR addresses the highest-risk items raised in the payment, subscription, pricing and access-control audit.

## What this PR changes

- Adds `config/billingPlans.js` as the canonical server-side billing plan registry.
- Maps supported plan aliases such as `pro_yearly` and `pro_plus_monthly` to canonical `planId` and `billingInterval` values.
- Resolves Stripe price IDs on the server from environment variables instead of relying on browser-supplied price IDs.
- Normalises checkout return URLs back to the configured `BASE_URL` origin to avoid off-site redirects.
- Adds unit tests proving that Professional Plus resolves to its own price ID and does not silently fall back to the Professional price.
- Adds unit tests for unknown plan rejection and return URL origin protection.

## Follow-up wiring required before merge

The repo currently has two checkout entry points:

- `routes/payments.js`, legacy `/api/v1/payments/create-checkout-session`
- `routes/subscriptions-v2.js`, current `/api/v2/subscriptions/create-checkout-session`

The new registry is intentionally isolated and tested first so the route wiring can be reviewed cleanly. The next commit in this PR should replace local plan maps in both routes with:

```js
const {
  resolvePriceIdForRequest,
  normaliseReturnUrl,
} = require('../config/billingPlans');
```

and only accept `planId` plus optional `billingInterval` from the client. Do not accept client-provided `priceId`, `amount`, `currency`, `successUrl` or `cancelUrl` as billing authority.

## Acceptance checks

Run:

```bash
npm test -- tests/unit/billingPlans.test.js --runInBand
```

Then wire the registry into the two checkout routes and run:

```bash
npm run test:ci
```

## Deployment notes

Set the correct Railway Stripe price variables before enabling paid checkout:

```env
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_PLUS_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
STRIPE_PRO_PLUS_YEARLY_PRICE_ID=price_...
BASE_URL=https://event-flow.co.uk
```

Do not configure `pro_plus` to use the `STRIPE_PRO_PRICE_ID` fallback. That was one of the key audit findings.
