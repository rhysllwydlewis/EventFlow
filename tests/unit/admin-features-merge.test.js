'use strict';

/**
 * Regression test for the PUT /api/admin/settings/features overwrite bug.
 *
 * Several admin pages (Reviews, Photos, Suppliers) each PUT only their own
 * single feature flag to this endpoint — e.g. admin-reviews-init.js sends
 * only { autoApproveReviews }. The Admin Settings page's "Save Feature
 * Flags" button sends only the 11 flags it renders, omitting
 * photoAutoApprove / autoApproveReviews / autoApproveSupplierVerification.
 *
 * Before the fix, the handler built `newFeatures` purely from the request
 * body and assigned it wholesale to `settings.features`, so any partial
 * save silently reset every flag it didn't mention back to hardcoded
 * defaults. This test exercises the real route handler end-to-end and
 * asserts a partial update preserves unrelated flags.
 */

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    return next();
  },
  roleRequired: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (_req, _res, next) => next();
  return new Proxy(
    {},
    {
      get: () => passthrough,
    }
  );
});

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn(),
  AUDIT_ACTIONS: {},
}));

let mockStoredSettings = {};

const mockFind = jest.fn(async () => []);
const mockUpdateOne = jest.fn(async () => true);

jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'settings' ? mockStoredSettings : {})),
  writeAndVerify: jest.fn(async (collection, data) => {
    if (collection === 'settings') {
      mockStoredSettings = data;
    }
    return { success: true, verified: true, data };
  }),
  write: jest.fn(async () => true),
  find: (...args) => mockFind(...args),
  updateOne: (...args) => mockUpdateOne(...args),
  getDatabaseStatus: jest.fn(() => ({ state: 'completed', type: 'local', connected: true })),
  getQueryMetrics: jest.fn(() => ({ totalQueries: 0, avgQueryTime: 0, slowQueries: 0 })),
}));

const express = require('express');
const request = require('supertest');

function buildApp() {
  const adminRoutes = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('PUT /api/admin/settings/features — partial-update merge behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSettings = {
      features: {
        registration: false, // an admin deliberately disabled this
        supplierApplications: true,
        reviews: true,
        photoUploads: true,
        supportTickets: true,
        pexelsCollage: false,
        requirePackageApproval: true, // also deliberately enabled
        requirePublicCalendarApproval: false,
        photoAutoApprove: false, // deliberately turned off from the Photos page
        autoApproveReviews: false, // deliberately turned off from the Reviews page
        autoApproveSupplierVerification: true, // deliberately turned on from the Suppliers page
        marketplaceAvailability: false,
        quoteBooking: false,
        bookingPayments: false,
      },
    };
  });

  it('does not reset flags omitted by a single-flag save from another admin page', async () => {
    const app = buildApp();

    // Simulates admin-reviews-init.js: PUT only the one flag it owns.
    const res = await request(app)
      .put('/api/admin/settings/features')
      .send({ autoApproveReviews: true });

    expect(res.status).toBe(200);
    const saved = mockStoredSettings.features;

    // The flag that was actually sent should change.
    expect(saved.autoApproveReviews).toBe(true);

    // Everything else — set by other pages/admins — must survive untouched.
    expect(saved.registration).toBe(false);
    expect(saved.requirePackageApproval).toBe(true);
    expect(saved.photoAutoApprove).toBe(false);
    expect(saved.autoApproveSupplierVerification).toBe(true);
  });

  it('does not reset photoAutoApprove/autoApproveReviews/autoApproveSupplierVerification when Admin Settings saves its own 11 flags', async () => {
    const app = buildApp();

    // Simulates the Save Feature Flags button on /admin-settings, which
    // never sends these three cross-page-owned flags.
    const res = await request(app).put('/api/admin/settings/features').send({
      registration: true,
      supplierApplications: true,
      reviews: true,
      photoUploads: true,
      supportTickets: true,
      pexelsCollage: false,
      requirePackageApproval: true,
      requirePublicCalendarApproval: false,
      marketplaceAvailability: false,
      quoteBooking: false,
      bookingPayments: false,
    });

    expect(res.status).toBe(200);
    const saved = mockStoredSettings.features;

    expect(saved.registration).toBe(true);
    // These three must retain their previously-stored values, not fall back
    // to hardcoded defaults just because this request didn't mention them.
    expect(saved.photoAutoApprove).toBe(false);
    expect(saved.autoApproveReviews).toBe(false);
    expect(saved.autoApproveSupplierVerification).toBe(true);
  });

  it('only runs the bulk supplier auto-approve migration on the false→true transition, not on every save that merely preserves an already-true flag', async () => {
    const app = buildApp();

    // autoApproveSupplierVerification is already true in stored settings
    // (see beforeEach) and this request doesn't touch it — merge() will
    // keep it true, but that must not be treated as a fresh "enable".
    await request(app).put('/api/admin/settings/features').send({ registration: true });
    expect(mockFind).not.toHaveBeenCalled();

    // A real transition (false → true) should still trigger the migration.
    mockStoredSettings.features.autoApproveSupplierVerification = false;
    await request(app)
      .put('/api/admin/settings/features')
      .send({ autoApproveSupplierVerification: true });
    expect(mockFind).toHaveBeenCalledWith('suppliers', expect.any(Object));
  });
});
