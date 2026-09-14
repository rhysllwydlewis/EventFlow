'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const secret = 'repeatable-unpublish-test-secret'.repeat(2);

function payload(candidateId, businessName, website, overrides = {}) {
  return {
    candidateId,
    businessName,
    category: 'Venues',
    location: 'North Wales',
    website,
    description: `${businessName} public description`,
    publicEmail: '',
    publicPhone: '',
    services: ['Weddings'],
    packages: [],
    advertisedPrices: ['From £2,500'],
    coverImage: `https://${new URL(website).hostname}/cover.jpg`,
    images: [`https://${new URL(website).hostname}/gallery.jpg`],
    mediaEvidence: [],
    publicationQuality: 92,
    dataConfidence: 90,
    complianceStatus: 'pass',
    compliancePolicyVersion: 'repeatable-unpublish-v1',
    generatedAt: '2026-09-14T15:00:00.000Z',
    generatorVersion: 'repeatable-test-v1',
    publicationScope: 'public_unclaimed',
    ...overrides,
  };
}

function memoryDb() {
  const suppliers = [];
  return {
    suppliers,
    async read(name) {
      if (name === 'suppliers') {
        return suppliers;
      }
      return [];
    },
    async findOne(name, query) {
      if (name !== 'suppliers') {
        return null;
      }
      return suppliers.find(item => item.id === query.id) || null;
    },
    async insertOne(name, item) {
      if (name !== 'suppliers') {
        throw new Error(`Unexpected collection: ${name}`);
      }
      suppliers.push(item);
      return item;
    },
    // Mirrors the real db-unified.js contract: dotted $set keys nest, plain
    // keys (like the whole-object `acquisition` replacement the route uses)
    // overwrite directly -- a naive Object.assign would instead create a
    // literal 'acquisition.publicationScope' property and silently pass
    // this test while leaving production's dot-path semantics untested.
    async updateOne(name, query, update) {
      if (name !== 'suppliers') {
        return false;
      }
      const supplier = suppliers.find(item => item.id === query.id);
      if (!supplier) {
        return false;
      }
      for (const [key, value] of Object.entries(update.$set || {})) {
        if (key.includes('.')) {
          const [outer, inner] = key.split('.');
          supplier[outer] = { ...(supplier[outer] || {}), [inner]: value };
        } else {
          supplier[key] = value;
        }
      }
      return true;
    },
  };
}

function createApp(dbUnified) {
  supplierProfileSafeRouter.initializeDependencies({
    dbUnified,
    logger: { error: jest.fn(), warn: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use(supplierProfileSafeRouter);
  return app;
}

async function postSupplier(app, body) {
  const timestamp = String(Date.now());
  const signature = signatureFor(secret, timestamp, JSON.stringify(body));
  return request(app)
    .post('/internal/supplier-bot/suppliers')
    .set('x-eventflow-bot-timestamp', timestamp)
    .set('x-eventflow-bot-signature', `sha256=${signature}`)
    .send(body);
}

async function unpublishSupplier(app, supplierId, body = {}) {
  const timestamp = String(Date.now());
  const rawBody = JSON.stringify(body);
  const signature = signatureFor(secret, timestamp, rawBody);
  return request(app)
    .post(`/internal/supplier-bot/suppliers/${supplierId}/unpublish`)
    .set('x-eventflow-bot-timestamp', timestamp)
    .set('x-eventflow-bot-signature', `sha256=${signature}`)
    .send(body);
}

describe('Supplier Bot unpublish route', () => {
  const originalEnabled = process.env.SUPPLIER_BOT_INGESTION_ENABLED;
  const originalSecret = process.env.EVENTFLOW_BOT_HMAC_SECRET;

  beforeEach(() => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
  });

  afterAll(() => {
    if (originalEnabled === undefined) {
      delete process.env.SUPPLIER_BOT_INGESTION_ENABLED;
    } else {
      process.env.SUPPLIER_BOT_INGESTION_ENABLED = originalEnabled;
    }
    if (originalSecret === undefined) {
      delete process.env.EVENTFLOW_BOT_HMAC_SECRET;
    } else {
      process.env.EVENTFLOW_BOT_HMAC_SECRET = originalSecret;
    }
  });

  it('hides a bot-managed unclaimed profile from both the profile route and search-style filters', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const published = await postSupplier(
      app,
      payload('candidate_unpub_1', 'Wrong Fit Venue', 'https://wrong-fit-venue.example/')
    );
    expect(published.status).toBe(201);
    const supplierId = published.body.supplierId;

    const result = await unpublishSupplier(app, supplierId, {
      reason: 'Wrong region for this marketplace',
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, supplierId });

    const stored = dbUnified.suppliers.find(item => item.id === supplierId);
    expect(stored.approved).toBe(false);
    expect(stored.acquisition.publicationScope).toBeNull();
    expect(stored.acquisition.unpublishedReason).toBe('Wrong region for this marketplace');

    // The public profile route's canRead() gate must no longer admit it via
    // either the bot-profile branch or the approved:true branch.
    const profileFetch = await request(app).get(`/suppliers/${supplierId}`);
    expect(profileFetch.status).toBe(404);
  });

  it('returns 404 for an unknown supplier id', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);

    const result = await unpublishSupplier(app, 'sup_bot_does_not_exist');

    expect(result.status).toBe(404);
  });

  it('refuses to unpublish a supplier that is no longer a bot-managed unclaimed profile', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const published = await postSupplier(
      app,
      payload('candidate_unpub_claimed', 'Now Claimed Venue', 'https://now-claimed-venue.example/')
    );
    const supplierId = published.body.supplierId;
    const stored = dbUnified.suppliers.find(item => item.id === supplierId);
    stored.ownershipStatus = 'claimed';
    stored.ownerUserId = 'supplier_owner_1';

    const result = await unpublishSupplier(app, supplierId);

    expect(result.status).toBe(409);
    expect(stored.approved).not.toBe(false);
  });

  it('rejects an unsigned or badly signed request the same way the ingestion route does', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const published = await postSupplier(
      app,
      payload(
        'candidate_unpub_unsigned',
        'Unsigned Attempt Venue',
        'https://unsigned-attempt-venue.example/'
      )
    );
    const supplierId = published.body.supplierId;

    const result = await request(app)
      .post(`/internal/supplier-bot/suppliers/${supplierId}/unpublish`)
      .send({});

    expect(result.status).toBe(401);
    const stored = dbUnified.suppliers.find(item => item.id === supplierId);
    expect(stored.approved).not.toBe(false);
  });
});
