/**
 * Automatic publication of UK city pages.
 */

'use strict';

const {
  MIN_SUPPLIERS_TO_PUBLISH,
  logSchedulerStartup,
  promoteEligibleCities,
  scheduleAutoPublish,
} = require('../../services/locationAutoPublish.service');
const { PUBLICATION_STATES } = require('../../models/LocationContent');

/**
 * A public supplier record based in the given city.
 * @param {string} id Supplier id.
 * @param {string} citySlug City slug.
 * @returns {Object} Supplier.
 */
function supplier(id, citySlug) {
  return {
    id,
    name: `Supplier ${id}`,
    category: 'Venues',
    approved: true,
    baseLocation: { citySlug },
  };
}

/**
 * An in-memory database double supporting the calls this service makes.
 * @param {Object} [seed] Seed data by collection.
 * @returns {Object} Fake database handle.
 */
function createDb(seed = {}) {
  const collections = {
    suppliers: seed.suppliers || [],
    users: seed.users || [],
    location_pages: (seed.location_pages || []).map(row => ({ ...row })),
  };

  return {
    collections,
    read: jest.fn(async name => collections[name] || []),
    updateOne: jest.fn(async (name, query, update) => {
      const row = collections[name].find(item => item.locationSlug === query.locationSlug);
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
    uid: () => `locpage_${Math.random().toString(36).slice(2)}`,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('location auto-publish', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    log.info.mockClear();
    log.warn.mockClear();
    log.error.mockClear();
  });

  it('publishes a city that has never been touched once it has real coverage', async () => {
    const suppliers = Array.from({ length: MIN_SUPPLIERS_TO_PUBLISH }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff')
    );
    const db = createDb({ suppliers });

    const result = await promoteEligibleCities({ db, log });

    expect(result.promotedSlugs).toContain('cardiff');
    const stored = db.collections.location_pages.find(row => row.locationSlug === 'cardiff');
    expect(stored.status).toBe(PUBLICATION_STATES.published);
    expect(stored.managedBy).toBe('automation');
    expect(stored.indexingRequested).toBe(false);
  });

  it('never requests indexing on its own — a person still has to opt a city in', async () => {
    const suppliers = Array.from({ length: 8 }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff')
    );
    const db = createDb({ suppliers });

    await promoteEligibleCities({ db, log });

    const stored = db.collections.location_pages.find(row => row.locationSlug === 'cardiff');
    expect(stored.indexingRequested).toBe(false);
  });

  it('leaves a city below the supplier threshold untouched', async () => {
    const suppliers = Array.from({ length: MIN_SUPPLIERS_TO_PUBLISH - 1 }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff')
    );
    const db = createDb({ suppliers });

    const result = await promoteEligibleCities({ db, log });

    expect(result.promotedSlugs).not.toContain('cardiff');
    expect(db.collections.location_pages).toHaveLength(0);
  });

  it('never touches a city an admin has already saved, even a qualifying draft', async () => {
    const suppliers = Array.from({ length: 8 }, (_unused, index) =>
      supplier(`sup-${index}`, 'cardiff')
    );
    const db = createDb({
      suppliers,
      location_pages: [
        {
          locationSlug: 'cardiff',
          status: PUBLICATION_STATES.draft,
          managedBy: 'admin',
          content: { intro: 'A start, not yet published.' },
        },
      ],
    });

    const result = await promoteEligibleCities({ db, log });

    expect(result.promotedSlugs).not.toContain('cardiff');
    expect(db.updateOne).not.toHaveBeenCalled();
    const stored = db.collections.location_pages.find(row => row.locationSlug === 'cardiff');
    expect(stored.status).toBe(PUBLICATION_STATES.draft);
  });

  it('does not re-process or demote a city it already published', async () => {
    const suppliers = [supplier('sup-1', 'cardiff'), supplier('sup-2', 'cardiff')];
    const db = createDb({
      suppliers,
      location_pages: [
        {
          locationSlug: 'cardiff',
          status: PUBLICATION_STATES.published,
          managedBy: 'automation',
          publishedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await promoteEligibleCities({ db, log });

    expect(result.promotedSlugs).not.toContain('cardiff');
    const stored = db.collections.location_pages.find(row => row.locationSlug === 'cardiff');
    expect(stored.status).toBe(PUBLICATION_STATES.published);
    expect(stored.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('excludes unapproved and owner-orphaned suppliers from the coverage count', async () => {
    const suppliers = [
      supplier('sup-1', 'cardiff'),
      supplier('sup-2', 'cardiff'),
      { ...supplier('sup-3', 'cardiff'), approved: false },
      { ...supplier('sup-4', 'cardiff'), ownerUserId: 'missing-user' },
    ];
    const db = createDb({ suppliers });

    const result = await promoteEligibleCities({ db, log });

    expect(result.promotedSlugs).not.toContain('cardiff');
  });

  describe('scheduleAutoPublish', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnabled = process.env.LOCATION_AUTO_PUBLISH_ENABLED;
    const originalCron = process.env.LOCATION_AUTO_PUBLISH_CRON;

    afterEach(() => {
      restoreEnv('NODE_ENV', originalNodeEnv);
      restoreEnv('LOCATION_AUTO_PUBLISH_ENABLED', originalEnabled);
      restoreEnv('LOCATION_AUTO_PUBLISH_CRON', originalCron);
    });

    it('stays off outside production unless explicitly enabled', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.LOCATION_AUTO_PUBLISH_ENABLED;

      const result = scheduleAutoPublish({ log });
      expect(result.scheduled).toBe(false);
    });

    it('schedules with the configured cron when enabled', () => {
      process.env.LOCATION_AUTO_PUBLISH_ENABLED = 'true';
      process.env.LOCATION_AUTO_PUBLISH_CRON = '0 4 * * *';
      const job = { nextInvocation: () => new Date('2026-01-02T04:00:00.000Z') };
      const scheduleModule = { scheduleJob: jest.fn(() => job) };

      const result = scheduleAutoPublish({ log, scheduleModule });

      expect(result.scheduled).toBe(true);
      expect(result.cronExpr).toBe('0 4 * * *');
      expect(scheduleModule.scheduleJob).toHaveBeenCalledWith('0 4 * * *', expect.any(Function));
    });

    it('reports a scheduling failure for an invalid cron rather than throwing', () => {
      process.env.LOCATION_AUTO_PUBLISH_ENABLED = 'true';
      const scheduleModule = { scheduleJob: jest.fn(() => null) };

      const result = scheduleAutoPublish({ log, scheduleModule });

      expect(result.scheduled).toBe(false);
    });
  });

  describe('logSchedulerStartup', () => {
    const originalEnabled = process.env.LOCATION_AUTO_PUBLISH_ENABLED;
    const originalCron = process.env.LOCATION_AUTO_PUBLISH_CRON;

    afterEach(() => {
      restoreEnv('LOCATION_AUTO_PUBLISH_ENABLED', originalEnabled);
      restoreEnv('LOCATION_AUTO_PUBLISH_CRON', originalCron);
    });

    it('logs the schedule and next run when scheduling succeeds', () => {
      process.env.LOCATION_AUTO_PUBLISH_ENABLED = 'true';
      process.env.LOCATION_AUTO_PUBLISH_CRON = '0 4 * * *';
      const job = { nextInvocation: () => new Date('2026-01-02T04:00:00.000Z') };
      const scheduleModule = { scheduleJob: jest.fn(() => job) };

      const result = logSchedulerStartup({ log, scheduleModule });

      expect(result.scheduled).toBe(true);
      expect(log.info).toHaveBeenCalledWith('   ✅ Location auto-publish scheduled');
      expect(log.info).toHaveBeenCalledWith('   ✅ Cron: 0 4 * * *');
      expect(log.info).toHaveBeenCalledWith('   ⏰ Next run: 2026-01-02T04:00:00.000Z');
    });

    it('tells an operator how to enable it when the scheduler is off', () => {
      process.env.LOCATION_AUTO_PUBLISH_ENABLED = 'false';

      const result = logSchedulerStartup({ log });

      expect(result.scheduled).toBe(false);
      expect(log.info).toHaveBeenCalledWith('   ℹ️  Location auto-publish scheduler disabled');
      expect(log.info).toHaveBeenCalledWith('   Set LOCATION_AUTO_PUBLISH_ENABLED=true to enable');
    });
  });
});
