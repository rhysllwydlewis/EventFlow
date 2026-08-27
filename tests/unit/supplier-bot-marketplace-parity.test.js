'use strict';

const seoEligibility = require('../../services/seoEligibility.service');
const {
  ensurePublishedUnclaimedMarketplaceState,
  reconcilePublishedUnclaimedMarketplaceState,
  sourcePackageRecords,
} = require('../../services/supplierBotMarketplaceParity.service');

function sourcePackage(overrides = {}) {
  return {
    name: 'Wedding Package',
    price: 'From £2,500',
    priceDisplay: 'From £2,500',
    kind: 'advertised_package',
    features: ['Exclusive use', 'Wedding breakfast'],
    evidenceIds: ['evidence_package_1'],
    sourceUrl: 'https://marketplace-venue.example/packages',
    sourceObservedAt: '2026-08-27T18:30:00.000Z',
    sourceContentHash: 'a'.repeat(64),
    extractionConfidence: 93,
    priceDetails: {
      currency: 'GBP',
      amount: 2500,
      maxAmount: null,
      qualifier: 'from',
      unit: 'total',
      vatStatus: 'unspecified',
    },
    ...overrides,
  };
}

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
      refreshedAt: '2026-08-27T18:45:00.000Z',
      sourcePackages: [
        sourcePackage(),
        sourcePackage({
          name: 'Evening Celebration',
          price: '£1,000',
          priceDisplay: '£1,000',
          kind: 'priced_service',
          features: ['Evening room hire'],
          evidenceIds: ['evidence_package_2'],
          sourceUrl: 'https://marketplace-venue.example/evening-events',
          sourceContentHash: 'b'.repeat(64),
          extractionConfidence: 88,
          priceDetails: {
            currency: 'GBP',
            amount: 1000,
            maxAmount: null,
            qualifier: 'fixed',
            unit: 'total',
            vatStatus: 'unspecified',
          },
        }),
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
  it('turns only strongly evidenced bot packages into normal marketplace packages', async () => {
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
      priceDetails: {
        currency: 'GBP',
        amount: 2500,
        qualifier: 'from',
      },
      acquisition: {
        source: 'supplier_bot',
        candidateId: 'candidate_marketplace_1',
        managedWhileUnclaimed: true,
        sourcePackageKind: 'advertised_package',
        sourceUrl: 'https://marketplace-venue.example/packages',
        extractionConfidence: 93,
        missingCount: 0,
      },
    });
    expect(dbUnified.collections.packages[0].id).toMatch(/^pkg_bot_[a-f0-9]{24}$/);
    expect(dbUnified.collections.packages[0].slug).toMatch(/^wedding-package-[a-f0-9]{8}$/);
  });

  it('does not materialise legacy, unpriced or weak package data', () => {
    const supplier = publishedSupplier({
      acquisition: {
        ...publishedSupplier().acquisition,
        sourcePackages: [
          { name: 'Legacy package', price: '£500', features: ['Thing'] },
          sourcePackage({ name: 'No price', price: '', priceDisplay: '' }),
          sourcePackage({ name: 'Low confidence', extractionConfidence: 60 }),
          sourcePackage({ name: 'Missing evidence', evidenceIds: [] }),
        ],
      },
    });

    expect(sourcePackageRecords(supplier)).toEqual([]);
  });

  it('requires two distinct successful source refreshes before retiring a missing package', async () => {
    const supplier = publishedSupplier();
    const dbUnified = memoryDb([supplier]);
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier });
    const firstIds = dbUnified.collections.packages.map(pkg => pkg.id);

    const firstMissingRefresh = {
      ...dbUnified.collections.suppliers[0],
      acquisition: {
        ...dbUnified.collections.suppliers[0].acquisition,
        refreshedAt: '2026-08-28T09:00:00.000Z',
        sourcePackages: [dbUnified.collections.suppliers[0].acquisition.sourcePackages[0]],
      },
    };
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: firstMissingRefresh });

    expect(dbUnified.collections.packages).toHaveLength(2);
    expect(dbUnified.collections.packages[0].id).toBe(firstIds[0]);
    expect(dbUnified.collections.packages[1]).toMatchObject({
      approved: true,
      paused: false,
      acquisition: { missingCount: 1 },
    });

    // Reconciliation of the same source snapshot must not count as another miss.
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: firstMissingRefresh });
    expect(dbUnified.collections.packages[1]).toMatchObject({
      approved: true,
      acquisition: { missingCount: 1 },
    });

    const secondMissingRefresh = {
      ...firstMissingRefresh,
      acquisition: {
        ...firstMissingRefresh.acquisition,
        refreshedAt: '2026-08-29T09:00:00.000Z',
      },
    };
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: secondMissingRefresh });
    expect(dbUnified.collections.packages[1]).toMatchObject({
      approved: false,
      paused: true,
      acquisition: { missingCount: 2 },
    });
  });

  it('restores a package cleanly if it reappears after one missing refresh', async () => {
    const supplier = publishedSupplier();
    const dbUnified = memoryDb([supplier]);
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier });

    const onePackage = {
      ...supplier,
      acquisition: {
        ...supplier.acquisition,
        refreshedAt: '2026-08-28T09:00:00.000Z',
        sourcePackages: [supplier.acquisition.sourcePackages[0]],
      },
    };
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: onePackage });
    expect(dbUnified.collections.packages[1].acquisition.missingCount).toBe(1);

    const restored = {
      ...supplier,
      acquisition: {
        ...supplier.acquisition,
        refreshedAt: '2026-08-29T09:00:00.000Z',
      },
    };
    await ensurePublishedUnclaimedMarketplaceState({ dbUnified, supplier: restored });
    expect(dbUnified.collections.packages[1]).toMatchObject({
      approved: true,
      paused: false,
      acquisition: { missingCount: 0, missingSince: null },
    });
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
