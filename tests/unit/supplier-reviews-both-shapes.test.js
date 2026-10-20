'use strict';

/**
 * Two writers put reviews in the same collection: the v2 service (moderation.state,
 * text, response) and the live public form (approved/flagged, comment, userName).
 * Every dashboard reader must treat both the same way, without ever counting or
 * showing a review that is not published.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
  requireVerifiedUser: (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');
const {
  reviewState,
  isApprovedReview,
  reviewRating,
  normaliseReview,
  reviewHasId,
} = require('../../utils/reviewShape');
const { summariseReviews } = require('../../services/supplierDashboardSummary');

const SUPPLIER_USER = { id: 'user-1', role: 'supplier' };
const OTHER_USER = { id: 'user-2', role: 'supplier' };

const LEGACY_APPROVED = {
  id: 'rev_legacy_ok',
  supplierId: 'sup-1',
  userId: 'cust-1',
  userName: 'Alice Customer',
  rating: 5,
  title: 'Brilliant',
  comment: 'Played all night and the dance floor was full.',
  approved: true,
  approvedBy: 'system',
  flagged: false,
  verified: true,
  emailVerified: true,
  ipAddress: 'hashed-ip',
  userAgent: 'Mozilla/5.0',
  flagReason: [],
  createdAt: '2026-07-01T10:00:00.000Z',
};
const LEGACY_PENDING = {
  id: 'rev_legacy_pending',
  supplierId: 'sup-1',
  userId: 'cust-2',
  userName: 'Spam Bot',
  rating: 1,
  comment: 'buy cheap watches',
  approved: false,
  flagged: true,
  approvedBy: null,
  createdAt: '2026-07-02T10:00:00.000Z',
};
const LEGACY_REJECTED = {
  id: 'rev_legacy_rejected',
  supplierId: 'sup-1',
  userId: 'cust-3',
  userName: 'Rejected Person',
  rating: 1,
  comment: 'rejected by a moderator',
  approved: false,
  flagged: true,
  approvedBy: 'admin-1',
  createdAt: '2026-07-03T10:00:00.000Z',
};
const V2_APPROVED = {
  _id: 'rev_v2_ok',
  supplierId: 'sup-1',
  authorId: 'cust-4',
  rating: 4,
  title: 'Great',
  text: 'Very professional and on time.',
  verification: { status: 'verified_booking' },
  moderation: { state: 'approved', reason: 'internal reason', moderatorId: 'system' },
  response: {
    supplierId: 'sup-1',
    text: 'Thank you, it was a pleasure.',
    respondedAt: '2026-07-05T10:00:00.000Z',
  },
  votes: { helpful: 2, unhelpful: 0, voters: ['x'] },
  createdAt: '2026-07-04T10:00:00.000Z',
};
const V2_PENDING = {
  _id: 'rev_v2_pending',
  supplierId: 'sup-1',
  authorId: 'cust-5',
  rating: 2,
  text: 'Waiting for moderation here.',
  verification: { status: 'unverified' },
  moderation: { state: 'pending' },
  createdAt: '2026-07-06T10:00:00.000Z',
};
const V2_REJECTED = { ...V2_PENDING, _id: 'rev_v2_rejected', moderation: { state: 'rejected' } };
const OTHER_SUPPLIER_REVIEW = { ...LEGACY_APPROVED, id: 'rev_other', supplierId: 'sup-2' };

/**
 * Seed with both shapes and a second supplier.
 *
 * @returns {Object} Seed
 */
function seed() {
  return {
    users: [
      { id: 'user-1', verified: true },
      { id: 'user-2', verified: true },
      { id: 'cust-4', firstName: 'Dana', lastName: 'Visitor' },
    ],
    suppliers: [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true },
      { id: 'sup-2', ownerUserId: 'user-2', name: 'Other', approved: true },
    ],
    reviews: [
      LEGACY_APPROVED,
      LEGACY_PENDING,
      LEGACY_REJECTED,
      V2_APPROVED,
      V2_PENDING,
      V2_REJECTED,
      OTHER_SUPPLIER_REVIEW,
    ],
  };
}

/**
 * Call an app mounting both routers.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Full path
 * @param {Object} [user] - Authenticated user
 * @param {Object} [body] - JSON body
 * @returns {Promise<Object>} supertest response
 */
function call(method, url, user = SUPPLIER_USER, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/v2/reviews', require('../../routes/reviews-v2'));
  app.use('/api/supplier', require('../../routes/supplier'));
  const req = request(app)[method](url).set('x-test-user', JSON.stringify(user));
  return body ? req.send(body) : req;
}

beforeEach(() => {
  fakeDb.__reset(seed());
});

describe('reviewState / normaliseReview', () => {
  it.each([
    [LEGACY_APPROVED, 'approved'],
    [LEGACY_PENDING, 'pending'],
    [LEGACY_REJECTED, 'rejected'],
    [V2_APPROVED, 'approved'],
    [V2_PENDING, 'pending'],
    [V2_REJECTED, 'rejected'],
    [{ moderation: { state: 'changes_requested' } }, 'other'],
    [{ moderation: { state: 'disputed' } }, 'other'],
    [{ moderation: {} }, 'other'],
    [{ rating: 5 }, 'pending'],
    [{ approved: 'true' }, 'pending'],
    [{ approved: 1 }, 'pending'],
    [null, 'other'],
  ])('classifies %j as %s', (doc, expected) => {
    expect(reviewState(doc)).toBe(expected);
    expect(isApprovedReview(doc)).toBe(expected === 'approved');
  });

  it('never calls a flagged or unapproved legacy review approved', () => {
    expect(isApprovedReview({ approved: false, flagged: false })).toBe(false);
    expect(isApprovedReview({ approved: true, moderation: { state: 'pending' } })).toBe(false);
  });

  it.each([
    [5, 5],
    ['4', 4],
    [0, null],
    [6, null],
    ['x', null],
    [undefined, null],
  ])('reads rating %j as %j', (value, expected) => {
    expect(reviewRating({ rating: value })).toBe(expected);
  });

  it('gives both shapes the same fields', () => {
    expect(normaliseReview(LEGACY_APPROVED)).toEqual({
      id: 'rev_legacy_ok',
      shape: 'legacy',
      supplierId: 'sup-1',
      authorId: 'cust-1',
      authorName: 'Alice Customer',
      rating: 5,
      title: 'Brilliant',
      text: 'Played all night and the dance floor was full.',
      createdAt: '2026-07-01T10:00:00.000Z',
      state: 'approved',
      verified: true,
      response: null,
    });
    expect(normaliseReview(V2_APPROVED)).toMatchObject({
      id: 'rev_v2_ok',
      shape: 'v2',
      authorId: 'cust-4',
      rating: 4,
      text: 'Very professional and on time.',
      state: 'approved',
      verified: true,
      response: { text: 'Thank you, it was a pleasure.', respondedAt: '2026-07-05T10:00:00.000Z' },
    });
  });

  it('reads a reply stored under either field name', () => {
    expect(
      normaliseReview({
        ...LEGACY_APPROVED,
        supplierResponse: { text: 'Thanks!', respondedAt: 'x' },
      }).response
    ).toEqual({ text: 'Thanks!', respondedAt: 'x', updatedAt: null });
  });

  it('matches ids by either field without matching undefined', () => {
    expect(reviewHasId(LEGACY_APPROVED, 'rev_legacy_ok')).toBe(true);
    expect(reviewHasId(V2_APPROVED, 'rev_v2_ok')).toBe(true);
    expect(reviewHasId(V2_APPROVED, 'undefined')).toBe(false);
  });
});

describe('summariseReviews counts both shapes and only published reviews', () => {
  it('counts approved reviews of both kinds and averages their ratings', () => {
    const result = summariseReviews(seed().reviews.filter(review => review.supplierId === 'sup-1'));

    expect(result).toEqual({ approvedCount: 2, averageRating: 4.5, pendingCount: 2 });
  });

  it('is null (not 0) when nothing is published', () => {
    expect(summariseReviews([LEGACY_PENDING, V2_PENDING, LEGACY_REJECTED])).toEqual({
      approvedCount: 0,
      averageRating: null,
      pendingCount: 2,
    });
  });

  it('does not let an unrated approved review drag the average down', () => {
    expect(
      summariseReviews([LEGACY_APPROVED, { ...LEGACY_APPROVED, id: 'x', rating: undefined }])
    ).toMatchObject({
      approvedCount: 2,
      averageRating: 5,
    });
  });
});

describe('dashboard summary and stats', () => {
  it('summary counts the live form reviews', async () => {
    const res = await call('get', '/api/supplier/dashboard-summary');

    expect(res.body.reviews).toMatchObject({
      approvedCount: 2,
      averageRating: 4.5,
      pendingCount: 2,
    });
  });

  it('a supplier never sees another supplier reviews in their numbers', async () => {
    const res = await call('get', '/api/supplier/dashboard-summary', OTHER_USER);

    expect(res.body.reviews).toMatchObject({ approvedCount: 1, averageRating: 5, pendingCount: 0 });
  });

  it('reviews/stats agrees with the summary', async () => {
    const res = await call('get', '/api/supplier/reviews/stats');

    expect(res.body.stats).toMatchObject({ totalReviews: 2, averageRating: 4.5 });
    expect(res.body.stats.distribution).toEqual({ 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 });
  });
});

describe('GET /api/v2/reviews/supplier/:id (the dashboard list)', () => {
  it('lists published reviews of both shapes, newest first, and nothing else', async () => {
    const res = await call('get', '/api/v2/reviews/supplier/sup-1');

    expect(res.status).toBe(200);
    const ids = res.body.data.reviews.map(review => review.id);
    expect(ids).toEqual(['rev_v2_ok', 'rev_legacy_ok']);
    expect(res.body.data.pagination.total).toBe(2);
    expect(res.body.data.analytics).toMatchObject({ avgRating: 4.5, totalReviews: 2 });
  });

  it('gives each review a name, text, rating, date and reply under the fields the dashboard reads', async () => {
    const res = await call('get', '/api/v2/reviews/supplier/sup-1');
    const [v2, legacy] = res.body.data.reviews;

    expect(v2).toMatchObject({
      rating: 4,
      text: 'Very professional and on time.',
      authorName: 'Dana V.',
      createdAt: '2026-07-04T10:00:00.000Z',
      response: { text: 'Thank you, it was a pleasure.' },
    });
    expect(legacy).toMatchObject({
      rating: 5,
      text: 'Played all night and the dance floor was full.',
      userName: 'Alice Customer',
      authorName: 'Alice Customer',
      createdAt: '2026-07-01T10:00:00.000Z',
      response: null,
    });
  });

  it('exposes no moderation internals, IP data or account ids', async () => {
    const res = await call('get', '/api/v2/reviews/supplier/sup-1');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('hashed-ip');
    expect(body).not.toContain('Mozilla');
    expect(body).not.toContain('internal reason');
    expect(body).not.toContain('moderatorId');
    expect(body).not.toContain('cust-1');
    expect(body).not.toContain('voters');
    expect(body).not.toContain('Spam Bot');
    expect(body).not.toContain('Rejected Person');
  });

  it('counts ratings from both shapes in the distribution', async () => {
    const res = await call('get', '/api/v2/reviews/supplier/sup-1');

    expect(res.body.data.analytics.ratingDistribution).toEqual([0, 0, 0, 1, 1]);
  });

  it('does not list another supplier reviews', async () => {
    const res = await call('get', '/api/v2/reviews/supplier/sup-2');

    expect(res.body.data.reviews.map(review => review.id)).toEqual(['rev_other']);
  });

  it('still lists v2 reviews when the reviewer name lookup fails', async () => {
    fakeDb.__failOn('users');

    const res = await call('get', '/api/v2/reviews/supplier/sup-1');

    expect(res.status).toBe(200);
    expect(res.body.data.reviews.map(review => review.id)).toContain('rev_v2_ok');
  });
});

describe('replying to a review', () => {
  const REPLY = 'Thank you so much for your kind words, it was a pleasure!';

  it('lets the supplier reply to a legacy (public form) review', async () => {
    const res = await call('post', '/api/v2/reviews/rev_legacy_ok/response', SUPPLIER_USER, {
      text: REPLY,
    });

    expect(res.status).toBe(200);
    const stored = fakeDb.__store().reviews.find(review => review.id === 'rev_legacy_ok');
    expect(stored.response.text).toBe(REPLY);
    // Only the reply was written: the rest of the legacy record is untouched.
    expect(stored.comment).toBe(LEGACY_APPROVED.comment);
    expect(stored.ipAddress).toBe('hashed-ip');

    const list = await call('get', '/api/v2/reviews/supplier/sup-1');
    const legacy = list.body.data.reviews.find(review => review.id === 'rev_legacy_ok');
    expect(legacy.response.text).toBe(REPLY);
  });

  it('lets the supplier reply to a v2 review', async () => {
    const res = await call('post', '/api/v2/reviews/rev_v2_pending/response', SUPPLIER_USER, {
      text: REPLY,
    });

    expect(res.status).toBe(200);
  });

  it('lets the supplier edit a reply on either shape', async () => {
    await call('post', '/api/v2/reviews/rev_legacy_ok/response', SUPPLIER_USER, { text: REPLY });

    const legacy = await call('put', '/api/v2/reviews/rev_legacy_ok/response', SUPPLIER_USER, {
      text: 'An updated reply with enough characters.',
    });
    const v2 = await call('put', '/api/v2/reviews/rev_v2_ok/response', SUPPLIER_USER, {
      text: 'An updated reply on the v2 review.',
    });

    expect(legacy.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(
      fakeDb.__store().reviews.find(review => review.id === 'rev_legacy_ok').response.text
    ).toBe('An updated reply with enough characters.');
  });

  it("will not reply to, or edit a reply on, another supplier's review", async () => {
    const post = await call('post', '/api/v2/reviews/rev_other/response', SUPPLIER_USER, {
      text: REPLY,
    });
    const put = await call('put', '/api/v2/reviews/rev_other/response', SUPPLIER_USER, {
      text: REPLY,
    });

    expect(post.status).toBe(400);
    expect(post.body.error).toBe('Supplier ID mismatch');
    expect([403, 404]).toContain(put.status);
    expect(
      fakeDb.__store().reviews.find(review => review.id === 'rev_other').response
    ).toBeUndefined();
  });

  it('reports an unknown review as not found', async () => {
    const res = await call('post', '/api/v2/reviews/rev_nope/response', SUPPLIER_USER, {
      text: REPLY,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Review not found');
  });
});
