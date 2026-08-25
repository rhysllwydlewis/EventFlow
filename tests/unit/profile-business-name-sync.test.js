'use strict';

const express = require('express');
const request = require('supertest');

function buildApp({ user, suppliers }) {
  jest.resetModules();
  const clearSearchCache = jest.fn().mockResolvedValue(undefined);
  const invalidate = jest.fn().mockResolvedValue(undefined);
  const updateOne = jest.fn().mockResolvedValue(true);

  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    },
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../middleware/rateLimits', () => ({
    writeLimiter: (_req, _res, next) => next(),
    uploadLimiter: (_req, _res, next) => next(),
    apiLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock('../../middleware/searchCache', () => ({ clearSearchCache }));
  jest.doMock('../../services/catalogCache', () => ({ invalidate }));

  const dbUnified = require('../../db-unified');
  jest.spyOn(dbUnified, 'findOne').mockImplementation(async (collection, query) => {
    if (collection === 'users' && query.id === user.id) {
      return user;
    }
    return null;
  });
  jest.spyOn(dbUnified, 'read').mockImplementation(async collection => {
    if (collection === 'suppliers') {
      return suppliers;
    }
    return [];
  });
  jest.spyOn(dbUnified, 'updateOne').mockImplementation(updateOne);

  const profileRoutes = require('../../routes/profile');
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  return { app, clearSearchCache, invalidate, updateOne };
}

describe('profile business-name sync', () => {
  test('setting a company name pushes it to the linked supplier record and clears caches', async () => {
    const { app, clearSearchCache, invalidate, updateOne } = buildApp({
      user: {
        id: 'user_1',
        email: 'owner@example.com',
        role: 'supplier',
        firstName: 'Shahnawaz',
        lastName: 'Lal',
      },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', name: 'Shahnawaz Lal' }],
    });

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({ $set: expect.objectContaining({ name: 'Luxury Car Hire' }) })
    );
    expect(clearSearchCache).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  test('matches the supplier by owner email when ownerUserId is not set', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'OWNER@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', email: 'owner@example.com', name: 'Shahnawaz Lal' }],
    });

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({ $set: expect.objectContaining({ name: 'Luxury Car Hire' }) })
    );
  });

  test('does not touch the supplier record when the name already matches', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', name: 'Luxury Car Hire' }],
    });

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(updateOne).not.toHaveBeenCalledWith('suppliers', { id: 'sup_1' }, expect.anything());
  });

  test('rejects an empty company name for a supplier account (guarded before the sync runs)', async () => {
    const { app, updateOne } = buildApp({
      user: {
        id: 'user_1',
        email: 'owner@example.com',
        role: 'supplier',
        company: 'Luxury Car Hire',
      },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', name: 'Luxury Car Hire' }],
    });

    await request(app).put('/api/profile').send({ company: '' }).expect(400);

    expect(updateOne).not.toHaveBeenCalledWith('suppliers', expect.anything(), expect.anything());
  });

  test('does nothing for non-supplier users', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_2', email: 'customer@example.com', role: 'customer' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_2', name: 'Shahnawaz Lal' }],
    });

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(updateOne).not.toHaveBeenCalledWith('suppliers', expect.anything(), expect.anything());
  });

  test('REGRESSION: an explicit owner id on a supplier is authoritative over a matching email', async () => {
    // A supplier already owned by a different account must never be renamed
    // just because one of its legacy email fields happens to match the
    // account making this request.
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'shared@example.com', role: 'supplier' },
      suppliers: [
        {
          id: 'sup_1',
          ownerUserId: 'user_other',
          email: 'shared@example.com',
          name: 'Other Business',
        },
      ],
    });

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(updateOne).not.toHaveBeenCalledWith('suppliers', expect.anything(), expect.anything());
  });

  test('logs when the supplier write fails so a stuck stale name is discoverable', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', name: 'Shahnawaz Lal' }],
    });
    // First call is the users-collection write (succeeds); second is the
    // suppliers-collection sync this test wants to fail.
    updateOne.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const logger = require('../../utils/logger');
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to sync supplier public name from account company name',
      expect.objectContaining({ userId: 'user_1', supplierId: 'sup_1' })
    );
    errorSpy.mockRestore();
  });

  test('invalidates the public supplier SEO route cache when it is registered on the app', async () => {
    const { app, updateOne } = buildApp({
      user: { id: 'user_1', email: 'owner@example.com', role: 'supplier' },
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', name: 'Shahnawaz Lal' }],
    });
    const invalidateSupplierCache = jest.fn();
    app.locals.publicSupplierSeoRouter = { invalidateSupplierCache };

    await request(app).put('/api/profile').send({ company: 'Luxury Car Hire' }).expect(200);

    expect(invalidateSupplierCache).toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      'suppliers',
      { id: 'sup_1' },
      expect.objectContaining({ $set: expect.objectContaining({ name: 'Luxury Car Hire' }) })
    );
  });
});
