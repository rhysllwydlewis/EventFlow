/**
 * Integration tests for POST /api/shortlist's href validation
 * (routes/shortlist.js) — the server-side gate that stops the shortlist
 * drawer from ever rendering a bare-id-guessed link like the legacy
 * `/supplier?id=` query form (see tests/unit/no-internal-supplier-query-links.test.js).
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockDb = {
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
};
jest.mock('../../db-unified', () => mockDb);

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'user-1', role: 'customer', email: 'customer@test.com' };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const express = require('express');

function buildApp() {
  const router = require('../../routes/shortlist');
  const app = express();
  app.use(express.json());
  app.use('/api/shortlist', router);
  return app;
}

describe('POST /api/shortlist — href validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.findOne.mockResolvedValue(null);
  });

  it('stores a canonical supplier profile href as-is', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
      href: '/supplier/test-supplier--0123456789abcdef',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBe('/supplier/test-supplier--0123456789abcdef');
  });

  it('stores a marketplace listing href as-is', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'listing',
      id: 'listing-1',
      name: 'Test Listing',
      href: '/marketplace?listing=listing-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBe('/marketplace?listing=listing-1');
  });

  it('rejects the legacy /supplier?id= query form and nulls the href', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
      href: '/supplier?id=sup-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBeNull();
  });

  it('rejects an absolute off-site URL and nulls the href', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
      href: 'https://evil.example.com',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBeNull();
  });

  it('rejects a protocol-relative URL and nulls the href', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
      href: '//evil.example.com/phish',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBeNull();
  });

  it('rejects path traversal and nulls the href', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
      href: '/supplier/../../etc/passwd',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBeNull();
  });

  it('stores null when no href is provided', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/shortlist').send({
      type: 'supplier',
      id: 'sup-1',
      name: 'Test Supplier',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.item.href).toBeNull();
  });
});
