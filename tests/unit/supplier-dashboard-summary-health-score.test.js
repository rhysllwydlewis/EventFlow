/**
 * GET /api/v1/supplier/dashboard-summary — profile.healthScore
 *
 * healthScore mirrors ProfileHealthWidget's client-side weighted formula
 * (public/assets/js/components/profile-health-widget.js) so the "profile
 * health is low" dashboard alert agrees with the percentage the supplier
 * actually sees on their Profile Health card, rather than a separate,
 * disagreeing formula.
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
    req.user = { id: 'user-sup-1', role: 'supplier', email: 'supplier@test.com' };
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

const request = require('supertest');
const express = require('express');

function buildApp() {
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/supplier', router);
  return app;
}

const FULLY_COMPLETE_SUPPLIER = {
  id: 'sup-1',
  ownerUserId: 'user-sup-1',
  name: 'Complete Catering Co',
  logo: 'https://example.com/logo.png',
  description_long: 'x'.repeat(150),
  email: 'complete@example.com',
  phone: '01234 567890',
  location: 'Cardiff',
  postcode: 'CF10 1AA',
  bannerUrl: 'https://example.com/banner.jpg',
  photosGallery: ['a.jpg', 'b.jpg', 'c.jpg'],
  socialLinks: { instagram: 'https://instagram.com/x', facebook: 'https://facebook.com/x' },
  website: 'https://example.com',
  businessHours: { mon: '9-5' },
  faqs: ['q1', 'q2', 'q3'],
};

const EMPTY_SUPPLIER = {
  id: 'sup-2',
  ownerUserId: 'user-sup-1',
  name: 'Bare Profile',
};

describe('GET /api/v1/supplier/dashboard-summary — profile.healthScore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.read.mockResolvedValue([]);
  });

  it('scores a fully-complete profile at 100', async () => {
    mockDb.findOne.mockResolvedValue(FULLY_COMPLETE_SUPPLIER);
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.status).toBe(200);
    expect(res.body.profile.healthScore).toBe(100);
    expect(res.body.profile.completionFlags).toEqual({
      hasLogo: true,
      hasDescription: true,
      hasContact: true,
      hasLocation: true,
      hasCoverImage: true,
      hasGallery: true,
      hasSocialLinks: true,
      hasWebsite: true,
      hasBusinessHours: true,
      hasFaqs: true,
    });
  });

  it('scores a bare profile at 0', async () => {
    mockDb.findOne.mockResolvedValue(EMPTY_SUPPLIER);
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.status).toBe(200);
    expect(res.body.profile.healthScore).toBe(0);
  });

  it('requires both location and postcode for the location criterion', async () => {
    mockDb.findOne.mockResolvedValue({
      ...EMPTY_SUPPLIER,
      location: 'Cardiff',
      // postcode intentionally omitted
    });
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.body.profile.completionFlags.hasLocation).toBe(false);
    expect(res.body.profile.healthScore).toBe(0);
  });

  it('counts a legacy images array towards the gallery criterion (10 pts)', async () => {
    mockDb.findOne.mockResolvedValue({
      ...EMPTY_SUPPLIER,
      images: ['legacy-a.jpg', 'legacy-b.jpg', 'legacy-c.jpg'],
    });
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.body.profile.completionFlags.hasGallery).toBe(true);
    expect(res.body.profile.healthScore).toBe(10);
  });

  it('counts a legacy socials object towards the social-links criterion (10 pts)', async () => {
    mockDb.findOne.mockResolvedValue({
      ...EMPTY_SUPPLIER,
      socials: { twitter: 'https://twitter.com/x', tiktok: 'https://tiktok.com/@x' },
    });
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.body.profile.completionFlags.hasSocialLinks).toBe(true);
    expect(res.body.profile.healthScore).toBe(10);
  });

  it('requires 3+ FAQs for the FAQ criterion (15 pts, the highest single weight)', async () => {
    mockDb.findOne.mockResolvedValue({ ...EMPTY_SUPPLIER, faqs: ['only-one'] });
    const res = await request(buildApp()).get('/api/v1/supplier/dashboard-summary');

    expect(res.body.profile.completionFlags.hasFaqs).toBe(false);
    expect(res.body.profile.healthScore).toBe(0);
  });
});
