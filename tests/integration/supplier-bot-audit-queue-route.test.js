'use strict';

const express = require('express');
const request = require('supertest');
const { signatureFor } = require('../../middleware/supplierBotHmac');
const supplierProfileSafeRouter = require('../../routes/supplier-profile-safe');

const secret = 'repeatable-audit-queue-test-secret'.repeat(2);

function memoryDb({ suppliers = [], packages = [] } = {}) {
  return {
    async read(name) {
      if (name === 'suppliers') {
        return suppliers;
      }
      if (name === 'packages') {
        return packages;
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

async function auditQueue(app, body = {}) {
  const timestamp = String(Date.now());
  const signature = signatureFor(secret, timestamp, JSON.stringify(body));
  return request(app)
    .post('/internal/supplier-bot/suppliers/audit-queue')
    .set('x-eventflow-bot-timestamp', timestamp)
    .set('x-eventflow-bot-signature', `sha256=${signature}`)
    .send(body);
}

function publishedUnclaimedSupplier(overrides = {}) {
  return {
    id: 'sup_bot_1',
    name: 'Complete Photography Ltd',
    website: 'https://complete-photography.example/',
    slug: 'complete-photography-ltd',
    ownershipStatus: 'unclaimed',
    description: 'A well documented, genuinely thorough business description.',
    phone: '01234 567890',
    email: 'hello@complete-photography.example',
    tags: ['photography', 'weddings'],
    coverImage: 'https://complete-photography.example/cover.jpg',
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'cand_1',
      publicationScope: 'public_unclaimed',
      publishedUnclaimedAt: '2026-09-01T00:00:00.000Z',
      sourceMedia: {
        coverImage: 'https://complete-photography.example/cover.jpg',
        images: ['https://complete-photography.example/gallery-1.jpg'],
      },
    },
    ...overrides,
  };
}

describe('Supplier Bot unclaimed-profile quality audit queue', () => {
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

  it('requires the same HMAC signature as every other Supplier Bot route', async () => {
    const app = createApp(memoryDb());
    const timestamp = String(Date.now());

    const response = await request(app)
      .post('/internal/supplier-bot/suppliers/audit-queue')
      .set('x-eventflow-bot-timestamp', timestamp)
      .set(
        'x-eventflow-bot-signature',
        'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      )
      .send({});

    expect(response.status).toBe(401);
  });

  it('returns 503 when the database dependency is unavailable', async () => {
    const app = createApp(null);

    const response = await auditQueue(app);

    expect(response.status).toBe(503);
  });

  it('excludes a fully complete profile from the queue entirely', async () => {
    const dbUnified = memoryDb({
      suppliers: [publishedUnclaimedSupplier()],
      packages: [
        {
          id: 'pkg_1',
          supplierId: 'sup_bot_1',
          title: 'Full Day Coverage',
          image: 'https://complete-photography.example/package-1.jpg',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.status).toBe(200);
    expect(response.body.totalPublished).toBe(1);
    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
  });

  it('flags missing cover image, missing gallery, thin description, missing contact/tags, and placeholder package photos', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({
          id: 'sup_bot_2',
          coverImage: '',
          description: 'Too short',
          phone: '',
          email: '',
          tags: [],
          acquisition: {
            source: 'supplier_bot',
            candidateId: 'cand_2',
            publicationScope: 'public_unclaimed',
            publishedUnclaimedAt: '2026-09-02T00:00:00.000Z',
            sourceMedia: { coverImage: '', images: [] },
          },
        }),
      ],
      packages: [
        {
          id: 'pkg_2',
          supplierId: 'sup_bot_2',
          title: 'Half Day Coverage',
          image: '',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.status).toBe(200);
    expect(response.body.totalNeedingWork).toBe(1);
    const [entry] = response.body.queue;
    expect(entry.supplierId).toBe('sup_bot_2');
    expect(entry.gaps).toMatchObject({
      missingCoverImage: true,
      missingGalleryImages: true,
      missingDescription: true,
      missingPhone: true,
      missingEmail: true,
      missingTags: true,
    });
    expect(entry.gaps.packagesMissingPhotos).toEqual([{ id: 'pkg_2', title: 'Half Day Coverage' }]);
    expect(entry.completenessScore).toBe(0);
  });

  it('ignores non-published and non-bot suppliers, and packages that belong to other suppliers or sources', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        // Never published (no publicationScope) -- not the bot's job to fix.
        publishedUnclaimedSupplier({
          id: 'sup_unpublished',
          acquisition: { source: 'supplier_bot', candidateId: 'cand_3', sourceMedia: {} },
        }),
        // Claimed -- owner-managed now, out of scope entirely.
        { id: 'sup_claimed', ownershipStatus: 'claimed', website: 'https://claimed.example/' },
      ],
      packages: [
        {
          id: 'pkg_other_supplier',
          supplierId: 'sup_other',
          image: '',
          acquisition: { source: 'supplier_bot' },
        },
        { id: 'pkg_manual', supplierId: 'sup_bot_1', image: '', acquisition: { source: 'manual' } },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.status).toBe(200);
    expect(response.body.totalPublished).toBe(0);
    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
  });

  it('sorts the worst profiles first and honours a capped custom limit', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({ id: 'sup_mild', description: 'Too short', slug: 'mild' }),
        publishedUnclaimedSupplier({
          id: 'sup_severe',
          coverImage: '',
          description: '',
          phone: '',
          email: '',
          tags: [],
          slug: 'severe',
          acquisition: {
            source: 'supplier_bot',
            candidateId: 'cand_severe',
            publicationScope: 'public_unclaimed',
            sourceMedia: { coverImage: '', images: [] },
          },
        }),
      ],
      packages: [],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app, { limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body.totalNeedingWork).toBe(2);
    expect(response.body.queue).toHaveLength(1);
    expect(response.body.queue[0].supplierId).toBe('sup_severe');
  });

  it('clamps an excessive requested limit to the server-side maximum instead of erroring', async () => {
    const suppliers = Array.from({ length: 3 }, (_, index) =>
      publishedUnclaimedSupplier({
        id: `sup_bulk_${index}`,
        slug: `bulk-${index}`,
        description: 'Too short',
      })
    );
    const dbUnified = memoryDb({ suppliers, packages: [] });
    const app = createApp(dbUnified);

    const response = await auditQueue(app, { limit: 9999 });

    expect(response.status).toBe(200);
    expect(response.body.queue).toHaveLength(3);
  });
});
