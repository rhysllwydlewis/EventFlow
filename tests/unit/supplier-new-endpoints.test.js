/**
 * Unit tests for new supplier endpoints:
 *   GET/PATCH /availability
 *   POST /request-review
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

describe('GET /api/v1/supplier/availability', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.findOne.mockResolvedValue(SUPPLIER_DOC);
  });

  it('returns 403 for non-supplier roles', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/availability')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(403);
  });

  it('returns 404 when no supplier profile found', async () => {
    mockDb.findOne.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(404);
  });

  it('returns availability for valid supplier', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('availability');
    expect(res.body.availability.status).toBe('available');
  });
});

describe('PATCH /api/v1/supplier/availability', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.findOne.mockResolvedValue(SUPPLIER_DOC);
    mockDb.updateOne.mockResolvedValue({ modified: 1 });
  });

  it('rejects invalid status values', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier')
      .send({ status: 'invalid-status' });
    expect(res.status).toBe(400);
  });

  it('updates availability status', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier')
      .send({ status: 'limited', notes: 'Limited in December' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.availability.status).toBe('limited');
    expect(mockDb.updateOne).toHaveBeenCalledTimes(1);
  });

  it('accepts "unavailable" status', async () => {
    const app = buildApp();
    const res = await request(app)
      .patch('/api/v1/supplier/availability')
      .set('x-test-user-role', 'supplier')
      .send({ status: 'unavailable' });
    expect(res.status).toBe(200);
    expect(res.body.availability.status).toBe('unavailable');
  });
});

describe('POST /api/v1/supplier/request-review', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.insertOne.mockResolvedValue({});
    // Default: supplier found, no existing review request
    mockDb.findOne.mockResolvedValueOnce(SUPPLIER_DOC).mockResolvedValueOnce(null);
  });

  it('returns 400 for missing email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/supplier/request-review')
      .set('x-test-user-role', 'supplier')
      .send({ customerName: 'Alice' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    // Reset and provide fresh supplier mock
    mockDb.findOne.mockResolvedValueOnce(SUPPLIER_DOC);
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/supplier/request-review')
      .set('x-test-user-role', 'supplier')
      .send({ customerEmail: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('creates review request successfully', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/supplier/request-review')
      .set('x-test-user-role', 'supplier')
      .send({ customerEmail: 'alice@example.com', customerName: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockDb.insertOne).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when request already sent', async () => {
    // Override: findOne returns supplier then existing request
    mockDb.findOne.mockReset();
    mockDb.findOne
      .mockResolvedValueOnce(SUPPLIER_DOC)
      .mockResolvedValueOnce({ id: 'rreq-existing', customerEmail: 'alice@example.com' });
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/supplier/request-review')
      .set('x-test-user-role', 'supplier')
      .send({ customerEmail: 'alice@example.com' });
    expect(res.status).toBe(409);
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

  it('returns array of tips for incomplete profile', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tips)).toBe(true);
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
    // All major tips resolved — expect very few or none
    expect(res.body.tips.length).toBeLessThanOrEqual(1);
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
    expect(res.body.tips.some(tip => tip.id === 'social-links')).toBe(false);
  });
});
