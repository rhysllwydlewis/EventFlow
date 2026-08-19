/**
 * Empty-state SEO index gating for the community pages (audit finding
 * SEO-005): an empty category or an empty "all discussions" index must
 * still respond 200 — never a hard block — but with noindex,follow, and
 * must reach index,follow once real content passes the shared threshold in
 * services/emptyStateIndexGate.service.js.
 */

'use strict';

const express = require('express');
const request = require('supertest');

const store = new Map();

const mockDb = {
  reset() {
    store.clear();
  },
  seed(collection, records) {
    store.set(
      collection,
      records.map(record => ({ ...record }))
    );
  },
  all(collection) {
    return store.get(collection) || [];
  },
  find: jest.fn(async (collection, filter = {}) => {
    const entries = Object.entries(filter || {});
    return mockDb.all(collection).filter(item =>
      entries.every(([key, value]) => {
        if (value && typeof value === 'object' && Array.isArray(value.$in)) {
          return value.$in.includes(item[key]);
        }
        return item[key] === value;
      })
    );
  }),
  findOne: jest.fn(async (collection, filter) => {
    const entries = Object.entries(filter || {});
    return (
      mockDb.all(collection).find(item => entries.every(([key, value]) => item[key] === value)) ||
      null
    );
  }),
  insertOne: jest.fn(async () => true),
  updateOne: jest.fn(async () => true),
  deleteOne: jest.fn(async () => true),
  read: jest.fn(async collection => mockDb.all(collection)),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return { apiLimiter: passthrough, publicReadLimiter: passthrough };
});

function discussion(overrides = {}) {
  return {
    id: 'd-1',
    stableId: 'aaaabbbbcccc',
    slug: 'marquee-hire-in-kent',
    title: 'Marquee hire in Kent',
    bodyHtml: '<p>Body</p>',
    bodyText: 'Body',
    categorySlug: 'venues',
    categoryName: 'Venues',
    state: 'published',
    author: { displayName: 'Sam' },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    uniqueViews: 1,
    ...overrides,
  };
}

function discussions(count) {
  return Array.from({ length: count }, (_, index) =>
    discussion({ id: `d-${index}`, stableId: `aaaabbbb${String(index).padStart(4, '0')}` })
  );
}

let app;

beforeEach(() => {
  jest.resetModules();
  mockDb.reset();
  const community = require('../../services/community.service');
  community.invalidateSettingsCache();
  mockDb.seed('users', []);
  mockDb.seed('community_categories', [
    { id: 'c1', slug: 'venues', name: 'Venues', visible: true, archived: false, order: 1 },
  ]);
  mockDb.seed('community_replies', []);
  mockDb.seed('community_settings', []);
  mockDb.seed('community_discussions', []);

  app = express();
  app.use(require('../../routes/community-pages'));
  app.use((req, res) => res.status(404).send('Not found'));
});

describe('community category empty-state index gating', () => {
  it('responds 200 with noindex,follow for a category with zero discussions', async () => {
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta name="robots" content="noindex,follow" />');
    expect(res.text).toContain('Venues');
  });

  it('does not hard-block the empty category — the page still renders normally', async () => {
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No discussions here yet');
  });

  it('reaches index,follow only once the category passes the useful-content threshold', async () => {
    mockDb.seed('community_discussions', discussions(3));
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('noindex');
  });

  it('drops back to noindex if the category empties out again', async () => {
    mockDb.seed('community_discussions', discussions(3));
    let res = await request(app).get('/community/category/venues');
    expect(res.text).not.toContain('noindex');

    mockDb.seed('community_discussions', []);
    res = await request(app).get('/community/category/venues');
    expect(res.text).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it('does not let a private/draft discussion count towards the threshold', async () => {
    mockDb.seed('community_discussions', [
      discussion({ state: 'draft' }),
      discussion({ id: 'd-2', stableId: 'aaaabbbbdddd', state: 'quarantined' }),
    ]);
    const res = await request(app).get('/community/category/venues');
    expect(res.text).toContain('<meta name="robots" content="noindex,follow" />');
    expect(res.text).not.toContain('Marquee hire in Kent');
  });
});

describe('community discussions index empty-state gating', () => {
  it('responds 200 with noindex,follow when the whole community is empty', async () => {
    const res = await request(app).get('/community/discussions');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it('reaches index,follow only once the community passes the useful-content threshold', async () => {
    mockDb.seed('community_discussions', discussions(5));
    const res = await request(app).get('/community/discussions');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('noindex');
  });
});
