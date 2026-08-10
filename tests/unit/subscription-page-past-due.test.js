/**
 * Source-level regression test for the /supplier/subscription page's
 * past_due banner (public/supplier/js/subscription.js renderDowngradeBanner).
 *
 * A failed payment drops entitlement to free immediately, so without this
 * banner the page showed the plan cards with no current plan highlighted and
 * no indication the supplier lost access because a card was declined rather
 * than by choice.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(process.cwd(), 'public/supplier/js/subscription.js'), 'utf8');

describe('/supplier/subscription page — past_due banner', () => {
  it('checks currentSubscription.status for past_due', () => {
    expect(src).toContain("currentSubscription?.status === 'past_due'");
  });

  it('renders a distinct danger banner', () => {
    expect(src).toContain('pricing-account-banner--danger');
  });

  it('tells the supplier their payment failed', () => {
    const idx = src.indexOf("currentSubscription?.status === 'past_due'");
    const block = src.slice(idx, idx + 800);
    expect(block).toMatch(/payment failed|didn't go through/i);
  });

  it('checks past_due before falling through to the pendingPlan/downgrade banner logic', () => {
    const pastDueIdx = src.indexOf("currentSubscription?.status === 'past_due'");
    const pendingPlanIdx = src.indexOf('const pendingPlan = currentSubscription?.pendingPlan;');
    expect(pastDueIdx).toBeGreaterThan(-1);
    expect(pendingPlanIdx).toBeGreaterThan(-1);
    expect(pastDueIdx).toBeLessThan(pendingPlanIdx);
  });

  it('returns after rendering the past-due banner so the downgrade-banner logic below does not also run', () => {
    const pastDueIdx = src.indexOf("currentSubscription?.status === 'past_due'");
    const pendingPlanIdx = src.indexOf('const pendingPlan = currentSubscription?.pendingPlan;');
    const between = src.slice(pastDueIdx, pendingPlanIdx);
    expect(between).toContain('return;');
  });
});

describe('/supplier/subscription page CSS — past-due banner', () => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'public/supplier/css/subscription-account.css'),
    'utf8'
  );

  it('defines the danger banner modifier', () => {
    expect(css).toContain('.pricing-account-banner--danger');
  });
});
