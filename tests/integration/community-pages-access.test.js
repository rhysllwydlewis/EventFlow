/**
 * Access control for the server-rendered community pages.
 *
 * The page routes are mounted before the API stack, so they must enforce
 * visibility themselves. A quarantined, hidden or removed discussion must be
 * unreachable here exactly as it is on the API — `noindex` metadata is not an
 * authorisation check.
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

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
  find: jest.fn(async collection => mockDb.all(collection)),
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

const community = require('../../services/community.service');

const users = {
  author: { id: 'u-author', email: 'author@example.com', role: 'customer', verified: true },
  other: { id: 'u-other', email: 'other@example.com', role: 'customer', verified: true },
  moderator: {
    id: 'u-mod',
    email: 'mod@example.com',
    role: 'customer',
    communityRole: 'moderator',
    verified: true,
  },
  admin: { id: 'u-admin', email: 'admin@example.com', role: 'admin', verified: true },
};

/**
 * Build a discussion fixture in a given state.
 * @param {string} state Content state.
 * @returns {Object} Discussion document.
 */
function discussion(state) {
  return {
    id: 'd-1',
    stableId: 'aaaabbbbcccc',
    slug: 'a-private-planning-question',
    title: 'A private planning question',
    bodyHtml: '<p>SECRET-BODY-CONTENT that moderation took down.</p>',
    bodyText: 'SECRET-BODY-CONTENT that moderation took down.',
    excerpt: 'SECRET-BODY-CONTENT',
    authorId: users.author.id,
    author: { handle: 'author', displayName: 'Author' },
    categorySlug: 'venues',
    categoryName: 'Venues',
    state,
    createdAt: '2026-07-01T00:00:00.000Z',
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    replyCount: 0,
    uniqueViews: 0,
  };
}

/**
 * Build an auth cookie for a fixture user.
 * @param {Object} user User fixture.
 * @returns {string} Cookie header value.
 */
function authCookie(user) {
  return `token=${jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )}`;
}

let app;

beforeEach(() => {
  mockDb.reset();
  community.invalidateSettingsCache();
  mockDb.seed('users', Object.values(users));
  mockDb.seed('community_categories', [
    { id: 'c1', slug: 'venues', name: 'Venues', visible: true, archived: false, order: 1 },
  ]);
  mockDb.seed('community_replies', []);
  mockDb.seed('community_settings', []);

  app = express();
  app.use(cookieParser());
  app.use(require('../../routes/community-pages'));
  app.use((req, res) => res.status(404).send('Not found'));
});

const HIDDEN_STATES = ['quarantined', 'hidden', 'removed', 'draft', 'pending_review'];

describe('server-rendered discussion pages — anonymous visitors', () => {
  it('serves a published discussion', async () => {
    mockDb.seed('community_discussions', [discussion('published')]);
    const res = await request(app).get(
      '/community/discussion/aaaabbbbcccc/a-private-planning-question'
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('A private planning question');
  });

  it.each(HIDDEN_STATES)('404s a %s discussion and never leaks its body', async state => {
    mockDb.seed('community_discussions', [discussion(state)]);
    const res = await request(app).get(
      '/community/discussion/aaaabbbbcccc/a-private-planning-question'
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('SECRET-BODY-CONTENT');
    expect(res.text).not.toContain('A private planning question');
  });

  it('404s a hidden discussion even when the slug is omitted', async () => {
    mockDb.seed('community_discussions', [discussion('removed')]);
    const res = await request(app).get('/community/discussion/aaaabbbbcccc');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('SECRET-BODY-CONTENT');
  });
});

describe('server-rendered discussion pages — signed-in visitors', () => {
  it('404s another member’s held discussion', async () => {
    mockDb.seed('community_discussions', [discussion('quarantined')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', authCookie(users.other));
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('SECRET-BODY-CONTENT');
  });

  it('shows an author their own held discussion, so nothing is a silent shadow ban', async () => {
    mockDb.seed('community_discussions', [discussion('quarantined')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', authCookie(users.author));
    expect(res.status).toBe(200);
    expect(res.text).toContain('SECRET-BODY-CONTENT');
  });

  it('shows a moderator held content', async () => {
    mockDb.seed('community_discussions', [discussion('hidden')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', authCookie(users.moderator));
    expect(res.status).toBe(200);
  });

  it('shows a global admin held content', async () => {
    mockDb.seed('community_discussions', [discussion('hidden')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', authCookie(users.admin));
    expect(res.status).toBe(200);
  });

  it('never lets a non-public page reach a shared cache', async () => {
    mockDb.seed('community_discussions', [discussion('quarantined')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', authCookie(users.author));
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.text).toContain('noindex');
  });

  it('allows a published page to be shared-cached', async () => {
    mockDb.seed('community_discussions', [discussion('published')]);
    const res = await request(app).get(
      '/community/discussion/aaaabbbbcccc/a-private-planning-question'
    );
    expect(res.headers['cache-control']).toContain('public');
  });

  it('ignores a forged cookie', async () => {
    mockDb.seed('community_discussions', [discussion('quarantined')]);
    const res = await request(app)
      .get('/community/discussion/aaaabbbbcccc/a-private-planning-question')
      .set('Cookie', 'token=not-a-real-jwt');
    expect(res.status).toBe(404);
  });
});

describe('server-rendered routing', () => {
  it('redirects a stale slug to the canonical URL', async () => {
    mockDb.seed('community_discussions', [discussion('published')]);
    const res = await request(app).get('/community/discussion/aaaabbbbcccc/an-old-slug');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      '/community/discussion/aaaabbbbcccc/a-private-planning-question'
    );
  });

  it('redirects the legacy forum URLs', async () => {
    mockDb.seed('community_discussions', []);
    for (const legacy of ['/forum', '/forums', '/forum.html', '/forums.html']) {
      const res = await request(app).get(legacy);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/community');
    }
  });

  it('404s a malformed discussion id without touching the database', async () => {
    mockDb.seed('community_discussions', [discussion('published')]);
    const res = await request(app).get('/community/discussion/not-a-valid-id/x');
    expect(res.status).toBe(404);
  });
});

describe('server-rendered pages — the rest of the surface', () => {
  beforeEach(() => {
    mockDb.seed('community_discussions', [discussion('published')]);
  });

  it('renders the community homepage with categories and recent discussions', async () => {
    const res = await request(app).get('/community');
    expect(res.status).toBe(200);
    expect(res.text).toContain('EventFlow Community');
    expect(res.text).toContain('Venues');
    expect(res.text).toContain('A private planning question');
    expect(res.text).toContain('CollectionPage');
  });

  it('serves the homepage at the .html address too', async () => {
    const res = await request(app).get('/community.html');
    expect(res.status).toBe(200);
  });

  it('renders a category page with breadcrumb structured data', async () => {
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(200);
    expect(res.text).toContain('BreadcrumbList');
    expect(res.text).toContain('Venues');
  });

  it('emits rel=next when a category has more than one page', async () => {
    const many = Array.from({ length: 25 }, (unused, index) => ({
      ...discussion('published'),
      id: `d-${index}`,
      stableId: `aaaabbbbcc${String(index).padStart(2, '0')}`,
    }));
    mockDb.seed('community_discussions', many);
    const res = await request(app).get('/community/category/venues');
    expect(res.text).toContain('rel="next"');

    const second = await request(app).get('/community/category/venues?page=2');
    expect(second.text).toContain('rel="prev"');
  });

  it('404s a hidden category', async () => {
    mockDb.seed('community_categories', [
      { id: 'c1', slug: 'venues', name: 'Venues', visible: false, archived: false, order: 1 },
    ]);
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(404);
  });

  it('404s a category slug with unexpected characters', async () => {
    const res = await request(app).get('/community/category/NOT_A_SLUG');
    expect(res.status).toBe(404);
  });

  const simplePages = [
    ['/community/discussions', 'All discussions'],
    ['/community/new', 'Start a discussion'],
    ['/community/search', 'Search'],
    ['/community/saved', 'Saved discussions'],
    ['/community/following', 'Following'],
    ['/community/guidelines', 'Community guidelines'],
    ['/community/help', 'Community help and appeals'],
  ];

  it.each(simplePages)('renders %s', async (path, heading) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain(heading);
  });

  const noindexPages = [
    '/community/new',
    '/community/search',
    '/community/saved',
    '/community/following',
  ];

  it.each(noindexPages)('marks %s noindex', async path => {
    const res = await request(app).get(path);
    expect(res.text).toContain('noindex');
  });

  const indexedPages = ['/community', '/community/discussions', '/community/guidelines'];

  it.each(indexedPages)('leaves %s indexable', async path => {
    const res = await request(app).get(path);
    expect(res.text).not.toContain('name="robots"');
  });

  it('renders a member profile page', async () => {
    const res = await request(app).get('/community/member/sam');
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:type" content="profile"');
  });

  it('404s a member handle with unexpected characters', async () => {
    const res = await request(app).get('/community/member/not-a-handle!');
    expect(res.status).toBe(404);
  });

  it('renders the admin community page as noindex', async () => {
    const res = await request(app).get('/admin/community');
    expect(res.status).toBe(200);
    expect(res.text).toContain('noindex');
  });

  it('takes every page offline when the community is disabled', async () => {
    process.env.COMMUNITY_ENABLED = 'false';
    community.invalidateSettingsCache();
    try {
      for (const path of ['/community', '/community/discussions', '/community/category/venues']) {
        // eslint-disable-next-line no-await-in-loop -- sequential assertions read better here
        const res = await request(app).get(path);
        expect(res.status).toBe(404);
      }
    } finally {
      delete process.env.COMMUNITY_ENABLED;
      community.invalidateSettingsCache();
    }
  });
});

describe('empty-state index gating (SEO-005) never disagrees with the sitemap count', () => {
  // A community/category holding only 'superseded' discussions must be
  // noindex,follow: PUBLIC_STATES (used to render/link the page) includes
  // 'superseded', but emptyStateIndexGate's PUBLIC_DISCUSSION_STATES (the
  // count sitemap.js applies the same threshold to) deliberately excludes
  // it — so an indexability decision based on the wider count would
  // disagree with the sitemap.
  it('marks /community/discussions noindex when the only discussion is superseded', async () => {
    mockDb.seed('community_discussions', [discussion('superseded')]);
    const res = await request(app).get('/community/discussions');
    expect(res.status).toBe(200);
    expect(res.text).toContain('noindex');
  });

  it('marks /community/category/venues noindex when the only discussion is superseded', async () => {
    mockDb.seed('community_discussions', [discussion('superseded')]);
    const res = await request(app).get('/community/category/venues');
    expect(res.status).toBe(200);
    expect(res.text).toContain('noindex');
  });

  it('leaves /community/discussions indexable once a published discussion joins the superseded one', async () => {
    mockDb.seed('community_discussions', [
      discussion('superseded'),
      {
        ...discussion('published'),
        id: 'd-2',
        stableId: 'aaaabbbbcc02',
        slug: 'a-second-question',
      },
    ]);
    const res = await request(app).get('/community/discussions');
    expect(res.text).not.toContain('name="robots"');
  });
});
