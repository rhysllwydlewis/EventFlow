'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const secret = 'repeatable-publication-test-secret'.repeat(2);

function payload(candidateId, businessName, website, overrides = {}) {
  return {
    candidateId,
    businessName,
    category: 'Venues',
    location: 'South Wales',
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
    compliancePolicyVersion: 'repeatable-publication-v1',
    generatedAt: '2026-08-27T15:00:00.000Z',
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
      if (name === 'suppliers') return suppliers;
      if (name === 'packages' || name === 'badges' || name === 'users') return [];
      return [];
    },
    async findOne(name, query) {
      if (name !== 'suppliers') return null;
      return suppliers.find(item => item.id === query.id) || null;
    },
    async insertOne(name, item) {
      if (name !== 'suppliers') throw new Error(`Unexpected collection: ${name}`);
      suppliers.push(item);
      return item;
    },
    async updateOne(name, query, update) {
      if (name !== 'suppliers') return false;
      const supplier = suppliers.find(item => item.id === query.id);
      if (!supplier) return false;
      Object.assign(supplier, update.$set || {});
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

describe('repeatable public-unclaimed Supplier Bot ingestion', () => {
  const originalEnabled = process.env.SUPPLIER_BOT_INGESTION_ENABLED;
  const originalSecret = process.env.EVENTFLOW_BOT_HMAC_SECRET;

  beforeEach(() => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
  });

  afterAll(() => {
    if (originalEnabled === undefined) delete process.env.SUPPLIER_BOT_INGESTION_ENABLED;
    else process.env.SUPPLIER_BOT_INGESTION_ENABLED = originalEnabled;
    if (originalSecret === undefined) delete process.env.EVENTFLOW_BOT_HMAC_SECRET;
    else process.env.EVENTFLOW_BOT_HMAC_SECRET = originalSecret;
  });

  it('allows multiple independently published unclaimed profiles without the pilot slot', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);

    const first = await postSupplier(
      app,
      payload('candidate_public_1', 'Public Venue One', 'https://public-one.example/')
    );
    const second = await postSupplier(
      app,
      payload('candidate_public_2', 'Public Venue Two', 'https://public-two.example/')
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toMatchObject({
      ownershipStatus: 'unclaimed',
      publicationScope: 'public_unclaimed',
      created: true,
    });
    expect(second.body.publicProfilePath).toMatch(/^\/supplier\/public-venue-two--[a-f0-9]{16}$/);
    expect(dbUnified.suppliers).toHaveLength(2);
  });

  it('refreshes a bot-managed unclaimed profile in place and keeps its stable identity', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const firstBody = payload(
      'candidate_refresh_1',
      'Refresh Venue',
      'https://refresh-venue.example/'
    );
    const first = await postSupplier(app, firstBody);
    const original = { ...dbUnified.suppliers[0] };

    const refreshed = await postSupplier(
      app,
      payload('candidate_refresh_1', 'Refresh Venue Updated', 'https://refresh-venue.example/', {
        description: 'Fresh crawler content',
        services: ['Weddings', 'Corporate events'],
        coverImage: 'https://refresh-venue.example/new-cover.jpg',
        generatedAt: '2026-08-27T16:00:00.000Z',
      })
    );

    expect(first.status).toBe(201);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toMatchObject({ created: false, idempotent: true, refreshed: true });
    expect(refreshed.body.supplierId).toBe(first.body.supplierId);
    expect(refreshed.body.slug).toBe(first.body.slug);
    expect(refreshed.body.publicProfilePath).toBe(first.body.publicProfilePath);
    expect(dbUnified.suppliers).toHaveLength(1);
    expect(dbUnified.suppliers[0]).toMatchObject({
      id: original.id,
      slug: original.slug,
      name: 'Refresh Venue Updated',
      description: 'Fresh crawler content',
    });
    expect(dbUnified.suppliers[0].acquisition.sourceMedia.coverImage).toBe(
      'https://refresh-venue.example/new-cover.jpg'
    );
    expect(dbUnified.suppliers[0].acquisition.publicationScope).toBe('public_unclaimed');
  });

  it('will not overwrite a profile after ownership leaves the bot-managed unclaimed state', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const body = payload('candidate_claimed_1', 'Claimed Venue', 'https://claimed-venue.example/');
    const first = await postSupplier(app, body);
    dbUnified.suppliers[0].ownershipStatus = 'claimed';
    dbUnified.suppliers[0].ownerUserId = 'supplier_owner_1';

    const attemptedRefresh = await postSupplier(app, {
      ...body,
      businessName: 'Crawler Must Not Replace This',
      description: 'Crawler must not replace this either',
    });

    expect(first.status).toBe(201);
    expect(attemptedRefresh.status).toBe(409);
    expect(attemptedRefresh.body.existingSupplierId).toBe(first.body.supplierId);
    expect(dbUnified.suppliers[0].name).toBe('Claimed Venue');
  });
});
