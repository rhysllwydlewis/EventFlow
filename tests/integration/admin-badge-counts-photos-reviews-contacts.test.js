/**
 * GET /api/admin/badge-counts — real endpoint test for the photos, reviews,
 * and external-contacts counts, which were fixed to match what their
 * respective admin pages actually list (see PR: admin notification/badge
 * discrepancy fixes).
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

let mockReadByCollection = {};
let mockCountByCollectionAndFilter = null;

jest.mock('../../db-unified', () => ({
  count: jest.fn(async (collection, filter) => {
    if (mockCountByCollectionAndFilter) {
      const value = mockCountByCollectionAndFilter(collection, filter);
      if (value !== undefined) {
        return value;
      }
    }
    return 0;
  }),
  read: jest.fn(async collection => mockReadByCollection[collection] || []),
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

describe('GET /api/admin/badge-counts — photos', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockReadByCollection = {};
    mockCountByCollectionAndFilter = null;
  });

  it('mirrors GET /api/admin/photos/pending: returns 0 when photoAutoApprove is on (default)', async () => {
    mockReadByCollection = {
      settings: { features: {} },
      photos: [{ id: 'p1', status: 'pending' }],
    };

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.photos).toBe(0);
  });

  it('counts pending photos from the photos collection once auto-approve is disabled', async () => {
    mockReadByCollection = {
      settings: { features: { photoAutoApprove: false } },
      photos: [
        { id: 'p1', status: 'pending' },
        { id: 'p2', status: 'pending' },
        { id: 'p3', status: 'approved' },
      ],
    };

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.photos).toBe(2);
  });
});

describe('GET /api/admin/badge-counts — reviews', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockReadByCollection = {};
    mockCountByCollectionAndFilter = null;
  });

  it('queries reviews with the same flagged && !approved filter the moderation page uses', async () => {
    mockCountByCollectionAndFilter = (collection, filter) => {
      if (collection === 'reviews' && filter && filter.flagged === true) {
        expect(filter.approved).toEqual({ $ne: true });
        return 5;
      }
    };

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.reviews).toBe(5);
  });
});

describe('GET /api/admin/badge-counts — external contacts', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockReadByCollection = {};
    mockCountByCollectionAndFilter = null;
  });

  it('counts new external_contacts entries, matching the External Contacts admin page default filter', async () => {
    mockCountByCollectionAndFilter = (collection, filter) => {
      if (collection === 'external_contacts') {
        expect(filter).toEqual({ status: 'new' });
        return 3;
      }
    };

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(200);
    expect(res.body.pending.externalContacts).toBe(3);
  });

  it('returns 0 externalContacts on the error-fallback path', async () => {
    const dbUnified = require('../../db-unified');
    dbUnified.read.mockImplementationOnce(async () => {
      throw new Error('db unavailable');
    });

    const res = await request(app).get('/api/admin/badge-counts');

    expect(res.status).toBe(500);
    expect(res.body.pending.externalContacts).toBe(0);
  });
});
