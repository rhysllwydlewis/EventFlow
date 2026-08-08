'use strict';

const NotificationService = require('../../services/notification.service');

function makeCollection() {
  return {
    find: jest.fn(() => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({ toArray: async () => [] }),
        }),
      }),
    })),
    countDocuments: jest.fn(async () => 0),
    deleteMany: jest.fn(async () => ({ deletedCount: 4 })),
  };
}

function makeService() {
  const collection = makeCollection();
  const db = { collection: jest.fn(() => collection) };
  const svc = new NotificationService(db, null);
  return { svc, collection };
}

describe('NotificationService — category exclusion', () => {
  it('getForUser excludes the given categories from both the list and unread-count queries', async () => {
    const { svc, collection } = makeService();

    await svc.getForUser('user-1', { excludeCategories: ['admin'] });

    // First call powers the list query, second powers unreadCount.
    const [listQuery] = collection.countDocuments.mock.calls[0];
    const [unreadQuery] = collection.countDocuments.mock.calls[1];

    expect(listQuery.$and).toContainEqual({ category: { $nin: ['admin'] } });
    expect(unreadQuery.$and).toContainEqual({ category: { $nin: ['admin'] } });
  });

  it('getForUser omits the category filter when excludeCategories is not provided', async () => {
    const { svc, collection } = makeService();

    await svc.getForUser('user-1', {});

    const [listQuery] = collection.countDocuments.mock.calls[0];
    expect(listQuery.$and.some(cond => 'category' in cond)).toBe(false);
  });

  it('getUnreadCount excludes the given categories', async () => {
    const { svc, collection } = makeService();

    await svc.getUnreadCount('user-1', { excludeCategories: ['admin'] });

    const [query] = collection.countDocuments.mock.calls[0];
    expect(query.$and).toContainEqual({ category: { $nin: ['admin'] } });
  });

  it('getUnreadCount omits the category filter when no options are passed', async () => {
    const { svc, collection } = makeService();

    await svc.getUnreadCount('user-1');

    const [query] = collection.countDocuments.mock.calls[0];
    expect(query.$and.some(cond => 'category' in cond)).toBe(false);
  });
});

describe('NotificationService — cleanupStale', () => {
  it('deletes read notifications past the read-retention window and any notification past the max-age window', async () => {
    const { svc, collection } = makeService();

    const deleted = await svc.cleanupStale({ readRetentionDays: 30, maxAgeDays: 180 });

    expect(deleted).toBe(4);
    expect(collection.deleteMany).toHaveBeenCalledTimes(1);
    const [filter] = collection.deleteMany.mock.calls[0];
    expect(filter.$or).toHaveLength(2);
    const [readClause, ageClause] = filter.$or;
    expect(readClause).toMatchObject({ isRead: true });
    expect(readClause.readAt.$lte).toEqual(expect.any(String));
    expect(ageClause.createdAt.$lte).toEqual(expect.any(String));

    // Read-retention cutoff must be more recent than the max-age cutoff for
    // sane defaults (30 days ago is after 180 days ago).
    expect(new Date(readClause.readAt.$lte).getTime()).toBeGreaterThan(
      new Date(ageClause.createdAt.$lte).getTime()
    );
  });

  it('falls back to sane defaults when called with no arguments', async () => {
    const { svc, collection } = makeService();

    await svc.cleanupStale();

    expect(collection.deleteMany).toHaveBeenCalledTimes(1);
  });
});
