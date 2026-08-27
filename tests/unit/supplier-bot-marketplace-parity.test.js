'use strict';

const seoEligibility = require('../../services/seoEligibility.service');
const {
  ensurePublishedUnclaimedMarketplaceState,
  reconcilePublishedUnclaimedMarketplaceState,
} = require('../../services/supplierBotMarketplaceParity.service');

function publishedSupplier(overrides = {}) {
  return {
    id: 'sup_bot_marketplace_1',
    slug: 'marketplace-venue',
    name: 'Marketplace Venue',
    category: 'Venues',
    location: 'Cardiff, South Wales',
    website: 'https://marketplace-venue.example/',
    ownershipStatus: 'unclaimed',
    approved: false,
    status: 'draft',
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'candidate_marketplace_1',
      publicationScope: 'public_unclaimed',
      publishedUnclaimedAt: '2026-08-27T18:00:00.000Z',
      sourcePackages: [
        {
          name: 'Wedding Package',
          price: 'From £2,500',
          features: ['Exclusive use', 'Wedding breakfast'],
        },
        {
          name: 'Evening Celebration',
          price: 'From £1,000',
          features: ['Evening room hire'],
        },
      ],
      sourceMedia: {
        coverImage: 'https://marketplace-venue.example/cover.jpg',
        images: ['https://marketplace-venue.example/one.jpg'],
      },
    },
    createdAt: '2026-08-27T17:00:00.000Z',
    updatedAt: '2026-08-27T17:00:00.000Z',
    ...overrides,
  };
}

function memoryDb(initialSuppliers = []) {
  const collections = {
    suppliers: initialSuppliers.map(item => structuredClone(item)),
    packages: [],
  };
  return {
    collections,
    async read(name) {
      return collections[name] || [];
    },
    async insertOne(name, item) {
      if (!collections[name]) collections[name] = [];
      collections[name].push(structuredClone(item));
      return item;
    },
    async updateOne(name, query, update) {
      const item = (collections[name] || []).find(entry => String(entry.id) === String(query.id));
      if (!item) return false;
      Object.assign(item, structuredClone(update.$set || {}));
      return true;
    },
  };
}

describe('published-unclaimed marketplace parity', () => {
  it('turns an explicitly published bot profile into a normal marketplace supplier with real packages', async () => {
    const supplier = publishedSupplier();
    const dbUnified = memoryDb([supplier]);

    const result = await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier });

    expect(result.supplier).toMatchObject({
      id: supplier.id,
      approved: true,
      status: 'active',
      approvedBy: 'supplier_bot_publication',
      ownershipStatus: 'unclaimed',
    });
    expect(dbUnified.collections.packages).toHaveLength(2);
    expect(dbUnified.collections.packages[0]).toMatchObject({
      supplierId: supplier.id,
      title: 'Wedding Package',
      approved: true,
      paused: false,
      priceDisplay: 'From £2,500',
      acquisition: {
        source: 'supplier_bot',
        candidateId: 'candidate_marketplace_1',
        managedWhileUnclaimed: true,
      },
    });
    expect(dbUnified.collections.packages[0].id).toMatch(/^pkg_bot_[a-f0-9]{24}$/);
    expect(dbUnified.collections.packages[0].slug).toMatch(/^wedding-package-[a-f0-9]{8}$/);
  });

  it('is idempotent and retires source packages that disappear on a later bot refresh', async () => {
    const supplier = publishedSupplier();
    const dbUnified = memoryDb([supplier]);
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier });
    const firstIds = dbUnified.collections.packages.map(pkg => pkg.id);

    const refreshed = {
      ...dbUnified.collections.suppliers[0],
      acquisition: {
        ...dbUnified.collections.suppliers[0].acquisition,
        sourcePackages: [dbUnified.collections.suppliers[0].acquisition.sourcePackages[0]],
      },
    };
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: refreshed });

    expect(dbUnified.collections.packages).toHaveLength(2);
    expect(dbUnified.collections.packages[0].id).toBe(firstIds[0]);
    expect(dbUnified.collections.packages[0].approved).toBe(true);
    expect(dbUnified.collections.packages[1]).toMatchObject({ approved: false, paused: true });
  });

  it('repairs previously published pilot records without Hensol-specific logic', async () => {
    const pilot = publishedSupplier({
      id: 'sup_bot_existing_pilot',
      name: 'Existing Pilot Venue',
      acquisition: {
        ...publishedSupplier().acquisition,
        candidateId: 'candidate_existing_pilot',
        publicationScope: 'pilot_unclaimed',
      },
    });
    const dbUnified = memoryDb([pilot]);

    const report = await reconcilePublishedUnclaimedMarketplaceState({
      dbUnified,
      logger: { error: jest.fn() },
    });

    expect(report.checked).toBe(1);
    expect(dbUnified.collections.suppliers[0].approved).toBe(true);
    expect(dbUnified.collections.packages.length).toBeGreaterThan(0);
  });

  it('leaves ordinary unpublished Supplier Bot drafts hidden', async () => {
    const draft = publishedSupplier({
      acquisition: {
        ...publishedSupplier().acquisition,
        publicationScope: undefined,
      },
    });
    const dbUnified = memoryDb([draft]);

    const result = await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: draft });

    expect(result.changed).toBe(false);
    expect(dbUnified.collections.suppliers[0].approved).toBe(false);
    expect(dbUnified.collections.packages).toHaveLength(0);
  });

  it('allows published-unclaimed suppliers in directory policy while keeping them noindex', () => {
    const supplier = publishedSupplier();

    expect(seoEligibility.canAppearInDirectory(supplier).eligible).toBe(true);
    const indexing = seoEligibility.canBeIndexed(supplier);
    expect(indexing.eligible).toBe(false);
    expect(indexing.reasons).toContain(seoEligibility.REASON_CODES.PUBLISHED_UNCLAIMED);
  });
});
