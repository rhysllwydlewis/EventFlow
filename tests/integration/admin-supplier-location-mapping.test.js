/**
 * PATCH /api/v2/admin/suppliers/:id/location-mapping
 *
 * This endpoint confirms the registry city a supplier's free-text location
 * maps to — the human-review counterpart to scripts/audit-supplier-locations.js,
 * which only ever auto-writes its "high_confidence" rows and leaves anything
 * ambiguous for a person to confirm one at a time.
 */

const request = require('supertest');
const express = require('express');

const mockAuthState = { user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' } };
const mockSuppliers = [];
const mockAuditLogs = [];

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = mockAuthState.user;
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../utils/auditTrail', () => ({
  createAuditLog: jest.fn(async entry => {
    mockAuditLogs.push(entry);
  }),
  queryAuditLogs: jest.fn(async () => []),
  getAuditLogById: jest.fn(async () => null),
  getUserAuditLogs: jest.fn(async () => []),
  getAuditStatistics: jest.fn(async () => ({})),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(async () => []),
  findOne: jest.fn(async (collection, filter) => {
    if (collection !== 'suppliers') {
      return null;
    }
    return mockSuppliers.find(row => row.id === filter.id) || null;
  }),
  updateOne: jest.fn(async (collection, filter, updates) => {
    if (collection !== 'suppliers') {
      return false;
    }
    const supplier = mockSuppliers.find(row => row.id === filter.id);
    if (!supplier) {
      return false;
    }
    Object.assign(supplier, updates.$set || updates);
    return true;
  }),
}));

const adminV2Routes = require('../../routes/admin-v2');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v2/admin', adminV2Routes);
  return app;
}

describe('PATCH /api/v2/admin/suppliers/:id/location-mapping', () => {
  beforeEach(() => {
    mockSuppliers.length = 0;
    mockAuditLogs.length = 0;
    mockAuthState.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    mockSuppliers.push({
      id: 'sup-tramshed',
      name: 'TramShed Cardiff',
      category: 'Venues',
      location: 'Tramshed, Clare Rd, Cardiff CF11 6QP',
    });
  });

  it('writes a structured baseLocation for a valid registry city slug', async () => {
    const app = buildApp();

    const res = await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.baseLocation.citySlug).toBe('cardiff');
    expect(res.body.data.baseLocation.source).toBe('admin_verified');
    expect(res.body.data.baseLocation.confidence).toBe('high');
  });

  it('never modifies the legacy location string', async () => {
    const app = buildApp();
    const originalLocation = mockSuppliers[0].location;

    await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(mockSuppliers[0].location).toBe(originalLocation);
  });

  it('clears locationMappingReviewRequired on a confirmed mapping', async () => {
    mockSuppliers[0].locationMappingReviewRequired = true;
    const app = buildApp();

    await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(mockSuppliers[0].locationMappingReviewRequired).toBe(false);
  });

  it('records an audit log entry for the mapping decision', async () => {
    const app = buildApp();

    await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(mockAuditLogs).toHaveLength(1);
    expect(mockAuditLogs[0].action).toBe('SUPPLIER_LOCATION_MAPPED');
    expect(mockAuditLogs[0].resource).toEqual({ type: 'supplier', id: 'sup-tramshed' });
  });

  it('rejects a city slug that does not exist in the registry', async () => {
    const app = buildApp();

    const res = await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'not-a-real-city' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CITY_SLUG');
  });

  it('rejects a missing citySlug', async () => {
    const app = buildApp();

    const res = await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CITY_SLUG');
  });

  it('returns 404 for an unknown supplier', async () => {
    const app = buildApp();

    const res = await request(app)
      .patch('/api/v2/admin/suppliers/does-not-exist/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SUPPLIER_NOT_FOUND');
  });

  it('requires the SUPPLIERS_UPDATE permission', async () => {
    mockAuthState.user = {
      id: 'limited-1',
      email: 'limited@example.com',
      role: 'customer',
      customPermissions: [],
    };
    const app = buildApp();

    const res = await request(app)
      .patch('/api/v2/admin/suppliers/sup-tramshed/location-mapping')
      .send({ citySlug: 'cardiff' });

    expect(res.status).toBe(403);
  });
});
