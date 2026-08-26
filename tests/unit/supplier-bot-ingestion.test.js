'use strict';

const {
  createUnclaimedSupplierFromBot,
} = require('../../services/supplierBotIngestion.service');
const {
  signatureFor,
  verifySupplierBotHmac,
} = require('../../middleware/supplierBotHmac');

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
      if (name !== 'suppliers') throw new Error(`Unexpected collection: ${name}`);
      return suppliers;
    },
    async insertOne(name, item) {
      if (name !== 'suppliers') throw new Error(`Unexpected collection: ${name}`);
      suppliers.push(item);
      return item;
    },
  };
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

  it('is idempotent for the same Supplier Bot candidate', async () => {
    const dbUnified = memoryDb();
    const first = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });
    const second = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });

    expect(second.created).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.supplier.id).toBe(first.supplier.id);
    expect(dbUnified.suppliers).toHaveLength(1);
  });

  it('refuses to duplicate an existing website', async () => {
    const dbUnified = memoryDb([
      { id: 'sup_existing', website: 'https://example-venue.test/', ownerUserId: 'user_1' },
    ]);

    await expect(
      createUnclaimedSupplierFromBot({ dbUnified, payload: payload() })
    ).rejects.toMatchObject({ code: 'SUPPLIER_WEBSITE_CONFLICT', supplierId: 'sup_existing' });
  });
});

describe('Supplier Bot HMAC middleware', () => {
  const originalEnabled = process.env.SUPPLIER_BOT_INGESTION_ENABLED;
  const originalSecret = process.env.EVENTFLOW_BOT_HMAC_SECRET;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.SUPPLIER_BOT_INGESTION_ENABLED;
    else process.env.SUPPLIER_BOT_INGESTION_ENABLED = originalEnabled;
    if (originalSecret === undefined) delete process.env.EVENTFLOW_BOT_HMAC_SECRET;
    else process.env.EVENTFLOW_BOT_HMAC_SECRET = originalSecret;
  });

  it('accepts a fresh correctly signed request', () => {
    const secret = 'a'.repeat(48);
    const body = payload();
    const timestamp = String(Date.now());
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'true';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = secret;
    const headers = {
      'x-eventflow-bot-timestamp': timestamp,
      'x-eventflow-bot-signature': `sha256=${signatureFor(secret, timestamp, JSON.stringify(body))}`,
    };
    const req = { body, get: name => headers[name.toLowerCase()] || '' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    verifySupplierBotHmac(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('fails closed while ingestion is disabled', () => {
    process.env.SUPPLIER_BOT_INGESTION_ENABLED = 'false';
    process.env.EVENTFLOW_BOT_HMAC_SECRET = 'a'.repeat(48);
    const req = { body: payload(), get: () => '' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    verifySupplierBotHmac(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
