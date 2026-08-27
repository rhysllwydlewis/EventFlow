'use strict';

const express = require('express');
const request = require('supertest');
const ingestion = require('../../services/supplierBotIngestion.service');
const hmac = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const { canonicalWebsite, createUnclaimedSupplierFromBot, supplierIdForCandidate } = ingestion;
const { MAX_SKEW_MS, signatureFor, verifySupplierBotHmac } = hmac;

function payload(overrides = {}) {
  return {
    candidateId: 'candidate_test_123',
    businessName: 'Example Venue',
    category: 'Venues',
    location: 'South Wales',
    website: 'https://www.example-venue.test/',
    description: 'Independent EventFlow summary.',
    publicEmail: 'hello@example-venue.test',
    publicPhone: '02920 000000',
    services: ['Weddings', 'Events'],
    packages: [],
    advertisedPrices: [],
    publicationQuality: 91,
    dataConfidence: 88,
    complianceStatus: 'pass',
    compliancePolicyVersion: 'shadow-compliance-v1',
    generatedAt: '2026-08-26T12:00:00.000Z',
    generatorVersion: 'test-v1',
    ...overrides,
  };
}

function memoryDb(seed = []) {
  const suppliers = [...seed];
  return {
    suppliers,
    async read(name) {
      if (name !== 'suppliers') {
        throw new Error(`Unexpected collection: ${name}`);
      }
      return suppliers;
    },
    async insertOne(name, item) {
      if (name !== 'suppliers') {
        throw new Error(`Unexpected collection: ${name}`);
      }
      suppliers.push(item);
      return item;
    },
    async updateOne(name, filter, update) {
      if (name !== 'suppliers') {
        throw new Error(`Unexpected collection: ${name}`);
      }
      const item = suppliers.find(row => row.id === filter.id);
      if (!item) {
        return false;
      }
      Object.assign(item, update.$set || update);
      return true;
    },
  };
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function signedHeaders(body, secret, timestamp = String(Date.now()), prefix = true) {
  const signature = signatureFor(secret, timestamp, JSON.stringify(body));
  return {
    'x-eventflow-bot-timestamp': timestamp,
    'x-eventflow-bot-signature': prefix ? `sha256=${signature}` : signature,
  };
}

function headerRequest(body, headers) {
  return { body, get: name => headers[name.toLowerCase()] || '' };
}

function createRouteApp(dbUnified, logger = { error: jest.fn(), warn: jest.fn() }) {
  supplierProfileSafeRouter.initializeDependencies({ dbUnified, logger });
  const app = express();
  app.use(express.json());
  app.use(supplierProfileSafeRouter);
  return app;
}

describe('Supplier Bot ingestion', () => {
  it('creates an ownerless, unclaimed, non-public supplier with provenance', async () => {
    const dbUnified = memoryDb();
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(result.created).toBe(true);
    expect(result.supplier).not.toHaveProperty('ownerUserId');
    expect(result.supplier.ownershipStatus).toBe('unclaimed');
    expect(result.supplier.status).toBe('draft');
    expect(result.supplier.approved).toBe(false);
    expect(result.supplier.verified).toBe(false);
    expect(result.supplier.isPro).toBe(false);
    expect(result.supplier.publishedAt).toBeNull();
    expect(result.supplier.acquisition).toMatchObject({
      source: 'supplier_bot',
      candidateId: 'candidate_test_123',
      publicationQuality: 91,
      dataConfidence: 88,
    });
  });

  it('creates safe defaults when optional bot fields are absent or malformed', async () => {
    const dbUnified = memoryDb();
    const itemPayload = payload({
      description: '',
      location: '',
      publicEmail: '',
      publicPhone: '',
      services: null,
      packages: null,
      advertisedPrices: null,
      socials: 'not-an-object',
      generatedAt: '',
      generatorVersion: '',
      complianceStatus: '',
      compliancePolicyVersion: '',
    });
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: itemPayload });

    expect(result.supplier).toMatchObject({
      description: '',
      location: '',
      email: '',
      phone: '',
      tags: [],
      socials: {},
    });
    expect(result.supplier.acquisition).toMatchObject({
      generatedAt: null,
      generatorVersion: null,
      complianceStatus: null,
      compliancePolicyVersion: null,
      sourcePackages: [],
      advertisedPrices: [],
    });
  });

  it('is idempotent for the same Supplier Bot candidate', async () => {
    const dbUnified = memoryDb();
    const first = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });
    const second = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(second.created).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.supplier.id).toBe(first.supplier.id);
    expect(dbUnified.suppliers).toHaveLength(1);
  });

  it('recognizes an existing bot candidate by acquisition metadata', async () => {
    const existing = {
      id: 'legacy_bot_id',
      ownershipStatus: 'unclaimed',
      acquisition: { source: 'supplier_bot', candidateId: 'candidate_test_123' },
    };
    const dbUnified = memoryDb([existing]);
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
    expect(result.supplier.id).toBe('legacy_bot_id');
  });

  it('refuses to refresh a bot candidate that is no longer bot-managed', async () => {
    const existing = {
      id: 'legacy_bot_id',
      acquisition: { source: 'supplier_bot', candidateId: 'candidate_test_123' },
    };
    const dbUnified = memoryDb([existing]);
    const operation = createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    await expect(operation).rejects.toMatchObject({
      code: 'SUPPLIER_BOT_OWNERSHIP_CONFLICT',
      supplierId: 'legacy_bot_id',
    });
  });

  it('refuses to duplicate an existing website', async () => {
    const existing = {
      id: 'sup_existing',
      website: 'https://example-venue.test/',
      ownerUserId: 'user_1',
    };
    const dbUnified = memoryDb([existing]);
    const operation = createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    await expect(operation).rejects.toMatchObject({
      code: 'SUPPLIER_WEBSITE_CONFLICT',
      supplierId: 'sup_existing',
    });
  });

  it('ignores malformed legacy website values while checking duplicates', async () => {
    const existing = { id: 'legacy', website: 'not a valid url', slug: 'legacy' };
    const dbUnified = memoryDb([existing]);
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(result.created).toBe(true);
    expect(dbUnified.suppliers).toHaveLength(2);
  });

  it('adds a suffix when the generated slug already exists', async () => {
    const dbUnified = memoryDb([{ id: 'other', slug: 'example-venue' }]);
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(result.supplier.slug).toBe('example-venue-2');
  });

  it('uses the deterministic id for a punctuation-only business name', async () => {
    const dbUnified = memoryDb();
    const itemPayload = payload({ businessName: '!!!' });
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: itemPayload });

    expect(result.supplier.slug).toBe(supplierIdForCandidate(itemPayload.candidateId));
  });

  it('recovers idempotently from a duplicate-key race', async () => {
    const dbUnified = memoryDb();
    dbUnified.insertOne = async (_name, item) => {
      dbUnified.suppliers.push(item);
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    };

    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(result.created).toBe(false);
    expect(result.idempotent).toBe(true);
  });

  it('rethrows a duplicate-key error when no concurrent candidate can be found', async () => {
    const dbUnified = memoryDb();
    const duplicateError = new Error('duplicate key without matching candidate');
    duplicateError.code = 11000;
    dbUnified.insertOne = jest.fn().mockRejectedValue(duplicateError);
    const operation = createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    await expect(operation).rejects.toBe(duplicateError);
  });

  it('rethrows unexpected insert errors', async () => {
    const dbUnified = memoryDb();
    const insertError = new Error('storage unavailable');
    dbUnified.insertOne = jest.fn().mockRejectedValue(insertError);
    const operation = createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    await expect(operation).rejects.toBe(insertError);
  });

  test.each([
    ['missing database', null, payload(), 'Database unavailable'],
    ['missing payload', memoryDb(), null, 'Payload is required'],
    ['missing candidate id', memoryDb(), payload({ candidateId: '' }), 'candidateId is required'],
    ['invalid candidate id', memoryDb(), payload({ candidateId: 123 }), 'candidateId is required'],
    [
      'missing business name',
      memoryDb(),
      payload({ businessName: '' }),
      'businessName is required',
    ],
    [
      'invalid business name',
      memoryDb(),
      payload({ businessName: 123 }),
      'businessName is required',
    ],
    [
      'long business name',
      memoryDb(),
      payload({ businessName: 'x'.repeat(101) }),
      'businessName must be 100 characters or fewer',
    ],
    [
      'unsupported category',
      memoryDb(),
      payload({ category: 'Not a real category' }),
      'Unsupported supplier category',
    ],
    ['missing website', memoryDb(), payload({ website: '' }), 'website is required'],
    [
      'malformed website',
      memoryDb(),
      payload({ website: 'not a url' }),
      'website must be a valid URL',
    ],
    [
      'long description',
      memoryDb(),
      payload({ description: 'x'.repeat(5001) }),
      'description must be 5000 characters or fewer',
    ],
    [
      'long public email',
      memoryDb(),
      payload({ publicEmail: 'x'.repeat(255) }),
      'publicEmail must be 254 characters or fewer',
    ],
    [
      'long public phone',
      memoryDb(),
      payload({ publicPhone: 'x'.repeat(21) }),
      'publicPhone must be 20 characters or fewer',
    ],
    [
      'missing publication quality',
      memoryDb(),
      payload({ publicationQuality: undefined }),
      'publicationQuality is required',
    ],
    [
      'invalid data confidence',
      memoryDb(),
      payload({ dataConfidence: 'not-a-number' }),
      'dataConfidence is required',
    ],
  ])('rejects %s', async (_label, dbUnified, itemPayload, message) => {
    const operation = createUnclaimedSupplierFromBot({ dbUnified, payload: itemPayload });
    await expect(operation).rejects.toThrow(message);
  });

  it('normalizes supported websites and rejects invalid or unsupported URLs', () => {
    const normalized = canonicalWebsite('HTTPS://WWW.Example-Venue.TEST/path/#details');
    const unsupported = () => canonicalWebsite('ftp://example-venue.test');
    const malformed = () => canonicalWebsite('not a url');

    expect(normalized).toBe('https://example-venue.test/path');
    expect(unsupported).toThrow('Website must use HTTP or HTTPS');
    expect(malformed).toThrow('website must be a valid URL');
  });
});

describe('Supplier Bot HMAC middleware', () => {
  const originalEnabled = process.env.SUPPLIER_BOT_INGESTION_ENABLED;
  const originalSecret = process.env.EVENTFLOW_BOT_HMAC_SECRET;

  afterEach(() => {
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

  it('accepts a fresh correctly signed request with the sha256 prefix', () => {
    const secret = 'a'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    const req = headerRequest(body, headers);
    const res = mockResponse();
    const next = jest.fn();

    verifySupplierBotHmac(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a valid signature without the optional sha256 prefix', () => {
    const secret = 'b'.repeat(48);
    const body = payload();
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, String(Date.now()), false);
    const req = headerRequest(body, headers);
    const next = jest.fn();

    verifySupplierBotHmac(req, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails closed while ingestion is disabled', () => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'false';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = 'a'.repeat(48);
    const req = { body: payload(), get: () => '' };
    const res = mockResponse();

    verifySupplierBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Supplier Bot ingestion is disabled' });
  });

  it('fails closed when the shared secret is missing or too short', () => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = 'too-short';
    const req = { body: payload(), get: () => '' };
    const res = mockResponse();

    verifySupplierBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Supplier Bot ingestion secret is not configured',
    });
  });

  it('rejects a missing timestamp', () => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = 'c'.repeat(48);
    const headers = { 'x-eventflow-bot-signature': '0'.repeat(64) };
    const req = headerRequest(payload(), headers);
    const res = mockResponse();

    verifySupplierBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an expired timestamp', () => {
    const secret = 'd'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now() - MAX_SKEW_MS - 1);
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
    const headers = signedHeaders(body, secret, timestamp);
    const req = headerRequest(body, headers);
    const res = mockResponse();

    verifySupplierBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Supplier Bot request timestamp is invalid or expired',
    });
  });

  it('rejects malformed and incorrect signatures', () => {
    const secret = 'e'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;

    for (const signature of ['not-hex', '0'.repeat(64)]) {
      const headers = {
        'x-eventflow-bot-timestamp': timestamp,
        'x-eventflow-bot-signature': signature,
      };
      const req = headerRequest(body, headers);
      const res = mockResponse();

      verifySupplierBotHmac(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Supplier Bot signature' });
    }
  });

  it('signs an empty body consistently', () => {
    const secret = 'f'.repeat(48);
    const timestamp = String(Date.now());
    const headers = signedHeaders({}, secret, timestamp);
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
    const req = headerRequest(undefined, headers);
    const next = jest.fn();

    verifySupplierBotHmac(req, mockResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('Supplier Bot ingestion route', () => {
  const originalEnabled = process.env.SUPPLIER_BOT_INGESTION_ENABLED;
  const originalSecret = process.env.EVENTFLOW_BOT_HMAC_SECRET;
  const secret = 'route-test-secret'.repeat(3);

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

  async function postSupplier(app, body) {
    const headers = signedHeaders(body, secret);
    return request(app)
      .post('/internal/supplier-bot/suppliers')
      .set('x-eventflow-bot-timestamp', headers['x-eventflow-bot-timestamp'])
      .set('x-eventflow-bot-signature', headers['x-eventflow-bot-signature'])
      .send(body);
  }

  it('returns 201 for creation and 200 for an idempotent repeat', async () => {
    const dbUnified = memoryDb();
    const app = createRouteApp(dbUnified);
    const body = payload();

    const created = await postSupplier(app, body);
    const repeated = await postSupplier(app, body);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: 'draft',
      ownershipStatus: 'unclaimed',
      created: true,
      idempotent: false,
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ created: false, idempotent: true });
  });

  it('returns 503 when the database dependency is unavailable', async () => {
    const app = createRouteApp(undefined);
    const response = await postSupplier(app, payload());

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Database unavailable' });
  });

  it('returns 409 for an existing supplier website', async () => {
    const existing = { id: 'sup_existing', website: 'https://example-venue.test/' };
    const app = createRouteApp(memoryDb([existing]));
    const response = await postSupplier(app, payload());

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'A supplier with this website already exists',
      existingSupplierId: 'sup_existing',
    });
  });

  it('returns 400 for validation failures', async () => {
    const app = createRouteApp(memoryDb());
    const categoryResponse = await postSupplier(app, payload({ category: 'Unsupported' }));
    const websiteResponse = await postSupplier(app, payload({ website: 'not a url' }));

    expect(categoryResponse.status).toBe(400);
    expect(categoryResponse.body).toEqual({ error: 'Unsupported supplier category' });
    expect(websiteResponse.status).toBe(400);
    expect(websiteResponse.body).toEqual({ error: 'website must be a valid URL' });
  });

  it('returns 500 and logs unexpected ingestion failures', async () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    const dbUnified = memoryDb();
    dbUnified.read = jest.fn().mockRejectedValue(new Error('unexpected storage failure'));
    const app = createRouteApp(dbUnified, logger);
    const response = await postSupplier(app, payload());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Supplier Bot ingestion failed' });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
