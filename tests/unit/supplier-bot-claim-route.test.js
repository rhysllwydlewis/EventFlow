'use strict';

const express = require('express');
const request = require('supertest');

function makeSupplier(overrides = {}) {
  return {
    id: 'sup_bot_existing',
    ownershipStatus: 'unclaimed',
    name: 'Example Venue',
    category: 'Venues',
    website: 'https://example-venue.test/',
    email: 'hello@example-venue.test',
    status: 'draft',
    approved: false,
    acquisition: { source: 'supplier_bot', candidateId: 'cand_1' },
    ...overrides,
  };
}

function buildApp({ sessionUser, dbUser, supplier = makeSupplier() } = {}) {
  jest.resetModules();
  const claims = [];
  const data = {
    users: dbUser ? [dbUser] : [],
    suppliers: supplier ? [supplier] : [],
    supplierClaims: claims,
  };
  const dbUnified = {
    findOne: jest.fn(async (collection, filter) => {
      const rows = data[collection] || [];
      return rows.find(row => Object.keys(filter).every(key => row[key] === filter[key])) || null;
    }),
    insertOne: jest.fn(async (collection, doc) => {
      data[collection].push(doc);
      return doc;
    }),
    read: jest.fn(async collection => data[collection] || []),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const router = require('../../routes/supplier-profile-safe');
  router.initializeDependencies({
    dbUnified,
    getUserFromCookie: jest.fn(() => sessionUser || null),
    supplierIsProActive: jest.fn(async () => false),
    logger,
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  return { app, claims, dbUnified, logger };
}

describe('POST /supplier-bot/claims/:supplierId', () => {
  it('requires authentication', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication required');
  });

  it('requires a supplier account', async () => {
    const user = { id: 'usr_1', role: 'customer', verified: true, email: 'hello@example.test' };
    const { app } = buildApp({ sessionUser: user, dbUser: user });
    const response = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});
    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/supplier account/i);
  });

  it('requires verified email before creating a claim request', async () => {
    const sessionUser = { id: 'usr_1', role: 'supplier' };
    const dbUser = {
      id: 'usr_1',
      role: 'supplier',
      verified: false,
      email: 'hello@example-venue.test',
    };
    const { app, claims } = buildApp({ sessionUser, dbUser });
    const response = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(claims).toHaveLength(0);
  });

  it('returns 404 for an unknown supplier', async () => {
    const user = {
      id: 'usr_1',
      role: 'supplier',
      verified: true,
      email: 'hello@example-venue.test',
    };
    const { app } = buildApp({ sessionUser: user, dbUser: user, supplier: null });
    const response = await request(app).post('/supplier-bot/claims/missing').send({});
    expect(response.status).toBe(404);
  });

  it('creates an idempotent pending-proof claim without transferring ownership', async () => {
    const user = {
      id: 'usr_1',
      role: 'supplier',
      verified: true,
      email: 'hello@example-venue.test',
      website: 'https://example-venue.test',
    };
    const supplier = makeSupplier();
    const { app, claims } = buildApp({ sessionUser: user, dbUser: user, supplier });

    const first = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});
    const second = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});

    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({
      supplierId: 'sup_bot_existing',
      status: 'pending_proof',
      created: true,
      idempotent: false,
    });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.idempotent).toBe(true);
    expect(claims).toHaveLength(1);
    expect(claims[0].signals).toEqual([
      'public_email_exact',
      'website_exact',
      'email_domain_match',
    ]);
    expect(supplier.ownerUserId).toBeUndefined();
    expect(supplier.ownershipStatus).toBe('unclaimed');
  });

  it('refuses a profile that is no longer unclaimed', async () => {
    const user = {
      id: 'usr_1',
      role: 'supplier',
      verified: true,
      email: 'hello@example-venue.test',
    };
    const supplier = makeSupplier({ ownershipStatus: 'claimed', ownerUserId: 'usr_other' });
    const { app } = buildApp({ sessionUser: user, dbUser: user, supplier });
    const response = await request(app).post('/supplier-bot/claims/sup_bot_existing').send({});
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/not an unclaimed Supplier Bot profile/i);
  });
});
