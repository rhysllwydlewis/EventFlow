'use strict';

/**
 * The entitlement helpers behind the pricing page's paid claims.
 *
 * Every promise on /pricing that costs money is answered by one of these:
 * the photo allowance, the analytics history window, and the tier resolution
 * that decides who gets homepage placement. They previously had only
 * string-matching tests, which pass whether or not the function returns the
 * right answer — so these exercise the real behaviour, including the lapsed
 * and admin-granted cases where the wrong answer means either a paying
 * supplier is blocked or a lapsed one keeps a benefit forever.
 */

jest.mock('../../db-unified');

const dbUnified = require('../../db-unified');
const subscriptionService = require('../../services/subscriptionService');
const { supplierPlanTier } = require('../../utils/helpers');

const future = () => new Date(Date.now() + 30 * 86400000).toISOString();
const past = () => new Date(Date.now() - 30 * 86400000).toISOString();

/**
 * Point the data layer at one subscription and one user record.
 * @param {Object|null} subscription Subscription for the user, or null.
 * @param {Object|null} user User record, for the admin-granted fallback.
 * @returns {void} Nothing.
 */
function given({ subscription = null, user = null } = {}) {
  dbUnified.find.mockImplementation(async collection =>
    collection === 'subscriptions' && subscription ? [subscription] : []
  );
  dbUnified.findOne.mockImplementation(async collection => (collection === 'users' ? user : null));
}

const liveSub = plan => ({
  id: `sub-${plan}`,
  userId: 'usr-1',
  plan,
  status: 'active',
  stripeSubscriptionId: 'sub_stripe_1',
  currentPeriodEnd: future(),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('photo allowance', () => {
  it.each([
    ['free', 10],
    ['pro', 500],
    ['pro_plus', -1],
  ])('gives a live %s subscriber %s photos', async (plan, expected) => {
    given({ subscription: liveSub(plan) });
    await expect(subscriptionService.getPhotoAllowance('usr-1')).resolves.toBe(expected);
  });

  it('falls back to the free allowance when the user has no subscription', async () => {
    given();
    await expect(subscriptionService.getPhotoAllowance('usr-1')).resolves.toBe(10);
  });

  it('drops a lapsed Professional back to the free allowance', async () => {
    // Paid period ended and Stripe is not renewing: the supplier keeps their
    // photos but may not add more beyond the free cap.
    given({
      subscription: { ...liveSub('pro'), currentPeriodEnd: past() },
    });
    await expect(subscriptionService.getPhotoAllowance('usr-1')).resolves.toBe(10);
  });

  it('honours an unexpired admin-granted tier', async () => {
    given({ user: { id: 'usr-1', subscriptionTier: 'pro', proExpiresAt: future() } });
    await expect(subscriptionService.getPhotoAllowance('usr-1')).resolves.toBe(500);
  });

  it('ignores an expired admin-granted tier', async () => {
    given({ user: { id: 'usr-1', subscriptionTier: 'pro', proExpiresAt: past() } });
    await expect(subscriptionService.getPhotoAllowance('usr-1')).resolves.toBe(10);
  });
});

describe('analytics history window', () => {
  it.each([
    ['free', 7],
    ['pro', 90],
    ['pro_plus', 365],
  ])('gives a live %s subscriber %s days of history', async (plan, expected) => {
    given({ subscription: liveSub(plan) });
    await expect(subscriptionService.getAnalyticsWindowDays('usr-1')).resolves.toBe(expected);
  });

  it('clamps a longer request down to the plan window', async () => {
    // The route asks for min(requested, window); this pins the value that
    // arithmetic depends on, so widening the free window cannot happen by
    // accident.
    given({ subscription: liveSub('pro') });
    const windowDays = await subscriptionService.getAnalyticsWindowDays('usr-1');
    expect(Math.min(365, windowDays)).toBe(90);
    expect(Math.min(30, windowDays)).toBe(30);
  });
});

describe('numeric allowance resolution', () => {
  it('returns the caller fallback for a feature the matrix does not define', async () => {
    given({ subscription: liveSub('pro') });
    await expect(subscriptionService.getNumericAllowance('usr-1', 'notAFeature', 42)).resolves.toBe(
      42
    );
  });

  it('passes -1 through rather than translating it to a number', async () => {
    // Callers decide what unlimited means for them; a sentinel invented here
    // would silently become a real cap.
    given({ subscription: liveSub('pro_plus') });
    await expect(subscriptionService.getNumericAllowance('usr-1', 'maxPackages', 3)).resolves.toBe(
      -1
    );
  });
});

describe('supplier plan tier', () => {
  it('resolves the tier a live subscription entitles the supplier to', async () => {
    given({ subscription: liveSub('pro_plus') });
    await expect(supplierPlanTier('usr-1')).resolves.toBe('pro_plus');
  });

  it('does not promote Professional to Professional Plus', async () => {
    // Homepage placement is sold with Plus alone, so this boundary is the
    // whole point of the function.
    given({ subscription: liveSub('pro') });
    await expect(supplierPlanTier('usr-1')).resolves.toBe('pro');
  });

  it('treats a lapsed subscription as free', async () => {
    given({ subscription: { ...liveSub('pro_plus'), currentPeriodEnd: past() } });
    await expect(supplierPlanTier('usr-1')).resolves.toBe('free');
  });

  it('treats a cancelled-status subscription as free', async () => {
    given({ subscription: { ...liveSub('pro_plus'), status: 'past_due' } });
    await expect(supplierPlanTier('usr-1')).resolves.toBe('free');
  });

  it('accepts a supplier record and reads its owner', async () => {
    given({ subscription: liveSub('pro') });
    await expect(supplierPlanTier({ id: 'sup-1', ownerUserId: 'usr-1' })).resolves.toBe('pro');
  });

  it('returns free for a supplier with no owner', async () => {
    given();
    await expect(supplierPlanTier({ id: 'sup-1' })).resolves.toBe('free');
  });

  it('maps an unknown legacy plan name to free', async () => {
    given({ subscription: { ...liveSub('pro'), plan: 'enterprise' } });
    await expect(supplierPlanTier('usr-1')).resolves.toBe('free');
  });

  it('resolves an admin-granted pro_plus from the supplier document', async () => {
    given({ user: { id: 'usr-1' } });
    await expect(
      supplierPlanTier({
        id: 'sup-1',
        ownerUserId: 'usr-1',
        isPro: true,
        subscriptionTier: 'pro_plus',
        proExpiresAt: future(),
      })
    ).resolves.toBe('pro_plus');
  });

  it('returns free rather than throwing when the data layer fails', async () => {
    // A pricing benefit that crashes the request is worse than one that
    // quietly withholds itself.
    dbUnified.find.mockRejectedValue(new Error('database unavailable'));
    dbUnified.findOne.mockRejectedValue(new Error('database unavailable'));
    await expect(supplierPlanTier('usr-1')).resolves.toBe('free');
  });
});
