'use strict';

/**
 * The public review list and rating figures show a review when its own moderation approves it,
 * whichever of the two storage schemes wrote it. A review approved under the newer scheme used to
 * be invisible on the supplier's public page (it has no `approved` flag), while the supplier's
 * own dashboard counted it.
 */

const mockStore = { reviews: [], suppliers: [] };

jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => mockStore[name] || []),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
}));
jest.mock('../../store', () => ({ uid: jest.fn(prefix => `${prefix}_x`) }));

const reviews = require('../../reviews');

const legacyApproved = {
  id: 'legacy-ok',
  supplierId: 'sup-1',
  userId: 'cust-1',
  userName: 'Sam T.',
  rating: 4,
  title: 'Great',
  comment: 'Older form review.',
  approved: true,
  approvedBy: 'system',
  ipAddress: '10.0.0.1',
  createdAt: '2026-05-01T12:00:00.000Z',
};
const legacyPending = {
  ...legacyApproved,
  id: 'legacy-pending',
  approved: false,
  approvedBy: null,
};
const v2Approved = {
  _id: 'v2-ok',
  supplierId: 'sup-1',
  authorId: 'cust-2',
  authorName: 'Dana V.',
  rating: 5,
  title: 'Perfect',
  text: 'Newer scheme review.',
  moderation: { state: 'approved', moderatorId: 'mod-1', notes: 'internal note' },
  verification: { status: 'verified' },
  response: { text: 'Thank you Dana', respondedAt: '2026-06-02T12:00:00.000Z' },
  createdAt: '2026-06-01T12:00:00.000Z',
};
const v2Pending = { ...v2Approved, _id: 'v2-pending', moderation: { state: 'pending' } };
const v2Rejected = { ...v2Approved, _id: 'v2-rejected', moderation: { state: 'rejected' } };
const otherSupplier = { ...v2Approved, _id: 'v2-other', supplierId: 'sup-2' };

beforeEach(() => {
  mockStore.suppliers = [];
  mockStore.reviews = [
    legacyApproved,
    legacyPending,
    v2Approved,
    v2Pending,
    v2Rejected,
    otherSupplier,
  ];
});

describe('getSupplierReviews', () => {
  it('lists every approved review of the supplier, newest first, from either scheme', async () => {
    const { reviews: listed, pagination } = await reviews.getSupplierReviews('sup-1');
    expect(listed.map(r => r.id)).toEqual(['v2-ok', 'legacy-ok']);
    expect(pagination.total).toBe(2);
  });

  it('shows a newer-scheme review under the names the public page reads', async () => {
    const { reviews: listed } = await reviews.getSupplierReviews('sup-1');
    expect(listed[0]).toMatchObject({
      userName: 'Dana V.',
      comment: 'Newer scheme review.',
      title: 'Perfect',
      rating: 5,
      verified: true,
      supplierResponse: { text: 'Thank you Dana' },
    });
  });

  it('never exposes moderation internals, IP data or the raw moderation object', async () => {
    const { reviews: listed } = await reviews.getSupplierReviews('sup-1');
    const text = JSON.stringify(listed);
    expect(text).not.toContain('internal note');
    expect(text).not.toContain('moderatorId');
    expect(text).not.toContain('10.0.0.1');
    expect(text).not.toContain('approvedBy');
    expect(listed.every(r => !('moderation' in r))).toBe(true);
  });

  it('does not list pending or rejected reviews of either scheme', async () => {
    const { reviews: listed } = await reviews.getSupplierReviews('sup-1');
    const ids = listed.map(r => r.id);
    expect(ids).not.toContain('legacy-pending');
    expect(ids).not.toContain('v2-pending');
    expect(ids).not.toContain('v2-rejected');
  });

  it('does not mark a pending newer-scheme review as approved when unapproved ones are asked for', async () => {
    const { reviews: listed } = await reviews.getSupplierReviews('sup-1', { approvedOnly: false });
    const byId = Object.fromEntries(listed.map(r => [r.id, r.approved]));
    expect(byId['v2-ok']).toBe(true);
    expect(byId['v2-pending']).toBe(false);
    expect(byId['v2-rejected']).toBe(false);
  });

  it('filters by rating and by verified across both schemes', async () => {
    const high = await reviews.getSupplierReviews('sup-1', { minRating: 5 });
    expect(high.reviews.map(r => r.id)).toEqual(['v2-ok']);
    const verified = await reviews.getSupplierReviews('sup-1', { verifiedOnly: true });
    expect(verified.reviews.map(r => r.id)).toEqual(['v2-ok']);
  });

  it('sorts by helpfulness without choking on a review that has no count', async () => {
    const { reviews: listed } = await reviews.getSupplierReviews('sup-1', { sortBy: 'helpful' });
    expect(listed).toHaveLength(2);
  });
});

describe('rating figures', () => {
  it('count approved reviews of both schemes', async () => {
    const { distribution, total, average } = await reviews.getRatingDistribution('sup-1');
    expect(total).toBe(2);
    expect(distribution[4]).toBe(1);
    expect(distribution[5]).toBe(1);
    expect(average).toBeCloseTo(4.5, 5);
  });
});
