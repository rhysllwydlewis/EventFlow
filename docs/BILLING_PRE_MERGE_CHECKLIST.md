# Billing pre-merge checklist

## Security checks

- [ ] Checkout accepts only plan ID and optional billing interval from the browser.
- [ ] The server resolves all Stripe prices from the canonical billing registry.
- [ ] The browser cannot set price, amount, currency, redirect targets or entitlement tier.
- [ ] Professional Plus resolves only to the Professional Plus Stripe price.
- [ ] Missing paid-plan price configuration returns an error and does not fall back to another paid plan.
- [ ] Stripe metadata includes canonical user ID, plan ID and billing interval.
- [ ] Paid access requires active or trialing subscription status and a valid current period or trial end.
- [ ] Expired, past-due or cancelled subscriptions fall back to Free features.
- [ ] Stale user tier data does not grant paid access unless its expiry date is still in the future.

## Manual smoke tests

1. Start from the pricing page and select Professional.
2. Confirm the browser payload does not include price, amount or currency.
3. Confirm Stripe Checkout opens with the Professional price.
4. Repeat for Professional Plus and confirm the Professional Plus price is used.
5. Try a forged browser request with Professional Plus and a different price. The server must ignore the forged price.
6. Try an unknown plan. The server must reject it.
7. Try an external redirect target. The server must normalise it back to the EventFlow origin.
8. Cancel or expire a test subscription in Stripe and confirm the account falls back to Free entitlements.

## Commands

```bash
npm test -- tests/unit/billingPlans.test.js --runInBand
npm run lint
npm run test:ci
```
