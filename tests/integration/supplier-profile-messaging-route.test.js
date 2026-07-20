'use strict';

const express = require('express');
const request = require('supertest');

describe('safe supplier profile messaging projection', () => {
  test('returns a messageable account id without leaking owner fields', async () => {
    jest.resetModules();
    const router = require('../../routes/supplier-profile-safe');
    const supplier = {
      id: 'sup_messageable',
      ownerUserId: 'user_owner',
      approved: true,
      name: 'Messageable Supplier',
      email: 'private-supplier@example.com',
      phone: '02920000000',
    };
    const owner = {
      id: 'user_owner',
      email: 'private-owner@example.com',
      passwordHash: 'private-hash',
    };
    const dbUnified = {
      findOne: jest.fn(async (collection, query) => {
        if (collection === 'suppliers' && query.id === supplier.id) return supplier;
        if (collection === 'users' && query.id === owner.id) return owner;
        return null;
      }),
      read: jest.fn(async collection => {
        if (collection === 'packages' || collection === 'badges') return [];
        if (collection === 'users') return [owner];
        return [];
      }),
    };

    router.initializeDependencies({
      dbUnified,
      getUserFromCookie: () => null,
      supplierIsProActive: jest.fn().mockResolvedValue(false),
      logger: { error: jest.fn(), warn: jest.fn() },
    });

    const app = express();
    app.use('/api', router);

    const response = await request(app).get(`/api/suppliers/${supplier.id}`).expect(200);

    expect(response.body).toMatchObject({
      id: supplier.id,
      name: supplier.name,
      messagingRecipientId: owner.id,
    });
    expect(response.body.ownerUserId).toBeUndefined();
    expect(response.body.email).toBeUndefined();
    expect(response.body.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(owner.email);
  });
});
