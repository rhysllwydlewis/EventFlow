/**
 * Automatic publication of UK city × category pages.
 */

'use strict';

const {
  MIN_SUPPLIERS_TO_PUBLISH_CATEGORY,
  promoteEligibleCategories,
} = require('../../services/locationAutoPublish.service');
const { PUBLICATION_STATES } = require('../../models/LocationContent');

/**
 * A public supplier record based in the given city and category.
 * @param {string} id Supplier id.
 * @param {string} citySlug City slug.
 * @param {string} category Supplier category.
 * @returns {Object} Supplier.
 */
function supplier(id, citySlug, category = 'Venues') {
  return {
    id,
    name: `Supplier ${id}`,
    category,
    approved: true,
    baseLocation: { citySlug },
  };
}

/**
 * An in-memory database double supporting the calls this service makes,
 * with `location_category_pages` matched on the composite key.
 * @param {Object} [seed] Seed data by collection.
 * @returns {Object} Fake database handle.
 */
function createDb(seed = {}) {
  const collections = {
    suppliers: seed.suppliers || [],
    users: seed.users || [],
    location_category_pages: (seed.location_category_pages || []).map(row => ({ ...row })),
    // A published city page by default: category auto-publish never launches
    // a category page ahead of the city page its breadcrumb links back to.
    location_pages:
      seed.location_pages ||
      [...new Set((seed.suppliers || []).map(item => item.baseLocation.citySlug))].map(
        citySlug => ({ locationSlug: citySlug, status: PUBLICATION_STATES.published })
      ),
  };

  return {
    collections,
    read: jest.fn(async name => collections[name] || []),
    updateOne: jest.fn(async (name, query, update) => {
      const row = collections[name].find(
        item => item.locationSlug === query.locationSlug && item.categorySlug === query.categorySlug
      );
      if (!row) {
        return false;
      }
      Object.assign(row, update);
      return true;
    }),
    insertOne: jest.fn(async (name, doc) => {
      collections[name].push({ ...doc });
      return doc;
    }),
    uid: () => `loccatpage_${Math.random().toString(36).slice(2)}`,
  };
}

describe('location category auto-publish', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    log.info.mockClear();
  });

  it('publishes a city × category combination that has never been touched once it has real coverage', async () => {
    const suppliers = Array.from({ length: MIN_SUPPLIERS_TO_PUBLISH_CATEGORY }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff', 'Venues')
    );
    const db = createDb({ suppliers });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).toContain('cardiff:venues');
    const stored = db.collections.location_category_pages.find(
      row => row.locationSlug === 'cardiff' && row.categorySlug === 'venues'
    );
    expect(stored.status).toBe(PUBLICATION_STATES.published);
    expect(stored.managedBy).toBe('automation');
    expect(stored.indexingRequested).toBe(false);
  });

  it('leaves a category below the supplier threshold untouched', async () => {
    const suppliers = Array.from(
      { length: MIN_SUPPLIERS_TO_PUBLISH_CATEGORY - 1 },
      (_unused, index) => supplier(`sup-${index}`, 'cardiff', 'Venues')
    );
    const db = createDb({ suppliers });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).not.toContain('cardiff:venues');
    expect(db.collections.location_category_pages).toHaveLength(0);
  });

  it('publishes one category and not another in the same city on its own inventory', async () => {
    const suppliers = [
      ...Array.from({ length: 3 }, (_unused, index) =>
        supplier(`venue-${index}`, 'cardiff', 'Venues')
      ),
      supplier('caterer-1', 'cardiff', 'Catering'),
    ];
    const db = createDb({ suppliers });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).toContain('cardiff:venues');
    expect(result.promotedKeys).not.toContain('cardiff:catering');
  });

  it('never touches a combination an admin has already saved, even a qualifying draft', async () => {
    const suppliers = Array.from({ length: 5 }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff', 'Venues')
    );
    const db = createDb({
      suppliers,
      location_category_pages: [
        {
          locationSlug: 'cardiff',
          categorySlug: 'venues',
          status: PUBLICATION_STATES.draft,
          managedBy: 'admin',
          content: { intro: 'A start, not yet published.' },
        },
      ],
    });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).not.toContain('cardiff:venues');
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('does not re-process or demote a combination it already published', async () => {
    const suppliers = [
      supplier('sup-1', 'cardiff', 'Venues'),
      supplier('sup-2', 'cardiff', 'Venues'),
    ];
    const db = createDb({
      suppliers,
      location_category_pages: [
        {
          locationSlug: 'cardiff',
          categorySlug: 'venues',
          status: PUBLICATION_STATES.published,
          managedBy: 'automation',
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).not.toContain('cardiff:venues');
    const stored = db.collections.location_category_pages.find(
      row => row.locationSlug === 'cardiff' && row.categorySlug === 'venues'
    );
    expect(stored.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never publishes a category page ahead of its own city page', async () => {
    const suppliers = Array.from({ length: MIN_SUPPLIERS_TO_PUBLISH_CATEGORY }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff', 'Venues')
    );
    const db = createDb({
      suppliers,
      location_pages: [{ locationSlug: 'cardiff', status: 'draft' }],
    });

    const result = await promoteEligibleCategories({ db, log });

    expect(result.promotedKeys).not.toContain('cardiff:venues');
    expect(db.collections.location_category_pages).toHaveLength(0);
  });
});
