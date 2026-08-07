'use strict';

/**
 * Regression test: upgrading or downgrading a supplier subscription must send
 * a confirmation email. Previously neither routes/subscriptions-v2.js nor
 * services/subscriptionService.js ever called postmark for these two events —
 * every other billing lifecycle event (activation, cancellation, payment
 * failure, renewal reminder, trial ending) sent one, but plan changes were
 * silent even though subscription-upgraded.html and
 * subscription-downgrade-scheduled.html were already fully built templates.
 */

const mockSendMail = jest.fn(async () => ({}));

jest.mock('../../utils/postmark', () => ({
  sendMail: (...args) => mockSendMail(...args),
  FROM_BILLING: 'billing@event-flow.co.uk',
}));

let mockSubscriptions = {};
let mockUsers = [];

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(async (collection, filter) => {
    // Return a copy, not the stored reference — a real DB read never hands
    // back a live-mutable object shared with what a later write touches.
    if (collection === 'subscriptions' && mockSubscriptions[filter.id]) {
      return { ...mockSubscriptions[filter.id] };
    }
    return null;
  }),
  updateOne: jest.fn(async (collection, filter, update) => {
    if (collection === 'subscriptions' && mockSubscriptions[filter.id]) {
      Object.assign(mockSubscriptions[filter.id], update.$set);
    }
    return true;
  }),
  find: jest.fn(async () => []),
  read: jest.fn(async collection => (collection === 'users' ? mockUsers : [])),
}));

const subscriptionService = require('../../services/subscriptionService');

describe('Subscription plan-change confirmation emails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsers = [{ id: 'user-1', email: 'supplier@example.com', name: 'Amelia Clarke' }];
    mockSubscriptions = {
      'sub-1': {
        id: 'sub-1',
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        currentPeriodEnd: '2026-04-12T00:00:00.000Z',
      },
    };
  });

  it('upgradeSubscription sends a subscription-upgraded email', async () => {
    await subscriptionService.upgradeSubscription('sub-1', 'pro_plus', { skipStripe: true });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('supplier@example.com');
    expect(call.template).toBe('subscription-upgraded');
    expect(call.templateData.previousPlan).toBe('Professional');
    expect(call.templateData.newPlan).toBe('Professional Plus');
    expect(call.templateData.amount).not.toMatch(/£/); // template adds its own £
  });

  it('downgradeSubscription sends a subscription-downgrade-scheduled email', async () => {
    await subscriptionService.downgradeSubscription('sub-1', 'free', { skipStripe: true });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('supplier@example.com');
    expect(call.template).toBe('subscription-downgrade-scheduled');
    expect(call.templateData.currentPlan).toBe('Professional');
    expect(call.templateData.newPlan).toBe('Free');
    expect(call.templateData.effectiveDate).toContain('2026');
  });

  it('a failed email send does not block the plan change itself', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('postmark down'));

    const result = await subscriptionService.upgradeSubscription('sub-1', 'pro_plus', {
      skipStripe: true,
    });

    expect(result.plan).toBe('pro_plus');
  });
});
