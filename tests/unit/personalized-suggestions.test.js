'use strict';

/**
 * The customer dashboard's "Suggested for you" panel: GET /api/v2/search/personalized and the
 * feed behind it. Covers what the panel needs to be useful: a link to each supplier's profile,
 * suggestions that follow what the plan still lacks and where it is, honest reasons, and a
 * response that is never shared between customers.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../db-unified');
jest.mock('../../services/catalogCache', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
  getTtl: jest.fn().mockReturnValue(300),
}));
jest.mock('../../middleware/auth', () => ({
  authRequired: (_req, _res, next) => next(),
  roleRequired: () => (_req, _res, next) => next(),
  getUserFromCookie: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));

const dbUnified = require('../../db-unified');
const { getUserFromCookie } = require('../../middleware/auth');
const searchService = require('../../services/searchService');
const searchWeighting = require('../../utils/searchWeighting');
const router = require('../../routes/search-v2');

const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
const supplier = (id, name, category, location, extra = {}) => ({
  id,
  name,
  category,
  location,
  approved: true,
  createdAt: old,
  averageRating: 0,
  reviewCount: 0,
  ...extra,
});

const suppliers = [
  supplier('c1', 'Cardiff Caterers One', 'Catering', 'Cardiff & South Wales', { verified: true }),
  supplier('c2', 'Cardiff Caterers Two', 'Catering', 'Cardiff & South Wales', { verified: true }),
  supplier('c3', 'Cardiff Caterers Three', 'Catering', 'Cardiff & South Wales', { verified: true }),
  supplier('p1', 'Snapshot Photography', 'Photography', 'Bristol & South West', {
    profilePhotoUrl: 'https://img.example.test/snap.jpg',
  }),
  supplier('v1', 'The Willow Barn Venue', 'Venues', 'Monmouthshire, South Wales'),
  supplier('d1', 'Disco Dave', 'Entertainment', 'Leeds'),
];

const feedFor = (context, options = { limit: 6 }) =>
  searchService.getPersonalizedFeed(null, context, options);

beforeEach(() => {
  jest.clearAllMocks();
  getUserFromCookie.mockResolvedValue(null);
  dbUnified.read.mockImplementation(async collection => {
    if (collection === 'suppliers') {
      return suppliers;
    }
    return [];
  });
});

describe('the feed follows what the plan still needs', () => {
  test('suppliers in a category the plan has not covered rise above the rest', async () => {
    const feed = await feedFor({ neededCategories: ['Photography'] });
    expect(feed.results[0].id).toBe('p1');
    expect(feed.results[0].rankingReason).toBe('Still to find: Photography');
  });

  test('category names are matched without regard to case', async () => {
    const feed = await feedFor({ neededCategories: ['photography'] });
    expect(feed.results[0].id).toBe('p1');
  });

  test('a category the plan does not need gets no "still to find" reason', async () => {
    const feed = await feedFor({ neededCategories: ['Photography'] });
    const caterer = feed.results.find(r => r.category === 'Catering');
    expect(caterer.rankingReason).not.toMatch(/Still to find/);
  });

  test('the context says the feed is personalised from the plan', async () => {
    const feed = await feedFor({ neededCategories: ['Photography'] });
    expect(feed.context.isPersonalized).toBe(true);
    expect(feed.context.signalSource).toBe('context');
  });

  test('junk in neededCategories is ignored', async () => {
    const feed = await feedFor({ neededCategories: [null, 42, '', {}, '  '] });
    expect(feed.context.isPersonalized).toBe(false);
  });
});

describe('the feed is not five of the same kind', () => {
  test('no more than two of one category before other categories', async () => {
    const feed = await feedFor({ location: 'Cardiff' }, { limit: 4 });
    const catering = feed.results.filter(r => r.category === 'Catering');
    expect(catering).toHaveLength(2);
    expect(feed.results.map(r => r.category)).toEqual(
      expect.arrayContaining(['Photography', 'Venues'])
    );
  });

  test('still fills the feed from one category when there are no others', async () => {
    dbUnified.read.mockImplementation(async c => (c === 'suppliers' ? suppliers.slice(0, 3) : []));
    const feed = await feedFor({}, { limit: 3 });
    expect(feed.results).toHaveLength(3);
  });
});

describe('location', () => {
  test('a plan location with a region after the town still matches the supplier', async () => {
    const feed = await feedFor({ location: 'Cardiff, Wales' }, { limit: 2 });
    expect(feed.results[0].location).toBe('Cardiff & South Wales');
    expect(feed.results[0].rankingReason).toBe('Available near Cardiff & South Wales');
    expect(feed.context.preferredLocation).toBe('Cardiff');
  });
});

describe('reasons', () => {
  test('never the catch-all "good match for your search" (nobody searched)', async () => {
    const feed = await feedFor({ neededCategories: ['Photography'], location: 'Cardiff' });
    feed.results.forEach(r => {
      expect(r.rankingReason).not.toBe(searchWeighting.DEFAULT_RANKING_REASON);
      expect(typeof r.rankingReason).toBe('string');
    });
    const disco = feed.results.find(r => r.id === 'd1');
    expect(disco.rankingReason).toBe('');
  });

  test('search results still use the catch-all when nothing else applies', () => {
    expect(searchWeighting.getRankingReason(suppliers[5], '')).toBe(
      searchWeighting.DEFAULT_RANKING_REASON
    );
  });
});

describe('GET /api/v2/search/personalized', () => {
  const app = express();
  app.use('/api/v2/search', router);
  const get = query => request(app).get('/api/v2/search/personalized').query(query);

  test('every result carries the link to its public profile', async () => {
    const res = await get({ limit: 6 });
    expect(res.status).toBe(200);
    expect(res.body.data.results.length).toBeGreaterThan(0);
    res.body.data.results.forEach(r => {
      expect(r.publicProfilePath).toMatch(/^\/supplier\/[a-z0-9-]+--[a-f0-9]{16}$/);
    });
  });

  test('the profile link is for the same supplier, not another', async () => {
    const res = await get({ limit: 6 });
    const snapshot = res.body.data.results.find(r => r.id === 'p1');
    expect(snapshot.publicProfilePath).toMatch(/^\/supplier\/snapshot-photography--/);
  });

  test('the photo fields come through for the avatar', async () => {
    const res = await get({ limit: 6 });
    const snapshot = res.body.data.results.find(r => r.id === 'p1');
    expect(snapshot.profilePhotoUrl).toBe('https://img.example.test/snap.jpg');
  });

  test('`needed` steers the feed and ignores anything that is not a supplier category', async () => {
    const res = await get({ limit: 6, needed: 'photography, <script>, Nonsense' });
    expect(res.body.data.results[0].id).toBe('p1');
    expect(res.body.data.context.signalSource).toBe('context');
  });

  test('only junk in `needed` means no personalisation', async () => {
    const res = await get({ limit: 6, needed: '<script>,Nonsense' });
    expect(res.body.data.context.isPersonalized).toBe(false);
  });

  test('is not shared between customers: private, vary on cookie, no shared-cache entry', async () => {
    const res = await get({ limit: 6 });
    expect(res.headers['cache-control']).toMatch(/private/);
    expect(res.headers['cache-control']).not.toMatch(/public/);
    expect(res.headers.vary).toMatch(/Cookie/i);
    expect(res.headers['x-cache']).toBeUndefined();
  });

  test("one customer's search history does not shape another customer's feed", async () => {
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'suppliers') {
        return suppliers;
      }
      if (collection === 'searchHistory') {
        return [
          {
            userId: 'history-user',
            filters: { category: 'Entertainment' },
            queryText: 'disco',
            timestamp: new Date().toISOString(),
          },
        ];
      }
      return [];
    });
    getUserFromCookie.mockResolvedValueOnce({ id: 'history-user' });
    const first = await get({ limit: 6 });
    expect(first.body.data.results[0].id).toBe('d1');

    getUserFromCookie.mockResolvedValueOnce({ id: 'someone-else' });
    const second = await get({ limit: 6 });
    expect(second.body.data.results[0].id).not.toBe('d1');
  });
});
