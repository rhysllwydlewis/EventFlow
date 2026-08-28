'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const secret = 'repeatable-lookup-test-secret'.repeat(2);

function memoryDb(initialSuppliers = []) {
  const suppliers = [...initialSuppliers];
  return {
    suppliers,
    async read(name) {
      if (name === 'suppliers') {
        return suppliers;
      }
      return [];
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

async function lookup(app, body) {
  const timestamp = String(Date.now());
  const signature = signatureFor(secret, timestamp, JSON.stringify(body));
  return request(app)
    .post('/internal/supplier-bot/suppliers/lookup')
    .set('x-eventflow-bot-timestamp', timestamp)
    .set('x-eventflow-bot-signature', `sha256=${signature}`)
    .send(body);
}

describe('Supplier Bot pre-crawl existence lookup', () => {
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

  it('reports exists:true for a domain that already belongs to a supplier the bot never created, even on a different page', async () => {
    // The whole point of this endpoint: a business that signed up directly
    // through the site, never touching the Supplier Bot ingestion route at
    // all, must still be found here -- it scans the real suppliers
    // collection, not any bot-specific bookkeeping. Matching is by
    // hostname, not the ingestion route's path-sensitive canonicalWebsite()
    // comparison, because at discovery time the bot only has a bare domain
    // -- not yet a specific page on it.
    const dbUnified = memoryDb([
      {
        id: 'sup_direct_signup_1',
        website: 'https://direct-signup.example/venue-info',
        ownershipStatus: 'claimed',
        acquisition: { source: 'self_registration' },
      },
    ]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'direct-signup.example' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: true });
  });

  it('reports exists:true regardless of a stored www prefix', async () => {
    const dbUnified = memoryDb([
      { id: 'sup_1', website: 'http://www.example-venue.co.uk/', ownershipStatus: 'unclaimed' },
    ]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'example-venue.co.uk' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: true });
  });

  it('reports exists:false for a domain no supplier has', async () => {
    const dbUnified = memoryDb([{ id: 'sup_1', website: 'https://someone-else.example/' }]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'not-registered.example' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });

  it('never leaks which supplier matched -- only a boolean', async () => {
    const dbUnified = memoryDb([
      { id: 'sup_secret', website: 'https://matched.example/', name: 'Should Not Leak Ltd' },
    ]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'matched.example' });

    expect(Object.keys(response.body)).toEqual(['exists']);
  });

  it('rejects a missing or malformed domain with 400, not a 500 or a false negative', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);

    const missing = await lookup(app, {});
    expect(missing.status).toBe(400);

    const wrongType = await lookup(app, { domain: 12345 });
    expect(wrongType.status).toBe(400);

    // A full URL, not a bare hostname -- the endpoint's contract is domain-only.
    const fullUrl = await lookup(app, { domain: 'https://example.com/path' });
    expect(fullUrl.status).toBe(400);

    const noTld = await lookup(app, { domain: 'localhost' });
    expect(noTld.status).toBe(400);
  });

  it('requires the same HMAC signature as every other Supplier Bot route', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const timestamp = String(Date.now());

    const response = await request(app)
      .post('/internal/supplier-bot/suppliers/lookup')
      .set('x-eventflow-bot-timestamp', timestamp)
      .set('x-eventflow-bot-signature', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
      .send({ domain: 'example.com' });

    expect(response.status).toBe(401);
  });

  it('a supplier with no website on record is skipped without throwing', async () => {
    const dbUnified = memoryDb([{ id: 'sup_no_website' }]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'anything.example' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });

  it('a supplier with an unparseable website on record is skipped without throwing', async () => {
    const dbUnified = memoryDb([{ id: 'sup_bad_url', website: 'not a url' }]);
    const app = createApp(dbUnified);

    const response = await lookup(app, { domain: 'anything.example' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ exists: false });
  });
});
