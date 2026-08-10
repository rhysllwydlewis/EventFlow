/**
 * Source-level regression test for the dashboard Subscription card's
 * past_due branch (public/assets/js/pages/dashboard-supplier-module.js).
 *
 * A failed payment drops user.subscriptionTier to 'free' immediately (see
 * webhooks/stripeWebhookHandler.js handleInvoicePaymentFailed), so without a
 * dedicated branch the card fell through to the generic "Free Plan, upgrade
 * now" state — identical to a supplier who never subscribed, with no
 * indication their payment failed.
 *
 * This file (like the codebase's other tests for this un-modularised page
 * script — see lead-quality-filter-sort.test.js, action-prompt-admin.test.js)
 * asserts on the source directly rather than executing it in jsdom, since the
 * module has top-level side effects (a real fetch()) on import.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-module.js'),
  'utf8'
);

describe('dashboard subscription card — past_due state', () => {
  it('checks subscriptionRecord.status for past_due', () => {
    expect(src).toContain("subscriptionRecord?.status === 'past_due'");
  });

  it('renders a distinct past-due card, not the generic free-tier upsell', () => {
    expect(src).toContain('sd-subscription-past-due');
  });

  it('tells the supplier their payment failed rather than pitching an upgrade as if new', () => {
    const pastDueBlock = src.slice(
      src.indexOf("subscriptionRecord?.status === 'past_due'"),
      src.indexOf("subscriptionRecord?.status === 'past_due'") + 1500
    );
    expect(pastDueBlock).toMatch(/payment failed|didn't go through/i);
    expect(pastDueBlock).not.toContain('Upgrade to Pro');
  });

  it('offers a way to fix it — update payment method / manage billing', () => {
    const pastDueBlock = src.slice(
      src.indexOf("subscriptionRecord?.status === 'past_due'"),
      src.indexOf("subscriptionRecord?.status === 'past_due'") + 1500
    );
    expect(pastDueBlock).toContain('handleManageBillingClick');
  });

  it("checks past_due before the currentTier !== 'free' branch, so it is not shadowed", () => {
    const pastDueIdx = src.indexOf("subscriptionRecord?.status === 'past_due'");
    const activeTierIdx = src.indexOf("if (currentTier !== 'free')");
    expect(pastDueIdx).toBeGreaterThan(-1);
    expect(activeTierIdx).toBeGreaterThan(-1);
    expect(pastDueIdx).toBeLessThan(activeTierIdx);
  });

  it('returns early after rendering the past-due card so the free/active branches below do not also run', () => {
    const pastDueIdx = src.indexOf("subscriptionRecord?.status === 'past_due'");
    const activeTierIdx = src.indexOf("if (currentTier !== 'free')");
    const between = src.slice(pastDueIdx, activeTierIdx);
    expect(between).toContain('return;');
  });
});

describe('dashboard subscription card CSS — past-due state', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/css/supplier-dashboard-improvements.css'),
    'utf8'
  );

  it('defines styling for the past-due card', () => {
    expect(css).toContain('.sd-subscription-past-due');
  });
});
