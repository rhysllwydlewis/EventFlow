/**
 * Unit tests for new supplier endpoints:
 *   GET /performance-tips
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockDb = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
  read: jest.fn().mockResolvedValue([]),
};
jest.mock('../../db-unified', () => mockDb);

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    if (req.headers['x-test-user-role'] === 'none') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = {
      id: 'user-sup-1',
      role: req.headers['x-test-user-role'] || 'supplier',
      email: 'supplier@test.com',
    };
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

// Mock optional dependencies used in supplier.js
jest.mock(
  '../../utils/supplierAnalytics',
  () => ({
    EVENT_TYPES: { PROFILE_VIEW: 'profile_view', ENQUIRY_SENT: 'enquiry_sent' },
    getSupplierAnalytics: jest.fn().mockResolvedValue({
      totalViews: 42,
      totalEnquiries: 8,
      responseRate: 95,
      avgResponseTime: 2.5,
      dailyData: [],
    }),
  }),
  { virtual: true }
);

const SUPPLIER_DOC = {
  id: 'sup-1',
  ownerUserId: 'user-sup-1',
  name: 'Test Supplier',
  category: 'Photography',
  approved: true,
  availability: { status: 'available', blockedDates: [], notes: '' },
};

const request = require('supertest');
const express = require('express');

function buildApp() {
  // Only load the supplier router — prevents loading all of server.js
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/supplier', router);
  return app;
}

describe('availability endpoints (removed)', () => {
  // suppliers.availability was never shown to customers, so the dashboard card and these routes
  // were a control that did nothing.
  it.each(['get', 'patch'])('%s /api/v1/supplier/availability is not served', async method => {
    const app = buildApp();
    const res = await request(app)
      [method]('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier')
      .send({ status: 'limited' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/supplier/performance-tips', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.findOne.mockResolvedValue({
      ...SUPPLIER_DOC,
      description_short: '', // missing — should trigger tip
      photosGallery: [], // missing — should trigger tip
    });
    mockDb.find.mockResolvedValue([]);
  });

  it('returns 403 for non-suppliers', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(403);
  });

  it('returns an empty list for an incomplete profile: setup gaps are the checklist, not tips', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tips)).toBe(true);
    const shown = res.body.tips.map(tip => tip.id);
    [
      'write-description',
      'add-photos',
      'add-profile-photo',
      'add-location',
      'first-package',
    ].forEach(id => expect(shown).not.toContain(id));
  });

  it('returns tips with a title, body and icon when there is something specific to say', async () => {
    mockDb.findOne.mockResolvedValue({
      ...SUPPLIER_DOC,
      approved: false,
      verificationStatus: 'suspended',
    });
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    expect(res.body.tips.length).toBeGreaterThan(0);
    expect(res.body.tips[0]).toHaveProperty('title');
    expect(res.body.tips[0]).toHaveProperty('body');
    expect(res.body.tips[0]).toHaveProperty('icon');
  });

  it('returns max 4 tips', async () => {
    // Ensure findOne returns the incomplete supplier
    mockDb.findOne.mockResolvedValue({ ...SUPPLIER_DOC, description_short: '', photosGallery: [] });
    mockDb.find.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    expect(res.body.tips.length).toBeLessThanOrEqual(4);
  });

  it('returns fewer tips for a more complete profile', async () => {
    // A profile with description, photos, tagline, social links set
    mockDb.findOne.mockResolvedValue({
      ...SUPPLIER_DOC,
      description_short: 'A great photography studio with years of experience.',
      photosGallery: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
      tagline: 'Capturing memories',
      bannerUrl: 'https://example.com/banner.jpg',
      highlights: ['Award winning', 'Portfolio available'],
      startingPrice: '£500',
      socialLinks: { instagram: 'https://instagram.com/test' },
    });
    mockDb.find
      .mockResolvedValueOnce([{ id: 'pkg-1', supplierId: 'sup-1', approved: true }])
      .mockResolvedValueOnce([{ id: 'rev-1', rating: 5 }]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    // The things this profile already has are not asked for again. (The checklist still
    // wants a 100+ character description, a profile photo, etc., so some tips remain.)
    const shown = res.body.tips.map(tip => tip.id);
    expect(shown).not.toContain('add-photos');
    expect(shown).not.toContain('first-package');
    expect(shown).not.toContain('add-banner');
    expect(shown).not.toContain('add-social-links');
  });

  // Regression: this endpoint used to check only the canonical photosGallery
  // and socialLinks fields, so a supplier whose photos/social links were
  // only present under the legacy images/socials aliases (a mixed-schema
  // record) was wrongly nagged to add photos or social links they already
  // had. Mirrors the same alias-union logic already used by
  // profile-health-widget.js and dashboard-summary's healthScore.
  it('does not suggest adding photos when they exist only under the legacy images alias', async () => {
    mockDb.findOne.mockResolvedValue({
      ...SUPPLIER_DOC,
      description_short: 'A great photography studio with years of experience.',
      photosGallery: [],
      images: ['a.jpg', 'b.jpg', 'c.jpg'],
      tagline: 'Capturing memories',
      socialLinks: { instagram: 'https://instagram.com/test' },
    });
    mockDb.find.mockResolvedValue([{ id: 'pkg-1', supplierId: 'sup-1', approved: true }]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');

    expect(res.status).toBe(200);
    expect(res.body.tips.some(tip => tip.id === 'add-photos')).toBe(false);
  });

  it('does not suggest adding social links when they exist only under the legacy socials alias', async () => {
    mockDb.findOne.mockResolvedValue({
      ...SUPPLIER_DOC,
      description_short: 'A great photography studio with years of experience.',
      photosGallery: ['a.jpg', 'b.jpg', 'c.jpg'],
      tagline: 'Capturing memories',
      socialLinks: {},
      socials: { instagram: 'https://instagram.com/test' },
    });
    mockDb.find.mockResolvedValue([{ id: 'pkg-1', supplierId: 'sup-1', approved: true }]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');

    expect(res.status).toBe(200);
    expect(res.body.tips.some(tip => tip.id === 'add-social-links')).toBe(false);
  });
});
