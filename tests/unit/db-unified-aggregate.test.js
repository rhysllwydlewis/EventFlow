'use strict';

/**
 * Unit tests for db-unified's local-store aggregate() fallback (processLocalAggregation).
 * $group/$sort/$limit/$project were added to support emailLog.service.js's
 * getSummary() running the same aggregation pipeline against either backend
 * instead of loading the whole collection into JS to count it by hand.
 */
describe('db-unified – aggregate() on local storage', () => {
  let dbUnified;
  let storeData;

  beforeEach(() => {
    jest.resetModules();
    storeData = {};
    const mockStore = {
      uid: jest.fn(p => `${p}_123`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    };
    jest.mock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.mock('../../store', () => mockStore);
    dbUnified = require('../../db-unified');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const seedLogs = async logs => {
    await dbUnified.initializeDatabase();
    storeData['email_logs'] = logs;
  };

  it('$group with $sum:1 counts documents per status', async () => {
    await seedLogs([
      { id: '1', status: 'sent' },
      { id: '2', status: 'sent' },
      { id: '3', status: 'bounced' },
    ]);

    const result = await dbUnified.aggregate('email_logs', [
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    expect(result).toEqual(
      expect.arrayContaining([
        { _id: 'sent', count: 2 },
        { _id: 'bounced', count: 1 },
      ])
    );
  });

  it('$match + $count reports how many documents matched a range filter', async () => {
    await seedLogs([
      { id: '1', createdAt: '2026-01-10T00:00:00.000Z' },
      { id: '2', createdAt: '2026-01-15T00:00:00.000Z' },
    ]);

    const result = await dbUnified.aggregate('email_logs', [
      { $match: { createdAt: { $gte: '2026-01-12T00:00:00.000Z' } } },
      { $count: 'count' },
    ]);

    expect(result).toEqual([{ count: 1 }]);
  });

  it('$sort + $limit + $project returns the single most-recent field value', async () => {
    await seedLogs([
      { id: '1', lastEventAt: '2026-01-10T00:00:00.000Z' },
      { id: '2', lastEventAt: '2026-01-20T00:00:00.000Z' },
      { id: '3', lastEventAt: null },
    ]);

    const result = await dbUnified.aggregate('email_logs', [
      { $match: { lastEventAt: { $ne: null } } },
      { $sort: { lastEventAt: -1 } },
      { $limit: 1 },
      { $project: { lastEventAt: 1 } },
    ]);

    expect(result).toEqual([{ lastEventAt: '2026-01-20T00:00:00.000Z' }]);
  });

  it('$count on an empty collection returns a single zero-count document', async () => {
    await seedLogs([]);

    const result = await dbUnified.aggregate('email_logs', [{ $count: 'count' }]);

    expect(result).toEqual([{ count: 0 }]);
  });

  it('$project keeps _id by default, matching real MongoDB, unless the spec excludes it', async () => {
    await seedLogs([{ id: '1', _id: 'mongo-oid-1', lastEventAt: '2026-01-20T00:00:00.000Z' }]);

    const kept = await dbUnified.aggregate('email_logs', [{ $project: { lastEventAt: 1 } }]);
    expect(kept).toEqual([{ _id: 'mongo-oid-1', lastEventAt: '2026-01-20T00:00:00.000Z' }]);

    const excluded = await dbUnified.aggregate('email_logs', [
      { $project: { _id: 0, lastEventAt: 1 } },
    ]);
    expect(excluded).toEqual([{ lastEventAt: '2026-01-20T00:00:00.000Z' }]);
  });
});
