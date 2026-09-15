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
      missingTags: true,
    });
    expect(entry.gaps.packagesMissingPhotos).toEqual([{ id: 'pkg_2', title: 'Half Day Coverage' }]);
    expect(entry.gaps).not.toHaveProperty('missingEmail');
    expect(entry.completenessScore).toBe(0);
  });

  it('never scores email as a gap -- it is never shown on the public unclaimed profile', async () => {
    // Even a profile that is otherwise perfect but has no email on record
    // must not be penalised: only an "Email verified" badge is ever public,
    // and this routine cannot produce that verification via re-crawling.
    const dbUnified = memoryDb({
      suppliers: [publishedUnclaimedSupplier({ id: 'sup_no_email', email: '', slug: 'no-email' })],
      packages: [
        {
          id: 'pkg_1',
          supplierId: 'sup_no_email',
          title: 'Full Day Coverage',
          image: 'https://complete-photography.example/package-1.jpg',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
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

  it('excludes a retired (unapproved) package from the photo gap instead of letting it block the supplier forever', async () => {
    const dbUnified = memoryDb({
      suppliers: [publishedUnclaimedSupplier()],
      packages: [
        {
          id: 'pkg_retired',
          supplierId: 'sup_bot_1',
          title: 'Old Package',
          image: '',
          approved: false,
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
  });

  it('resolves a package image through gallery/images fallbacks instead of only the raw image field', async () => {
    const dbUnified = memoryDb({
      suppliers: [publishedUnclaimedSupplier()],
      packages: [
        {
          id: 'pkg_gallery_fallback',
          supplierId: 'sup_bot_1',
          title: 'Has Gallery Photo',
          image: '',
          gallery: [{ url: 'https://complete-photography.example/gallery-package.jpg' }],
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
  });

  it('treats an unusable phone value (fails public safePhone validation) as missing', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({ id: 'sup_bad_phone', phone: 'N/A', slug: 'bad-phone' }),
      ],
      packages: [
        {
          id: 'pkg_1',
          supplierId: 'sup_bad_phone',
          title: 'Full Day Coverage',
          image: 'https://complete-photography.example/package-1.jpg',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(1);
    expect(response.body.queue[0].gaps.missingPhone).toBe(true);
  });

  it('reads the gallery from canonical images/photosGallery fields, not only acquisition.sourceMedia', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({
          id: 'sup_canonical_gallery',
          slug: 'canonical-gallery',
          images: ['https://complete-photography.example/canonical-1.jpg'],
          acquisition: {
            source: 'supplier_bot',
            candidateId: 'cand_canonical',
            publicationScope: 'public_unclaimed',
            sourceMedia: {
              coverImage: 'https://complete-photography.example/cover.jpg',
              images: [],
            },
          },
        }),
      ],
      packages: [
        {
          id: 'pkg_1',
          supplierId: 'sup_canonical_gallery',
          title: 'Full Day Coverage',
          image: 'https://complete-photography.example/package-1.jpg',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(0);
    expect(response.body.queue).toEqual([]);
  });

  it('flags every sourcePackages evidence card as a photo gap when no package has been materialised yet', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({
          id: 'sup_pending_reconciliation',
          slug: 'pending-reconciliation',
          acquisition: {
            source: 'supplier_bot',
            candidateId: 'cand_pending',
            publicationScope: 'public_unclaimed',
            sourceMedia: {
              coverImage: 'https://complete-photography.example/cover.jpg',
              images: ['https://complete-photography.example/gallery-1.jpg'],
            },
            sourcePackages: [{ name: 'Full Day Coverage', price: '£1,200' }],
          },
        }),
      ],
      packages: [],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(1);
    expect(response.body.queue[0].gaps.packagesMissingPhotos).toEqual([
      { id: 'supplier-bot-package-1', title: 'Full Day Coverage' },
    ]);
  });

  it('groups a legacy package stored under supplier_id (not supplierId) with its owning supplier', async () => {
    const dbUnified = memoryDb({
      suppliers: [publishedUnclaimedSupplier({ id: 'sup_legacy', slug: 'legacy' })],
      packages: [
        {
          id: 'pkg_legacy',
          supplier_id: 'sup_legacy',
          title: 'Legacy Package',
          image: '',
          acquisition: { source: 'supplier_bot' },
        },
      ],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app);

    expect(response.body.totalNeedingWork).toBe(1);
    expect(response.body.queue[0].gaps.packagesMissingPhotos).toEqual([
      { id: 'pkg_legacy', title: 'Legacy Package' },
    ]);
  });

  it('excludes supplier ids the caller already attempted this run via excludeSupplierIds', async () => {
    const dbUnified = memoryDb({
      suppliers: [
        publishedUnclaimedSupplier({ id: 'sup_a', slug: 'a', description: 'Too short' }),
        publishedUnclaimedSupplier({ id: 'sup_b', slug: 'b', description: 'Too short' }),
      ],
      packages: [],
    });
    const app = createApp(dbUnified);

    const response = await auditQueue(app, { excludeSupplierIds: ['sup_a'] });

    expect(response.status).toBe(200);
    expect(response.body.totalPublished).toBe(1);
    expect(response.body.queue.map(item => item.supplierId)).toEqual(['sup_b']);
  });
});
