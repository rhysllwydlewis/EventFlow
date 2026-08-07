/**
 * GET /api/admin/badge-counts — real endpoint test.
 *
 * tests/integration/admin-badge-counts.test.js only checks the route source
 * text; this file actually calls the handler through supertest, including
 * the locations-needing-review count (services/locationAutoPublish.service.js
 * publishes cities with no human approval step, and this endpoint is how the
 * admin nav badge learns how many of those are still unreviewed).
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {},
}));

let mockLocationPageRows = [];

jest.mock('../../db-unified', () => ({
  count: jest.fn(async () => 0),
  read: jest.fn(async collection => {
    if (collection === 'location_pages') {
      return mockLocationPageRows;
    }
    return [];
  }),
  write: jest.fn(async () => undefined),
  findWithOptions: jest.fn(async () => []),
  getDatabaseType: jest.fn(() => 'local'),
}));

const adminRoutes = require('../../routes/admin');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('GET /api/admin/badge-counts — locations needing review', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockLocationPageRows = [];
  });

  it('counts auto-published cities never reviewed by a human', async () => {
    mockLocationPageRows = [
      { locationSlug: 'cardiff', managedBy: 'automation', lastReviewedAt: null },
      { locationSlug: 'swansea', managedBy: 'automation', lastReviewedAt: '2026-01-01T00:00:00Z' },
      { locationSlug: 'newport', managedBy: 'admin', lastReviewedAt: null },
    ];

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.locations).toBe(1);
  });

  it('returns zero when nothing is pending review', async () => {
    mockLocationPageRows = [
      { locationSlug: 'cardiff', managedBy: 'admin', lastReviewedAt: null },
      { locationSlug: 'swansea', managedBy: 'automation', lastReviewedAt: '2026-01-01T00:00:00Z' },
    ];

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.locations).toBe(0);
  });

  it('returns zero rather than crashing when location records cannot be read', async () => {
    const dbUnified = require('../../db-unified');
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'location_pages') {
        throw new Error('db unavailable');
      }
      return [];
    });

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.locations).toBe(0);
  });
});
