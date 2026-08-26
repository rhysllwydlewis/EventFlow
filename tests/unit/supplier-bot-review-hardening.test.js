'use strict';

const express = require('express');
const request = require('supertest');

function botSupplier(overrides = {}) {
  return {
    id: 'sup_bot_review',
    ownershipStatus: 'unclaimed',
    name: 'Review Venue',
    category: 'Venues',
    location: 'Cardiff',
    website: 'https://review-venue.example/',
    email: 'hello@review-venue.example',
    status: 'published',
    approved: true,
    acquisition: { source: 'supplier_bot', candidateId: 'cand_review' },
    ...overrides,
  };
}

function mockDisconnectedMongo() {
  jest.doMock('../../db', () => ({
    isConnected: jest.fn(() => false),
    getCollection: jest.fn(),
  }));
}

describe('Supplier Bot Phase 2 review hardening', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('advances a pre-verification collision claim after the supplier verifies email', async () => {
    mockDisconnectedMongo();
    const supplier = botSupplier({ status: 'draft', approved: false });
    const claim = {
      id: 'clm_existing',
      supplierId: supplier.id,
      requesterUserId: 'usr_verified',
      status: 'pending_email_verification',
    };
    const dbUnified = {
      findOne: jest.fn(async () => claim),
      updateOne: jest.fn(async (_collection, _filter, update) => {
        Object.assign(claim, update.$set);
        return true;
      }),
      insertOne: jest.fn(),
    };
    const { createSupplierBotClaimRequest } = require('../../services/supplierBotClaim.service');

    const result = await createSupplierBotClaimRequest({
      dbUnified,
      supplier,
      user: {
        id: 'usr_verified',
        role: 'supplier',
        verified: true,
        email: supplier.email,
      },
      source: 'profile_claim',
    });

    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(result.claim.status).toBe('pending_proof');
    expect(result.claim.emailVerifiedAt).toBeTruthy();
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'supplierClaims',
      { id: 'clm_existing' },
      { $set: expect.objectContaining({ status: 'pending_proof' }) }
    );
    expect(dbUnified.insertOne).not.toHaveBeenCalled();
  });

  it('creates and awaits unique Mongo indexes before a claim write', async () => {
    const createIndex = jest.fn(async () => 'ok');
    const getCollection = jest.fn(async () => ({ createIndex }));
    jest.doMock('../../db', () => ({
      isConnected: jest.fn(() => true),
      getCollection,
    }));
    const { createSupplierBotClaimRequest } = require('../../services/supplierBotClaim.service');
    const supplier = botSupplier({ status: 'draft', approved: false });
    const dbUnified = {
      findOne: jest.fn(async () => null),
      insertOne: jest.fn(async (_collection, doc) => doc),
    };

    await createSupplierBotClaimRequest({
      dbUnified,
      supplier,
      user: { id: 'usr_index', role: 'supplier', verified: true, email: supplier.email },
    });

    expect(getCollection).toHaveBeenCalledWith('supplierClaims');
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { id: 1 },
      { unique: true, name: 'uniq_supplier_claim_id' }
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { supplierId: 1, requesterUserId: 1 },
      { unique: true, name: 'uniq_supplier_claim_supplier_requester' }
    );
    expect(dbUnified.findOne).toHaveBeenCalledAfter(createIndex);
    expect(dbUnified.insertOne).toHaveBeenCalledAfter(createIndex);
  });

  it('404s an accidentally approved unclaimed bot supplier from the public supplier API', async () => {
    mockDisconnectedMongo();
    const supplier = botSupplier();
    const router = require('../../routes/supplier-profile-safe');
    router.initializeDependencies({
      dbUnified: {
        findOne: jest.fn(async (collection, filter) =>
          collection === 'suppliers' && filter.id === supplier.id ? supplier : null
        ),
        read: jest.fn(async () => []),
      },
      getUserFromCookie: () => null,
      supplierIsProActive: jest.fn(async () => false),
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    const app = express();
    app.use(express.json());
    app.use(router);

    await request(app()).get(`/suppliers/${supplier.id}`).expect(404);
    await request(app()).get(`/suppliers/${supplier.id}/packages`).expect(404);
  });

  it('404s package-card data for an accidentally approved unclaimed bot supplier', async () => {
    const supplier = botSupplier();
    const router = require('../../routes/supplier-profile-package-cards');
    router.initializeDependencies({
      dbUnified: {
        findOne: jest.fn(async () => supplier),
      },
      getUserFromCookie: () => null,
      logger: { error: jest.fn() },
    });
    const app = express();
    app.use(router);

    await request(app())
      .get(`/supplier-profile/${supplier.id}/package-cards`)
      .expect(404);
  });
});
