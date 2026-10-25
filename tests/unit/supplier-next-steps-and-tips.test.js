'use strict';

/**
 * Next-steps milestone logic (pure). The tips have their own file: supplier-tips.test.js.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'user-1', role: 'supplier' };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const { evaluateNextSteps, hasBusinessDetails } = require('../../services/supplierNextSteps');
const { computeProfileCompleteness } = require('../../services/supplierProfileCompleteness');

const COMPLETE_SUPPLIER = {
  id: 'sup-1',
  name: 'Moor Audio',
  category: 'Entertainment',
  email: 'hello@moor.example',
  phone: '01234 567890',
  location: 'Cardiff',
  basePostcode: 'CF10 1AA',
  logo: 'l.png',
  description_long: 'x'.repeat(120),
  bannerUrl: 'b.jpg',
  photosGallery: ['a', 'b', 'c'],
  socialLinks: { instagram: 'i', facebook: 'f' },
  website: 'https://moor.example',
};

/**
 * Evaluate steps with sensible defaults overridden per test.
 *
 * @param {Object} overrides - Input overrides
 * @returns {Object} next steps
 */
function steps(overrides = {}) {
  const supplier = overrides.supplier || COMPLETE_SUPPLIER;
  return evaluateNextSteps({
    supplier,
    verification: {
      emailVerified: true,
      approved: true,
      status: 'approved',
      rejectionCount: 0,
      ...overrides.verification,
    },
    completeness: computeProfileCompleteness(supplier),
    packages: { total: 2, withoutPhoto: 0 },
    reviewRequestsSent: 1,
    approvedReviewCount: 1,
    hasCalendarActivity: true,
    ...overrides.rest,
  });
}

/**
 * Look up one step.
 *
 * @param {Object} result - evaluateNextSteps result
 * @param {string} id - Step id
 * @returns {Object} step
 */
function step(result, id) {
  return result.steps.find(item => item.id === id);
}

describe('evaluateNextSteps', () => {
  it('is 100% with nothing left to do and no primary action', () => {
    const result = steps();

    expect(result.completed).toBe(result.total);
    expect(result.percent).toBe(100);
    expect(result.primaryStepId).toBeNull();
    expect(result.steps.every(item => !item.locked)).toBe(true);
  });

  it('holds back a step whose record could not be read instead of guessing a zero', () => {
    const result = steps({
      rest: {
        packages: null,
        reviewRequestsSent: null,
        approvedReviewCount: null,
        hasCalendarActivity: null,
      },
    });

    ['first-package', 'package-photos', 'request-review', 'calendar'].forEach(id => {
      expect(step(result, id)).toMatchObject({
        done: false,
        locked: true,
        lockedReason: 'We could not check this just now',
      });
    });
    expect(result.primaryStepId).not.toBe('first-package');
  });

  it('still counts a review request as done when only one of the two sources could be read', () => {
    expect(
      step(steps({ rest: { reviewRequestsSent: null, approvedReviewCount: 2 } }), 'request-review')
    ).toMatchObject({ done: true, locked: false });
    expect(
      step(steps({ rest: { reviewRequestsSent: 0, approvedReviewCount: null } }), 'request-review')
    ).toMatchObject({ done: false, locked: true });
  });

  it('numbers priorities from 1 in list order', () => {
    expect(steps().steps.map(item => item.priority)).toEqual(
      steps().steps.map((item, index) => index + 1)
    );
  });

  it('makes the first open, unlocked step the primary action', () => {
    const result = steps({ supplier: { ...COMPLETE_SUPPLIER, bannerUrl: '' } });

    expect(result.primaryStepId).toBe('banner');
    expect(step(result, 'banner')).toMatchObject({ done: false, locked: false });
  });

  it('shows steps that need a verified email as locked, with the reason', () => {
    const result = steps({
      supplier: {},
      verification: { emailVerified: false, approved: false, status: 'unverified' },
      rest: {
        packages: { total: 0, withoutPhoto: 0 },
        reviewRequestsSent: 0,
        approvedReviewCount: 0,
        hasCalendarActivity: false,
      },
    });

    expect(result.primaryStepId).toBe('verify-email');
    [
      'business-details',
      'profile-photo',
      'gallery',
      'first-package',
      'request-review',
      'calendar',
    ].forEach(id => {
      expect(step(result, id)).toMatchObject({
        done: false,
        locked: true,
        lockedReason: expect.stringMatching(/email/i),
      });
    });
  });

  it('locks package and review steps until the supplier is approved, but not profile editing', () => {
    const result = steps({
      supplier: { ...COMPLETE_SUPPLIER, bannerUrl: '' },
      verification: { approved: false, status: 'unverified' },
      rest: {
        packages: { total: 0, withoutPhoto: 0 },
        reviewRequestsSent: 0,
        approvedReviewCount: 0,
      },
    });

    expect(step(result, 'first-package')).toMatchObject({
      locked: true,
      lockedReason: 'Available once your profile is approved',
    });
    expect(step(result, 'request-review').locked).toBe(true);
    expect(step(result, 'banner').locked).toBe(false);
    expect(step(result, 'get-verified')).toMatchObject({ done: false, locked: false });
  });

  it('does not lock steps when the email status is unknown (lookup failed), only the email step', () => {
    const result = steps({
      verification: { emailVerified: null },
      supplier: { ...COMPLETE_SUPPLIER, bannerUrl: '' },
    });

    expect(step(result, 'verify-email')).toMatchObject({ done: false, locked: true });
    expect(result.steps.filter(item => item.locked).map(item => item.id)).toEqual(['verify-email']);
    expect(result.primaryStepId).toBe('banner');
  });

  it('locks the verification step while in review, suspended or out of attempts', () => {
    const pending = steps({ verification: { approved: false, status: 'pending_review' } });
    const suspended = steps({ verification: { approved: false, status: 'suspended' } });
    const exhausted = steps({
      verification: { approved: false, status: 'rejected', rejectionCount: 5 },
    });

    expect(step(pending, 'get-verified')).toMatchObject({ done: false, locked: true });
    expect(step(suspended, 'get-verified').lockedReason).toMatch(/suspended/);
    expect(step(exhausted, 'get-verified').lockedReason).toMatch(/attempts/);
  });

  it('allows resubmission after changes were requested', () => {
    const result = steps({ verification: { approved: false, status: 'needs_changes' } });

    expect(step(result, 'get-verified')).toMatchObject({ done: false, locked: false });
  });

  it('only marks "photo on every package" done when there are packages and all have photos', () => {
    expect(
      step(steps({ rest: { packages: { total: 0, withoutPhoto: 0 } } }), 'package-photos')
    ).toMatchObject({
      done: false,
      locked: true,
      lockedReason: 'Create a package first',
    });
    expect(
      step(steps({ rest: { packages: { total: 2, withoutPhoto: 1 } } }), 'package-photos').done
    ).toBe(false);
    expect(
      step(steps({ rest: { packages: { total: 2, withoutPhoto: 0 } } }), 'package-photos').done
    ).toBe(true);
  });

  it('treats an approved review as proof the review step is done even with no request record', () => {
    const result = steps({ rest: { reviewRequestsSent: 0, approvedReviewCount: 2 } });

    expect(step(result, 'request-review').done).toBe(true);
  });

  it('lists 13 milestones for a supplier who has done nothing', () => {
    const result = steps({ supplier: {} });

    expect(result.total).toBe(13);
    expect(result.completed).toBeLessThan(result.total);
  });
});

describe('hasBusinessDetails', () => {
  it('needs name, a real category, location, postcode, phone and email', () => {
    expect(hasBusinessDetails(COMPLETE_SUPPLIER)).toBe(true);
    ['name', 'category', 'location', 'basePostcode', 'phone', 'email'].forEach(field => {
      expect(hasBusinessDetails({ ...COMPLETE_SUPPLIER, [field]: '  ' })).toBe(false);
    });
  });

  it('accepts the catch-all "Other" category, as the verification form does', () => {
    expect(hasBusinessDetails({ ...COMPLETE_SUPPLIER, category: 'Other' })).toBe(true);
  });

  it('an approved supplier in category Other is not stuck on business details forever', () => {
    const supplier = { ...COMPLETE_SUPPLIER, category: 'Other', bannerUrl: '' };
    const result = steps({ supplier });

    expect(step(result, 'business-details').done).toBe(true);
    expect(result.primaryStepId).toBe('banner');
  });

  it('accepts a Venues postcode', () => {
    const venue = { ...COMPLETE_SUPPLIER, basePostcode: '', venuePostcode: 'CF10 1AA' };
    expect(hasBusinessDetails(venue)).toBe(true);
  });
});
