'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const secret = 'pilot-route-test-secret'.repeat(3);

function payload(overrides = {}) {
  return {
    candidateId: 'candidate_pilot_1',
    businessName: 'Pilot Venue',
    category: 'Venues',
    location: 'South Wales',
    website: 'https://pilot-venue.example/',
    description: 'Independent EventFlow pilot summary.',
    publicEmail: '',
    publicPhone: '',
    services: ['Weddings'],
    packages: [],
    advertisedPrices: ['From £2,500'],
    publicationQuality: 91,
    dataConfidence: 88,
    complianceStatus: 'pass',
    compliancePolicyVersion: 'shadow-compliance-v1',
    generatedAt: '2026-08-27T12:00:00.000Z',
    generatorVersion: 'pilot-test-v1',
    publicationScope: 'pilot_unclaimed',
    ...overrides,
  };
}

function duplicateKeyError() {
  const error = new Error('duplicate key');
  error.code = 11000;
  return error;
}

function memoryDb(seed = [], options = {}) {
  const suppliers = seed.map(item => ({ ...item }));
  const pilotSlots = (options.pilotSlots || []).map(item => ({ ...item }));
  return {
    suppliers,
    pilotSlots,
    async read(name) {
      if (name === 'suppliers') {
        return suppliers;
      }
      if (name === 'supplier_bot_pilot_slots') {
        return pilotSlots;
      }
      return [];
    },
    async insertOne(name, item) {
      if (name === 'suppliers') {
        suppliers.push(item);
        return item;
      }
      if (name === 'supplier_bot_pilot_slots') {
        if (pilotSlots.some(slot => slot._id === item._id)) {
          throw duplicateKeyError();
        }
        pilotSlots.push(item);
        return item;
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async updateOne(name, query, update) {
      if (name === 'suppliers') {
        const supplier = suppliers.find(item => item.id === query.id);
        if (!supplier) {
          return false;
        }
        Object.assign(supplier, update.$set || {});
        return true;
      }
      if (name === 'supplier_bot_pilot_slots') {
        const slot = pilotSlots.find(
          item =>
            (!query._id || item._id === query._id) &&
            (!query.candidateId || item.candidateId === query.candidateId)
        );
        if (!slot) {
          return false;
        }
        Object.assign(slot, update.$set || {});
        return true;
      }
      return false;
    },
  };
}

function createApp(dbUnified, logger = { error: jest.fn(), warn: jest.fn() }) {
  supplierProfileSafeRouter.initializeDependencies({ dbUnified, logger });
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

describe('one-profile Supplier Bot ingestion pilot', () => {
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

  it('marks one explicit pilot profile and remains idempotent for the same candidate', async () => {
    const dbUnified = memoryDb();
    const app = createApp(dbUnified);
    const body = payload();

    const created = await postSupplier(app, body);
    const repeated = await postSupplier(app, body);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      ownershipStatus: 'unclaimed',
      publicationScope: 'pilot_unclaimed',
      created: true,
    });
    expect(created.body.publicProfilePath).toMatch(/^\/supplier\/pilot-venue--[a-f0-9]{16}$/);
    expect(dbUnified.suppliers).toHaveLength(1);
    expect(dbUnified.suppliers[0].acquisition).toMatchObject({
      source: 'supplier_bot',
      candidateId: 'candidate_pilot_1',
      publicationScope: 'pilot_unclaimed',
    });
    expect(dbUnified.suppliers[0].acquisition.pilotPublishedAt).toEqual(expect.any(String));
    expect(dbUnified.pilotSlots).toHaveLength(1);
    expect(dbUnified.pilotSlots[0]).toMatchObject({
      candidateId: 'candidate_pilot_1',
      supplierId: dbUnified.suppliers[0].id,
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({
      publicationScope: 'pilot_unclaimed',
      created: false,
      idempotent: true,
    });
    expect(repeated.body.publicProfilePath).toBe(created.body.publicProfilePath);
  });

  it('rejects an unsupported publication scope before ingestion', async () => {
    const dbUnified = memoryDb();
    const response = await postSupplier(
      createApp(dbUnified),
      payload({ publicationScope: 'public_everywhere' })
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'publicationScope is unsupported' });
    expect(dbUnified.suppliers).toHaveLength(0);
    expect(dbUnified.pilotSlots).toHaveLength(0);
  });

  it('rejects a second pilot candidate before creating another supplier', async () => {
    const existing = {
      id: 'sup_existing_pilot',
      ownershipStatus: 'unclaimed',
      website: 'https://existing-pilot.example/',
      acquisition: {
        source: 'supplier_bot',
        candidateId: 'candidate_existing_pilot',
        publicationScope: 'pilot_unclaimed',
      },
    };
    const dbUnified = memoryDb([existing]);
    const response = await postSupplier(
      createApp(dbUnified),
      payload({
        candidateId: 'candidate_second_pilot',
        businessName: 'Second Pilot Venue',
        website: 'https://second-pilot.example/',
      })
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'The one-profile Supplier Bot pilot is already in use',
      existingSupplierId: 'sup_existing_pilot',
    });
    expect(dbUnified.suppliers).toHaveLength(1);
  });

  it('honours an atomically reserved pilot slot even before a supplier record exists', async () => {
    const dbUnified = memoryDb([], {
      pilotSlots: [
        {
          _id: 'supplier-bot-one-profile-pilot-v1',
          id: 'supplier-bot-one-profile-pilot-v1',
          candidateId: 'candidate_slot_winner',
          supplierId: 'sup_slot_winner',
        },
      ],
    });
    const response = await postSupplier(
      createApp(dbUnified),
      payload({
        candidateId: 'candidate_second_pilot',
        businessName: 'Second Pilot Venue',
        website: 'https://second-pilot.example/',
      })
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'The one-profile Supplier Bot pilot is already in use',
      existingSupplierId: 'sup_slot_winner',
    });
    expect(dbUnified.suppliers).toHaveLength(0);
    expect(dbUnified.pilotSlots).toHaveLength(1);
  });
});
