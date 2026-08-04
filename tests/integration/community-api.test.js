/**
 * Integration tests for the EventFlow Community API.
 *
 * The routers are mounted against an in-memory implementation of the shared
 * db-unified interface, so these exercise the real middleware chain: auth,
 * verification, adult declaration, CSRF, ownership and the moderation engine.
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// ─── In-memory database ──────────────────────────────────────────────────────

const store = new Map();

/**
 * Decide whether a record matches a Mongo-style filter. Only the operators the
 * community routes actually use are supported.
 * @param {Object} record Stored record.
 * @param {Object} filter Filter document.
 * @returns {boolean} True when the record matches.
 */
function matches(record, filter) {
  return Object.entries(filter || {}).every(([key, expected]) => {
    const actual = key.includes('.')
      ? key
          .split('.')
          .reduce(
            (value, part) => (value === null || value === undefined ? value : value[part]),
            record
          )
      : record[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$in' in expected) {
        return expected.$in.includes(actual);
      }
      if ('$gte' in expected) {
        return actual >= expected.$gte;
      }
      if ('$type' in expected) {
        return actual !== undefined;
      }
    }
    return actual === expected;
  });
}

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
  find: jest.fn(async (collection, filter) =>
    mockDb.all(collection).filter(item => matches(item, filter))
  ),
  findOne: jest.fn(
    async (collection, filter) => mockDb.all(collection).find(item => matches(item, filter)) || null
  ),
  insertOne: jest.fn(async (collection, record) => {
    const records = mockDb.all(collection);
    records.push({ ...record });
    store.set(collection, records);
    return true;
  }),
  updateOne: jest.fn(async (collection, filter, update) => {
    const record = mockDb.all(collection).find(item => matches(item, filter));
    if (!record) {
      return false;
    }
    Object.assign(record, update.$set || {});
    Object.entries(update.$inc || {}).forEach(([key, value]) => {
      record[key] = Number(record[key] || 0) + Number(value);
    });
    return true;
  }),
  deleteOne: jest.fn(async (collection, filter) => {
    const records = mockDb.all(collection);
    const index = records.findIndex(item => matches(item, filter));
    if (index >= 0) {
      records.splice(index, 1);
    }
    return true;
  }),
  read: jest.fn(async collection => mockDb.all(collection)),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
  getToken: () => 'test-token',
  generateToken: () => 'test-token',
}));
jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (req, res, next) => next();
  return {
    writeLimiter: passthrough,
    apiLimiter: passthrough,
    searchLimiter: passthrough,
    publicReadLimiter: passthrough,
    authLimiter: passthrough,
  };
});

const community = require('../../services/community.service');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-01T12:00:00.000Z');

const users = {
  member: {
    id: 'u-member',
    email: 'member@example.com',
    role: 'customer',
    verified: true,
    adultDeclaration: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    communityHandle: 'sam',
    displayName: 'Sam',
  },
  unverified: {
    id: 'u-unverified',
    email: 'new@example.com',
    role: 'customer',
    verified: false,
    createdAt: '2026-07-31T00:00:00.000Z',
  },
  supplier: {
    id: 'u-supplier',
    email: 'supplier@example.com',
    role: 'supplier',
    verified: true,
    adultDeclaration: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    communityHandle: 'brightblooms',
    displayName: 'Bright Blooms',
  },
  other: {
    id: 'u-other',
    email: 'other@example.com',
    role: 'customer',
    verified: true,
    adultDeclaration: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    communityHandle: 'alex',
    displayName: 'Alex',
  },
  admin: {
    id: 'u-admin',
    email: 'admin@example.com',
    role: 'admin',
    verified: true,
    adultDeclaration: true,
    createdAt: '2023-01-01T00:00:00.000Z',
    communityHandle: 'eventflowteam',
    displayName: 'EventFlow Team',
  },
};

const category = {
  id: 'cat-venues',
  slug: 'venues',
  name: 'Venues',
  description: 'Finding and booking venues.',
  icon: '🏛️',
  order: 10,
  visible: true,
  archived: false,
  followerCount: 0,
};

/**
 * Build a published discussion fixture.
 * @param {Object} overrides Field overrides.
 * @returns {Object} Discussion document.
 */
function discussionFixture(overrides = {}) {
  return {
    id: 'd-1',
    stableId: 'aaaabbbbcccc',
    slug: 'marquee-hire-in-kent',
    title: 'Marquee hire in Kent — who did you use?',
    bodyHtml: '<p>We need a marquee for 120 guests in September.</p>',
    bodyText: 'We need a marquee for 120 guests in September.',
    excerpt: 'We need a marquee for 120 guests in September.',
    searchText: 'We need a marquee for 120 guests in September.',
    authorId: users.member.id,
    author: { handle: 'sam', displayName: 'Sam', accountType: 'customer' },
    categorySlug: 'venues',
    categoryName: 'Venues',
    eventType: 'wedding',
    region: 'south-east',
    tags: ['marquee'],
    attachments: [],
    state: 'published',
    pinned: false,
    featured: false,
    locked: false,
    helpfulAnswerId: null,
    officialAnswerIds: [],
    replyCount: 0,
    uniqueViews: 0,
    helpfulVotes: 0,
    saveCount: 0,
    participants: [users.member.id],
    createdAt: '2026-07-01T00:00:00.000Z',
    lastActivityAt: '2026-07-20T00:00:00.000Z',
    riskScore: 12,
    riskSignals: ['something_internal'],
    ...overrides,
  };
}

/**
 * Create an Express app with the community routers mounted.
 * @returns {Object} Express app.
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/community', require('../../routes/community'));
  app.use('/api/v1/community', require('../../routes/community-interactions'));
  app.use('/api/v1/community', require('../../routes/community-discovery'));
  app.use('/api/v1/admin/community', require('../../routes/admin-community'));
  return app;
}

/**
 * Build an auth cookie for a fixture user.
 * @param {Object} user User fixture.
 * @returns {string} Cookie header value.
 */
function authCookie(user) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return `token=${token}`;
}

let app;

beforeEach(() => {
  mockDb.reset();
  community.invalidateSettingsCache();
  mockDb.seed('users', Object.values(users));
  mockDb.seed('suppliers', [
    { id: 'sup-1', ownerId: users.supplier.id, approved: true, category: 'Florist' },
  ]);
  mockDb.seed('community_categories', [category]);
  mockDb.seed('community_discussions', [discussionFixture()]);
  mockDb.seed('community_replies', []);
  mockDb.seed('community_settings', []);
  app = createApp();
});

// ─── Public reads ────────────────────────────────────────────────────────────

describe('community public reads', () => {
  it('serves the taxonomy without authentication', async () => {
    const res = await request(app).get('/api/v1/community/meta');
    expect(res.status).toBe(200);
    expect(res.body.eventTypes.length).toBeGreaterThan(0);
    expect(res.body.regions.length).toBeGreaterThan(0);
  });

  it('lists categories with live counts', async () => {
    const res = await request(app).get('/api/v1/community/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories[0].slug).toBe('venues');
    expect(res.body.categories[0].discussionCount).toBe(1);
  });

  it('serves the homepage payload without any vanity counters', async () => {
    const res = await request(app).get('/api/v1/community/home');
    expect(res.status).toBe(200);
    expect(res.body.counts).toBeDefined();
    expect(res.body.counts.usersOnline).toBeUndefined();
    expect(res.body.counts.members).toBeUndefined();
    expect(res.body.counts.answeredPercentage).toBe(0);
  });

  it('returns an empty following feed for logged-out visitors rather than a fake one', async () => {
    const res = await request(app).get('/api/v1/community/home');
    expect(res.body.following).toBeNull();
  });

  it('lists discussions with pagination metadata', async () => {
    const res = await request(app).get('/api/v1/community/discussions');
    expect(res.status).toBe(200);
    expect(res.body.discussions).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 1, totalPages: 1 });
  });

  it('returns a full discussion with its replies', async () => {
    const res = await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    expect(res.status).toBe(200);
    expect(res.body.discussion.title).toContain('Marquee hire');
    expect(res.body.replies).toEqual([]);
  });

  it('404s for an unknown discussion id', async () => {
    const res = await request(app).get('/api/v1/community/discussions/ffffffffffff');
    expect(res.status).toBe(404);
  });

  it('404s for a malformed discussion id rather than probing the database', async () => {
    const res = await request(app).get('/api/v1/community/discussions/..%2F..%2Fetc');
    expect(res.status).toBe(404);
  });
});

// ─── Hidden content ──────────────────────────────────────────────────────────

describe('community content visibility', () => {
  it('hides quarantined discussions from the public list', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ state: 'quarantined' })]);
    const res = await request(app).get('/api/v1/community/discussions');
    expect(res.body.discussions).toHaveLength(0);
  });

  it('404s a quarantined discussion for an anonymous visitor', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ state: 'quarantined' })]);
    const res = await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    expect(res.status).toBe(404);
  });

  it('404s another member’s quarantined discussion', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ state: 'quarantined' })]);
    const res = await request(app)
      .get('/api/v1/community/discussions/aaaabbbbcccc')
      .set('Cookie', authCookie(users.other));
    expect(res.status).toBe(404);
  });

  it('shows an author their own held discussion, so nothing is silently shadow banned', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ state: 'quarantined' })]);
    const res = await request(app)
      .get('/api/v1/community/discussions/aaaabbbbcccc')
      .set('Cookie', authCookie(users.member));
    expect(res.status).toBe(200);
    expect(res.body.discussion.pendingReview).toBe(true);
  });

  it('never returns risk signals on the public API', async () => {
    const res = await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    expect(JSON.stringify(res.body)).not.toContain('something_internal');
    expect(res.body.discussion.riskScore).toBeUndefined();
  });
});

// ─── Write authorisation ─────────────────────────────────────────────────────

describe('community write authorisation', () => {
  const validPost = {
    title: 'Recommendations for a caterer in Bristol',
    category: 'venues',
    body: 'We are hosting a charity dinner for 80 people and need a caterer who can do vegan menus.',
  };

  it('rejects an anonymous attempt to start a discussion', async () => {
    const res = await request(app).post('/api/v1/community/discussions').send(validPost);
    expect(res.status).toBe(401);
  });

  it('rejects an unverified account', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.unverified))
      .send(validPost);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('requires an adult declaration', async () => {
    mockDb.seed('users', [
      ...Object.values(users).filter(user => user.id !== users.member.id),
      { ...users.member, adultDeclaration: false },
    ]);
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send(validPost);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADULT_DECLARATION_REQUIRED');
  });

  it('blocks a member whose community access is suspended, and tells them how to appeal', async () => {
    mockDb.seed('community_restrictions', [
      {
        id: 'r-1',
        userId: users.member.id,
        type: 'suspended',
        active: true,
        publicReason: 'Repeated promotional posts',
      },
    ]);
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send(validPost);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('COMMUNITY_RESTRICTED');
    expect(res.body.appealUrl).toBe('/community/help#appeals');
  });

  it('publishes a valid discussion from a verified member', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send(validPost);
    expect(res.status).toBe(201);
    expect(res.body.pendingReview).toBe(false);
    expect(res.body.url).toMatch(/^\/community\/discussion\/[a-f0-9]{12}\//);
  });

  it('rejects a discussion with an unknown category', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send({ ...validPost, category: 'does-not-exist' });
    expect(res.status).toBe(400);
  });

  it('rejects a discussion that is too short', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send({ ...validPost, title: 'Help', body: 'plz' });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('strips script tags from a submitted body', async () => {
    await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send({
        ...validPost,
        body: '<p>Genuine question about catering</p><script>alert(1)</script>',
      });
    const created = mockDb.all('community_discussions').find(item => item.id !== 'd-1');
    expect(created.bodyHtml).not.toContain('script');
  });

  it('blocks a discussion linking to a blocked domain', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions')
      .set('Cookie', authCookie(users.member))
      .send({
        ...validPost,
        body: 'Great deals at https://top-casino-bonus.com for everyone reading this thread.',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONTENT_BLOCKED');
  });
});

// ─── Editing and ownership ───────────────────────────────────────────────────

describe('community ownership', () => {
  it('lets an author edit their own discussion and records the edit', async () => {
    const res = await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member))
      .send({ title: 'Marquee hire in Kent — recommendations please' });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].editedAt).toBeTruthy();
  });

  it('keeps the stable id when the title and slug change', async () => {
    await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member))
      .send({ title: 'A completely different question about venues' });
    const updated = mockDb.all('community_discussions')[0];
    expect(updated.stableId).toBe('aaaabbbbcccc');
    expect(updated.slug).toBe('a-completely-different-question-about-venues');
  });

  it('refuses to let one member edit another member’s discussion', async () => {
    const res = await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.other))
      .send({ title: 'Hijacked title for someone else’s thread' });
    expect(res.status).toBe(403);
    expect(mockDb.all('community_discussions')[0].title).toContain('Marquee hire');
  });

  it('soft-deletes rather than destroying a withdrawn discussion', async () => {
    const res = await request(app)
      .delete('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member));
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].state).toBe('removed');
  });
});

describe('community moderation on edit', () => {
  it('blocks an edit that introduces a blocked domain into published content', async () => {
    const res = await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member))
      .send({ body: 'Actually the best deals are at https://top-casino-bonus.com these days.' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CONTENT_BLOCKED');
    // The already-public body must be untouched.
    expect(mockDb.all('community_discussions')[0].bodyHtml).toContain('marquee');
    expect(mockDb.all('community_discussions')[0].state).toBe('published');
  });

  it('holds a published discussion for review when an edit scores high enough', async () => {
    const res = await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member))
      .send({
        body: 'CLICK HERE to buy now, limited time offer, whatsapp me on +447700900000 today.',
      });
    expect(res.status).toBe(200);
    expect(res.body.pendingReview).toBe(true);
    expect(mockDb.all('community_discussions')[0].state).toBe('quarantined');
  });

  it('leaves an ordinary edit published', async () => {
    const res = await request(app)
      .patch('/api/v1/community/discussions/d-1')
      .set('Cookie', authCookie(users.member))
      .send({ body: 'Updating this: we have now booked and can share the final costs.' });
    expect(res.status).toBe(200);
    expect(res.body.pendingReview).toBe(false);
    expect(mockDb.all('community_discussions')[0].state).toBe('published');
  });

  it('blocks a reply edit that introduces a blocked domain', async () => {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send({ body: 'A perfectly ordinary reply about marquee sizes.' });
    const created = mockDb.all('community_replies')[0];

    const res = await request(app)
      .patch(`/api/v1/community/replies/${created.id}`)
      .set('Cookie', authCookie(users.other))
      .send({ body: 'Edited to add https://mega-casino-wins.com for anyone interested.' });
    expect(res.status).toBe(422);
    expect(mockDb.all('community_replies')[0].bodyText).toContain('marquee');
  });
});

describe('community member handles', () => {
  it('never gives two members the same handle', async () => {
    mockDb.seed('users', [
      { ...users.member, communityHandle: undefined, displayName: 'Sam' },
      {
        ...users.other,
        id: 'u-twin',
        email: 'twin@example.com',
        communityHandle: undefined,
        displayName: 'Sam',
      },
    ]);

    const first = await community.ensureHandle(mockDb.all('users')[0]);
    const second = await community.ensureHandle(mockDb.all('users')[1]);

    expect(first).not.toBe(second);
    expect(first.toLowerCase()).toBe('sam');
  });

  it('persists the allocated handle so it is stable', async () => {
    mockDb.seed('users', [{ ...users.member, communityHandle: undefined, displayName: 'Robin' }]);
    const handle = await community.ensureHandle(mockDb.all('users')[0]);
    expect(mockDb.all('users')[0].communityHandle).toBe(handle);
    // A second call returns the stored handle rather than re-deriving it.
    expect(await community.ensureHandle(mockDb.all('users')[0])).toBe(handle);
  });
});

describe('community view records', () => {
  it('stores the TTL expiry as a Date so MongoDB can expire it', async () => {
    await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    const view = mockDb.all('community_views')[0];
    expect(view).toBeDefined();
    // A string here would be silently ignored by the TTL monitor.
    expect(view.expiresAt).toBeInstanceOf(Date);
    expect(view.viewedAt).toBeInstanceOf(Date);
  });

  it('does not store a raw IP address', async () => {
    await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    const view = mockDb.all('community_views')[0];
    expect(JSON.stringify(view)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

// ─── Replies ─────────────────────────────────────────────────────────────────

describe('community replies', () => {
  const reply = { body: 'We used a company in Maidstone and they were excellent.' };

  it('posts a reply and updates the discussion counters', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send(reply);
    expect(res.status).toBe(201);
    expect(mockDb.all('community_discussions')[0].replyCount).toBe(1);
  });

  it('refuses replies on a locked discussion', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ locked: true })]);
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send(reply);
    expect(res.status).toBe(409);
  });

  it('refuses replies on an archived discussion and points at starting a new one', async () => {
    mockDb.seed('community_discussions', [discussionFixture({ state: 'archived' })]);
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send(reply);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Start a new discussion');
  });

  it('holds a low-trust promotional reply to a dormant thread for review', async () => {
    mockDb.seed('community_discussions', [
      discussionFixture({
        createdAt: '2019-01-01T00:00:00.000Z',
        lastActivityAt: '2019-02-01T00:00:00.000Z',
      }),
    ]);
    mockDb.seed('users', [
      ...Object.values(users),
      {
        id: 'u-fresh',
        email: 'fresh@example.com',
        role: 'customer',
        verified: true,
        adultDeclaration: true,
        createdAt: NOW.toISOString(),
      },
    ]);
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie({ id: 'u-fresh', email: 'fresh@example.com', role: 'customer' }))
      .send({ body: 'We do this too, see https://cheap-marquees.example for our prices.' });
    expect(res.status).toBe(201);
    expect(res.body.pendingReview).toBe(true);
    // Held content does not appear in the public thread.
    const thread = await request(app).get('/api/v1/community/discussions/aaaabbbbcccc');
    expect(thread.body.replies).toHaveLength(0);
  });

  it('discloses when a supplier recommends their own business', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.supplier))
      .send({ body: 'We cover Kent for marquees.', selfRecommendation: 'true' });
    expect(res.status).toBe(201);
    expect(res.body.reply.supplierDisclosure.selfRecommendation).toBe(true);
    expect(res.body.reply.supplierDisclosure.label).toContain('own business');
  });

  it('refuses to let one member edit another member’s reply', async () => {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send(reply);
    const created = mockDb.all('community_replies')[0];
    const res = await request(app)
      .patch(`/api/v1/community/replies/${created.id}`)
      .set('Cookie', authCookie(users.member))
      .send({ body: 'Rewriting someone else’s words entirely.' });
    expect(res.status).toBe(403);
  });
});

// ─── Reactions, saves and follows ────────────────────────────────────────────

describe('community interactions', () => {
  /**
   * Post a reply and return its id.
   * @returns {Promise<string>} Reply id.
   */
  async function createReply() {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send({ body: 'A genuinely helpful answer about marquee sizes.' });
    return mockDb.all('community_replies')[0].id;
  }

  it('records a helpful reaction once, however many times it is sent', async () => {
    const replyId = await createReply();
    await request(app)
      .post(`/api/v1/community/posts/${replyId}/reactions`)
      .set('Cookie', authCookie(users.member))
      .send({ reaction: 'helpful' });
    const res = await request(app)
      .post(`/api/v1/community/posts/${replyId}/reactions`)
      .set('Cookie', authCookie(users.member))
      .send({ reaction: 'helpful' });
    expect(res.body.reactions.helpful).toBe(1);
  });

  it('refuses a reaction to your own post', async () => {
    const replyId = await createReply();
    const res = await request(app)
      .post(`/api/v1/community/posts/${replyId}/reactions`)
      .set('Cookie', authCookie(users.other))
      .send({ reaction: 'helpful' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown reaction', async () => {
    const replyId = await createReply();
    const res = await request(app)
      .post(`/api/v1/community/posts/${replyId}/reactions`)
      .set('Cookie', authCookie(users.member))
      .send({ reaction: 'upvote-to-the-moon' });
    expect(res.status).toBe(400);
  });

  it('saves and unsaves a discussion idempotently', async () => {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/save')
      .set('Cookie', authCookie(users.other));
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/save')
      .set('Cookie', authCookie(users.other));
    expect(mockDb.all('community_bookmarks')).toHaveLength(1);

    await request(app)
      .delete('/api/v1/community/discussions/aaaabbbbcccc/save')
      .set('Cookie', authCookie(users.other));
    expect(mockDb.all('community_bookmarks')).toHaveLength(0);
  });

  it('follows a discussion and notifies followers of a new reply', async () => {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/follow')
      .set('Cookie', authCookie(users.other));
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.supplier))
      .send({ body: 'Adding some detail about marquee flooring options.' });

    const notified = mockDb.all('notifications').map(item => item.userId);
    expect(notified).toContain(users.other.id);
    expect(notified).toContain(users.member.id);
    expect(notified).not.toContain(users.supplier.id);
  });

  it('does not notify twice for the same reply', async () => {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/follow')
      .set('Cookie', authCookie(users.other));
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.supplier))
      .send({ body: 'Adding some detail about marquee flooring options.' });
    const first = mockDb.all('notifications').length;
    // A repeat of the same notification id is ignored.
    await community.createNotification({
      id: mockDb.all('notifications')[0].id,
      userId: users.other.id,
      title: 'Duplicate',
    });
    expect(mockDb.all('notifications')).toHaveLength(first);
  });
});

// ─── Answers ─────────────────────────────────────────────────────────────────

describe('community answers', () => {
  /**
   * Post a reply and return its id.
   * @returns {Promise<string>} Reply id.
   */
  async function createReply() {
    await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/replies')
      .set('Cookie', authCookie(users.other))
      .send({ body: 'A genuinely helpful answer about marquee sizes.' });
    return mockDb.all('community_replies')[0].id;
  }

  it('lets the person who asked mark a helpful answer', async () => {
    const replyId = await createReply();
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/solve')
      .set('Cookie', authCookie(users.member))
      .send({ replyId });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].helpfulAnswerId).toBe(replyId);
  });

  it('refuses to let a bystander mark a helpful answer', async () => {
    const replyId = await createReply();
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/solve')
      .set('Cookie', authCookie(users.supplier))
      .send({ replyId });
    expect(res.status).toBe(403);
  });

  it('keeps official answers separate from helpful answers, and staff-only', async () => {
    const replyId = await createReply();
    const denied = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/official-answer')
      .set('Cookie', authCookie(users.member))
      .send({ replyId });
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/official-answer')
      .set('Cookie', authCookie(users.admin))
      .send({ replyId });
    expect(allowed.status).toBe(200);
    expect(allowed.body.verifiedAt).toBeTruthy();
    expect(mockDb.all('community_discussions')[0].helpfulAnswerId).toBeNull();
  });
});

// ─── Reports ─────────────────────────────────────────────────────────────────

describe('community reports', () => {
  it('accepts a report and tells the reporter what happens next', async () => {
    const res = await request(app)
      .post('/api/v1/community/posts/aaaabbbbcccc/report')
      .set('Cookie', authCookie(users.other))
      .send({ reason: 'spam', detail: 'Posted the same advert in five threads.' });
    expect(res.status).toBe(201);
    expect(mockDb.all('community_reports')).toHaveLength(1);
  });

  it('rejects an unknown reason', async () => {
    const res = await request(app)
      .post('/api/v1/community/posts/aaaabbbbcccc/report')
      .set('Cookie', authCookie(users.other))
      .send({ reason: 'i-do-not-like-it' });
    expect(res.status).toBe(400);
  });

  it('does not create a second report from the same person for the same post', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/community/posts/aaaabbbbcccc/report')
        .set('Cookie', authCookie(users.other))
        .send({ reason: 'spam' });
    await send();
    await send();
    expect(mockDb.all('community_reports')).toHaveLength(1);
  });

  it('quarantines content immediately for an escalation-category report', async () => {
    const res = await request(app)
      .post('/api/v1/community/posts/aaaabbbbcccc/report')
      .set('Cookie', authCookie(users.other))
      .send({ reason: 'child_safety' });
    expect(res.body.escalated).toBe(true);
    expect(mockDb.all('community_discussions')[0].state).toBe('quarantined');
  });

  it('captures a snapshot so a later edit cannot rewrite the evidence', async () => {
    await request(app)
      .post('/api/v1/community/posts/aaaabbbbcccc/report')
      .set('Cookie', authCookie(users.other))
      .send({ reason: 'spam' });
    expect(mockDb.all('community_reports')[0].snapshot.body).toContain('marquee');
  });

  it('reports a whole spam run from one account in a single action', async () => {
    mockDb.seed('community_discussions', [
      discussionFixture(),
      discussionFixture({ id: 'd-2', stableId: 'ddddeeeeffff', slug: 'second' }),
    ]);
    const res = await request(app)
      .post('/api/v1/community/reports/bulk')
      .set('Cookie', authCookie(users.other))
      .send({ handle: 'sam', reason: 'spam' });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    expect(mockDb.all('community_reports')).toHaveLength(2);
  });
});

// ─── Search and duplicates ───────────────────────────────────────────────────

describe('community search', () => {
  it('finds a discussion by a word in its title', async () => {
    const res = await request(app).get('/api/v1/community/search?q=marquee');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].snippet).toContain('<mark>');
  });

  it('escapes user content in search snippets', async () => {
    mockDb.seed('community_discussions', [
      discussionFixture({ bodyText: 'Try <script>alert(1)</script> marquee hire' }),
    ]);
    const res = await request(app).get('/api/v1/community/search?q=marquee');
    expect(res.body.results[0].snippet).not.toContain('<script>');
    expect(res.body.results[0].snippet).toContain('&lt;script&gt;');
  });

  it('returns nothing for a one-character query rather than everything', async () => {
    const res = await request(app).get('/api/v1/community/search?q=a');
    expect(res.body.results).toEqual([]);
  });

  it('suggests an existing discussion before someone creates a duplicate', async () => {
    const res = await request(app).get(
      '/api/v1/community/similar?title=Marquee hire in Kent who did you use'
    );
    expect(res.status).toBe(200);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it('suggests nothing for an unrelated title', async () => {
    const res = await request(app).get(
      '/api/v1/community/similar?title=Corporate awards dinner audio visual supplier'
    );
    expect(res.body.suggestions).toEqual([]);
  });
});

// ─── Member profiles and privacy ─────────────────────────────────────────────

describe('community member profiles', () => {
  it('returns a public profile without contact details', async () => {
    const res = await request(app).get('/api/v1/community/members/sam');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('member@example.com');
    expect(body).not.toContain('u-member');
  });

  it('404s an unknown handle', async () => {
    const res = await request(app).get('/api/v1/community/members/nobody');
    expect(res.status).toBe(404);
  });

  it('404s a handle with unexpected characters', async () => {
    const res = await request(app).get('/api/v1/community/members/..%2Fadmin');
    expect(res.status).toBe(404);
  });

  it('exports only the requesting member’s own community data', async () => {
    const res = await request(app)
      .get('/api/v1/community/me/export')
      .set('Cookie', authCookie(users.member));
    expect(res.status).toBe(200);
    expect(res.body.discussions).toHaveLength(1);
    expect(res.body.discussions[0].riskScore).toBeUndefined();
  });

  it('tells a member their own trust tier and link policy', async () => {
    const res = await request(app)
      .get('/api/v1/community/me')
      .set('Cookie', authCookie(users.member));
    expect(res.status).toBe(200);
    expect(res.body.trustTier).toBeDefined();
    expect(res.body.linkPolicy).toHaveProperty('linksClickable');
  });
});

// ─── Admin ───────────────────────────────────────────────────────────────────

describe('community admin centre', () => {
  it('refuses an ordinary member', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/dashboard')
      .set('Cookie', authCookie(users.member));
    expect(res.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/v1/admin/community/dashboard');
    expect(res.status).toBe(401);
  });

  it('serves health metrics to an admin, without vanity counts', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/dashboard')
      .set('Cookie', authCookie(users.admin));
    expect(res.status).toBe(200);
    expect(res.body.content.discussions).toBe(1);
    expect(res.body.responsiveness).toHaveProperty('medianHoursToFirstReply');
    expect(res.body.content.members).toBeUndefined();
  });

  it('shows risk signals to moderators that the public API withholds', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/content?state=published')
      .set('Cookie', authCookie(users.admin));
    expect(res.body.items[0].riskSignals).toContain('something_internal');
  });

  it('applies a moderation action and writes it to the audit trail', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', authCookie(users.admin))
      .send({ action: 'hide', reason: 'spam', publicReason: 'Promotional content' });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].state).toBe('hidden');
    expect(mockDb.all('community_moderation_actions')[0].moderatorId).toBe(users.admin.id);
  });

  it('tells the author when their content is moderated', async () => {
    await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', authCookie(users.admin))
      .send({ action: 'hide', publicReason: 'Promotional content' });
    const notification = mockDb.all('notifications').find(item => item.userId === users.member.id);
    expect(notification).toBeDefined();
    expect(notification.actionUrl).toContain('/community/help');
  });

  it('rejects an unknown moderation action', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', authCookie(users.admin))
      .send({ action: 'delete-everything' });
    expect(res.status).toBe(400);
  });

  it('records an upheld report against the reported member’s standing', async () => {
    mockDb.seed('community_reports', [
      {
        id: 'rep-1',
        targetType: 'discussion',
        targetId: 'd-1',
        reportedUserId: users.member.id,
        reporterId: users.other.id,
        reason: 'spam',
        status: 'open',
        priority: 'normal',
        createdAt: NOW.toISOString(),
      },
    ]);
    await request(app)
      .patch('/api/v1/admin/community/reports/rep-1')
      .set('Cookie', authCookie(users.admin))
      .send({ status: 'actioned', decision: 'Upheld' });
    const stats = mockDb.all('community_user_stats').find(item => item.userId === users.member.id);
    expect(stats.upheldReports).toBe(1);
  });

  it('normalises domains saved to the blocklist', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/settings')
      .set('Cookie', authCookie(users.admin))
      .send({ blockedDomains: ['https://WWW.Spam.Example/path', ' other.example '] });
    expect(res.status).toBe(200);
    expect(res.body.settings.blockedDomains).toEqual(['spam.example', 'other.example']);
  });

  it('seeds categories idempotently without touching existing ones', async () => {
    const before = mockDb.all('community_categories').length;
    const res = await request(app)
      .post('/api/v1/admin/community/seed-categories')
      .set('Cookie', authCookie(users.admin));
    expect(res.status).toBe(200);
    const after = mockDb.all('community_categories');
    expect(after.length).toBeGreaterThan(before);
    expect(after.find(item => item.slug === 'venues').name).toBe('Venues');

    const second = await request(app)
      .post('/api/v1/admin/community/seed-categories')
      .set('Cookie', authCookie(users.admin));
    expect(second.body.created).toBe(0);
  });

  it('never creates users, discussions or replies while seeding', async () => {
    await request(app)
      .post('/api/v1/admin/community/seed-categories')
      .set('Cookie', authCookie(users.admin));
    expect(mockDb.all('community_discussions')).toHaveLength(1);
    expect(mockDb.all('community_replies')).toHaveLength(0);
    expect(mockDb.all('users')).toHaveLength(Object.keys(users).length);
  });
});

// ─── Feature flag ────────────────────────────────────────────────────────────

describe('community feature flag', () => {
  afterEach(() => {
    delete process.env.COMMUNITY_ENABLED;
    community.invalidateSettingsCache();
  });

  it('takes the whole community offline when disabled', async () => {
    process.env.COMMUNITY_ENABLED = 'false';
    community.invalidateSettingsCache();
    const res = await request(app).get('/api/v1/community/categories');
    expect(res.status).toBe(404);
  });
});
