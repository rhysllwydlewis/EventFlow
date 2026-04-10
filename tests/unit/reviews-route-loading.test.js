/**
 * Unit test for reviews route loading
 * Verifies that the routes/reviews.js module can be required without errors
 * This test specifically checks for the bug where roleRequired('admin') was
 * being called at require time instead of request time.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const reviewsSrc = fs.readFileSync(path.join(process.cwd(), 'routes/reviews.js'), 'utf8');

describe('Reviews Routes Loading', () => {
  it('should load routes/reviews.js without TypeError', () => {
    // This will throw if there's a require-time error like "roleRequired is not a function"
    expect(() => {
      const reviewsRoutes = require('../../routes/reviews');
      expect(reviewsRoutes).toBeDefined();
      expect(typeof reviewsRoutes).toBe('function'); // It's an Express router
      expect(typeof reviewsRoutes.initializeDependencies).toBe('function');
    }).not.toThrow();
  });

  it('should have initializeDependencies function exported', () => {
    const reviewsRoutes = require('../../routes/reviews');
    expect(reviewsRoutes.initializeDependencies).toBeDefined();
    expect(typeof reviewsRoutes.initializeDependencies).toBe('function');
  });

  it('should be able to initialize dependencies without error', () => {
    const reviewsRoutes = require('../../routes/reviews');

    // Mock dependencies
    const mockDeps = {
      dbUnified: {},
      authRequired: jest.fn((req, res, next) => next()),
      roleRequired: jest.fn(_role => (req, res, next) => next()),
      requireVerifiedUser: jest.fn((req, res, next) => next()),
      featureRequired: jest.fn(_feature => (req, res, next) => next()),
      csrfProtection: jest.fn((req, res, next) => next()),
      reviewsSystem: {
        moderateReview: jest.fn(),
      },
    };

    expect(() => {
      reviewsRoutes.initializeDependencies(mockDeps);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Source-level checks for review notification wiring
// ---------------------------------------------------------------------------

describe('Reviews Routes — Notification wiring (source-level)', () => {
  it('imports notification.service.js (not the legacy wrapper)', () => {
    expect(reviewsSrc).toContain("require('../services/notification.service')");
    expect(reviewsSrc).not.toContain("require('../services/notificationService')");
  });

  it('has a sendReviewNotification fire-and-forget helper', () => {
    expect(reviewsSrc).toContain('function sendReviewNotification(');
  });

  it('calls notifyNewReview inside sendReviewNotification', () => {
    const fnStart = reviewsSrc.indexOf('function sendReviewNotification(');
    const fnEnd = reviewsSrc.indexOf('\n}', fnStart) + 2;
    const fnBody = reviewsSrc.slice(fnStart, fnEnd);
    expect(fnBody).toContain('notifyNewReview');
  });

  it('calls sendReviewNotification after successful review creation in the primary endpoint', () => {
    // The primary endpoint handles POST /api/suppliers/:supplierId/reviews
    const primaryStart = reviewsSrc.indexOf("'/suppliers/:supplierId/reviews'");
    const primaryEnd = reviewsSrc.indexOf('\n);', primaryStart) + 3;
    const primaryBody = reviewsSrc.slice(primaryStart, primaryEnd);
    expect(primaryBody).toContain('sendReviewNotification');
    expect(primaryBody).toContain('supplier.ownerUserId');
  });

  it('calls sendReviewNotification after successful review creation in the legacy endpoint', () => {
    // The legacy endpoint handles POST /api/reviews
    const legacyStart = reviewsSrc.indexOf("'/reviews'");
    const legacyEnd = reviewsSrc.indexOf('\n);', legacyStart) + 3;
    const legacyBody = reviewsSrc.slice(legacyStart, legacyEnd);
    expect(legacyBody).toContain('sendReviewNotification');
    expect(legacyBody).toContain('supplier.ownerUserId');
  });

  it('guards the notification call on ownerUserId being present', () => {
    // Both endpoints should check if (supplier.ownerUserId) before notifying
    const occurrences = (reviewsSrc.match(/if \(supplier\.ownerUserId\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
