/**
 * Source-level regression test for the dashboard Plan card's past_due branch
 * (renderPlan in public/assets/js/pages/supplier-dashboard-home.js).
 *
 * A failed payment drops the plan to 'free' immediately (see webhooks/stripeWebhookHandler.js
 * handleInvoicePaymentFailed), so without a dedicated branch the card looked identical to a
 * supplier who never subscribed, with no indication that a declined card was the reason.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/supplier-dashboard-home.js'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/css/supplier-dashboard-home.css'),
  'utf8'
);
// The plan card is drawn by renderPlan and the small helpers just above it (fact lines, actions).
const renderPlan = src.slice(
  src.indexOf('function periodLine('),
  src.indexOf('async function openBilling(')
);

describe('dashboard plan card: past_due state', () => {
  it("checks the subscription's status for past_due", () => {
    expect(renderPlan).toContain("status === 'past_due'");
  });

  it('tells the supplier their payment failed rather than pitching an upgrade', () => {
    expect(renderPlan).toContain('Payment failed');
    expect(renderPlan).toMatch(/did not go through/);
  });

  it('offers a way to fix it: update payment method opens the billing portal', () => {
    expect(renderPlan).toContain('Update payment method');
    expect(renderPlan).toContain('data-sdh-action="billing"');
    expect(src).toContain('/api/payments/create-portal-session');
  });

  it('does not show a renewal date for a past-due subscription', () => {
    expect(renderPlan).toContain('Renews on');
    // The end-of-period line is skipped outright when the payment failed.
    expect(renderPlan).toContain("const period = pastDue ? '' : periodLine(");
  });

  it('is styled as a danger callout in the page sheet', () => {
    expect(css).toContain('.sdh-callout--danger');
  });
});
