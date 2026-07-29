'use strict';

const express = require('express');
const request = require('supertest');

describe('supplier trust admin routes', () => {
  let data;
  let auditLog;
  let updateOne;

  beforeEach(() => {
    jest.resetModules();

    data = {
      id: 'sup_1',
      name: 'Example Supplier',
      badges: [],
      trustVerifications: {},
    };
    auditLog = jest.fn(async () => ({ id: 'audit_1' }));
    updateOne = jest.fn(async (_collection, _filter, update) => {
      Object.assign(data, update.$set || {});
      return true;
    });

    jest.doMock('../../db-unified', () => ({
      findOne: jest.fn(async (_collection, filter) => (filter.id === data.id ? data : null)),
      updateOne,
    }));
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, _res, next) => {
        req.user = { id: 'admin_1', email: 'admin@example.com', role: 'admin' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/csrf', () => ({
      csrfProtection: (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/rateLimits', () => ({
      writeLimiter: (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/audit', () => ({
      auditLog,
      AUDIT_ACTIONS: {
        SUPPLIER_TRUST_BADGE_CONFIRMED: 'supplier_trust_badge_confirmed',
        SUPPLIER_TRUST_BADGE_REMOVED: 'supplier_trust_badge_removed',
      },
    }));
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
  });

  function app() {
    const router = require('../../routes/supplier-trust-admin');
    const instance = express();
    instance.use(express.json());
    instance.use(router);
    return instance;
  }

  test('confirms a PLI badge with structured trust state and an actor-attributed audit event', async () => {
    const res = await request(app())
      .post('/suppliers/sup_1/trust-badges/public-liability-verified')
      .send({});

    expect(res.status).toBe(200);
    expect(data.badges).toContain('public-liability-verified');
    expect(data.trustVerifications.publicLiability).toMatchObject({
      verified: true,
      verifiedBy: 'admin_1',
      revokedAt: null,
      revokedBy: null,
    });
    expect(data.trustVerifications.publicLiability.verifiedAt).toEqual(expect.any(String));
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin_1',
        adminEmail: 'admin@example.com',
        action: 'supplier_trust_badge_confirmed',
        targetType: 'supplier',
        targetId: 'sup_1',
        details: expect.objectContaining({
          badgeId: 'public-liability-verified',
          trustKey: 'publicLiability',
          verified: true,
        }),
      })
    );
  });

  test('removes a DBS badge and records who revoked the trust signal', async () => {
    data.badges = ['dbs-checked', 'fast-responder'];
    data.trustVerifications = {
      dbs: { verified: true, verifiedAt: '2026-01-01T00:00:00.000Z', verifiedBy: 'admin_old' },
    };

    const res = await request(app()).delete('/suppliers/sup_1/trust-badges/dbs-checked');

    expect(res.status).toBe(200);
    expect(data.badges).toEqual(['fast-responder']);
    expect(data.trustVerifications.dbs).toMatchObject({
      verified: false,
      revokedBy: 'admin_1',
    });
    expect(data.trustVerifications.dbs.revokedAt).toEqual(expect.any(String));
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier_trust_badge_removed',
        targetId: 'sup_1',
        details: expect.objectContaining({ badgeId: 'dbs-checked', verified: false }),
      })
    );
  });

  test('rolls back the public trust change when the audit record cannot be saved', async () => {
    data.badges = ['fast-responder'];
    data.trustVerifications = { dbs: { verified: false } };
    auditLog.mockResolvedValueOnce(null);

    const res = await request(app())
      .post('/suppliers/sup_1/trust-badges/public-liability-verified')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/audit record could not be saved/i);
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(data.badges).toEqual(['fast-responder']);
    expect(data.trustVerifications).toEqual({ dbs: { verified: false } });
  });

  test('audit rollback preserves unrelated changes made after the trust mutation', async () => {
    data.badges = ['fast-responder'];
    data.trustVerifications = { dbs: { verified: false } };
    auditLog.mockResolvedValueOnce(null);
    updateOne.mockImplementationOnce(async (_collection, _filter, update) => {
      Object.assign(data, update.$set || {});
      // Simulate a separate admin action landing before this request discovers
      // that its audit record failed.
      data.badges = [...data.badges, 'top-rated'];
      data.trustVerifications = {
        ...data.trustVerifications,
        dbs: { verified: true, verifiedAt: '2026-07-29T12:00:00.000Z' },
      };
      return true;
    });

    const res = await request(app())
      .post('/suppliers/sup_1/trust-badges/public-liability-verified')
      .send({});

    expect(res.status).toBe(503);
    expect(data.badges).toEqual(expect.arrayContaining(['fast-responder', 'top-rated']));
    expect(data.badges).not.toContain('public-liability-verified');
    expect(data.trustVerifications.dbs).toEqual({
      verified: true,
      verifiedAt: '2026-07-29T12:00:00.000Z',
    });
    expect(data.trustVerifications.publicLiability).toBeUndefined();
  });

  test('fails before auditing when the trust mutation cannot be persisted', async () => {
    updateOne.mockImplementationOnce(async () => false);

    const res = await request(app())
      .post('/suppliers/sup_1/trust-badges/licence-verified')
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/persist supplier trust verification/i);
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('rejects arbitrary badge IDs so the trust endpoint cannot become a generic award API', async () => {
    const res = await request(app()).post('/suppliers/sup_1/trust-badges/top-rated').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unsupported trust badge');
    expect(updateOne).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  test('returns 404 without creating an audit record for an unknown supplier', async () => {
    const res = await request(app())
      .post('/suppliers/sup_missing/trust-badges/licence-verified')
      .send({});

    expect(res.status).toBe(404);
    expect(updateOne).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
