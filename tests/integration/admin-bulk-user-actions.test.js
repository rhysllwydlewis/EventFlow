/**
 * Integration tests for admin bulk user actions (contract-focused)
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

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../middleware/audit', () => ({
  auditLog: (...args) => mockAuditLog(...args),
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
  },
}));

jest.mock('../../middleware/domain-admin', () => ({
  isOwnerEmail: email => email === 'owner@example.com',
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  write: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  insertOne: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const adminUserManagementRoutes = require('../../routes/admin-user-management');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminUserManagementRoutes);
  return app;
}

describe('Admin Bulk User Actions (contract tests)', () => {
  let app;
  let users;

  beforeEach(() => {
    app = createApp();
    users = [
      { id: 'admin-1', email: 'admin@example.com', role: 'admin', verified: true },
      { id: 'usr-1', email: 'u1@example.com', role: 'customer', verified: false },
      { id: 'usr-2', email: 'owner@example.com', role: 'customer', verified: false },
      { id: 'usr-3', email: 'u3@example.com', role: 'customer', verified: true },
      { id: 'admin-2', email: 'admin2@example.com', role: 'admin', verified: false },
      { id: 'owner-role', email: 'role-owner@example.com', role: 'owner', verified: false },
      {
        id: 'owner-flag',
        email: 'flag-owner@example.com',
        role: 'customer',
        isOwner: true,
        verified: false,
      },
      { _id: 'legacy-1', email: 'legacy@example.com', role: 'customer', verified: false },
    ];

    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return users;
      }
      return [];
    });

    dbUnified.write.mockImplementation(async (collection, data) => {
      if (collection === 'users') {
        users = data;
      }
    });

    // updateOne: apply $set updates to the in-memory users array
    dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
      if (collection === 'users') {
        const idx = users.findIndex(u => Object.keys(filter).every(k => u[k] === filter[k]));
        if (idx >= 0 && update.$set) {
          users[idx] = { ...users[idx], ...update.$set };
          return true;
        }
        return false;
      }
      return true;
    });

    // deleteOne: remove matching user from in-memory array
    dbUnified.deleteOne.mockImplementation(async (collection, id) => {
      if (collection === 'users') {
        const idx = users.findIndex(u =>
          typeof id === 'object' ? Object.keys(id).every(k => u[k] === id[k]) : u.id === id
        );
        if (idx >= 0) {
          users.splice(idx, 1);
          return true;
        }
        return false;
      }
      return true;
    });

    dbUnified.insertOne.mockImplementation(async (collection, doc) => {
      if (collection === 'users') {
        users.push(doc);
      }
      return doc;
    });

    mockAuditLog.mockClear();
    dbUnified.read.mockClear();
    dbUnified.write.mockClear();
    dbUnified.updateOne.mockClear();
    dbUnified.deleteOne.mockClear();
    dbUnified.insertOne.mockClear();
  });

  describe('POST /api/admin/users/bulk-delete', () => {
    it('rejects invalid input', async () => {
      const res = await request(app).post('/api/admin/users/bulk-delete').send({ userIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/userIds must be a non-empty array/i);
    });

    it('deletes deletable users, skips owner/self, and returns counts', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-delete')
        .send({ userIds: ['admin-1', 'usr-1', 'usr-2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deletedCount).toBe(1);
      expect(res.body.totalRequested).toBe(3);

      expect(users.map(u => u.id)).toEqual([
        'admin-1',
        'usr-2',
        'usr-3',
        'admin-2',
        'owner-role',
        'owner-flag',
      ]);
      expect(dbUnified.deleteOne).toHaveBeenCalledTimes(1);
      expect(dbUnified.deleteOne).toHaveBeenCalledWith('users', 'usr-1');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BULK_USERS_DELETED',
          details: expect.objectContaining({
            deletedCount: 1,
            userIds: ['admin-1', 'usr-1', 'usr-2'],
          }),
        })
      );
    });
  });

  describe('POST /api/admin/users/bulk-verify', () => {
    it('skips protected admin and owner accounts when called directly', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-verify')
        .send({ userIds: ['admin-1', 'admin-2', 'usr-2', 'owner-role', 'owner-flag', 'missing'] });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(0);
      expect(res.body.skippedProtected).toBe(5);
      expect(res.body.notFound).toBe(1);
      expect(res.body.totalRequested).toBe(6);
      expect(users.find(u => u.id === 'admin-2').verified).toBe(false);
      expect(users.find(u => u.id === 'owner-role').verified).toBe(false);
      expect(res.body.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'admin-2', reason: 'protected_account' }),
          expect.objectContaining({ id: 'missing', reason: 'not_found' }),
        ])
      );
    });

    it('verifies unverified users and _id-only users and returns verification counters', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-verify')
        .send({ userIds: ['usr-1', 'usr-3', 'legacy-1', 'missing'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.verifiedCount).toBe(2);
      expect(res.body.alreadyVerifiedCount).toBe(1);
      expect(res.body.totalRequested).toBe(4);

      expect(users.find(u => u.id === 'usr-1').verified).toBe(true);
      expect(users.find(u => u._id === 'legacy-1').verified).toBe(true);
      expect(dbUnified.updateOne).toHaveBeenCalledTimes(2);
      expect(dbUnified.updateOne).toHaveBeenCalledWith(
        'users',
        { id: 'usr-1' },
        expect.objectContaining({ $set: expect.objectContaining({ verified: true }) })
      );
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BULK_USERS_VERIFIED',
          details: expect.objectContaining({ verifiedCount: 2, alreadyVerifiedCount: 1 }),
        })
      );
    });
  });

  describe('POST /api/admin/users/bulk-suspend', () => {
    it('skips admin and owner accounts for suspension when called directly', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-suspend')
        .send({ userIds: ['admin-2', 'owner-role', 'owner-flag', 'usr-1'], suspended: true });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(1);
      expect(res.body.skippedProtected).toBe(3);
      expect(users.find(u => u.id === 'usr-1').suspended).toBe(true);
      expect(users.find(u => u.id === 'admin-2').suspended).toBeUndefined();
      expect(users.find(u => u.id === 'owner-role').suspended).toBeUndefined();
    });

    it('suspends requested users except self and returns updatedCount', async () => {
      const res = await request(app)
        .post('/api/admin/users/bulk-suspend')
        .send({
          userIds: ['admin-1', 'usr-1', 'usr-3'],
          suspended: true,
          reason: 'policy violation',
          duration: '7d',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updatedCount).toBe(2);
      expect(res.body.totalRequested).toBe(3);

      expect(users.find(u => u.id === 'admin-1').suspended).toBeUndefined();
      expect(users.find(u => u.id === 'usr-1').suspended).toBe(true);
      expect(users.find(u => u.id === 'usr-3').suspended).toBe(true);
      expect(dbUnified.updateOne).toHaveBeenCalledTimes(2);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BULK_USERS_SUSPENDED',
          details: expect.objectContaining({ count: 2, reason: 'policy violation' }),
        })
      );
    });
  });
});
