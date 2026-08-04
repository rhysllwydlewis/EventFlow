/**
 * Integration tests for the EventFlow Community admin and moderation centre.
 *
 * Every endpoint is exercised through the real middleware chain, including the
 * moderator and senior-moderator gates and the error paths.
 */

'use strict';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const store = new Map();

/**
 * Match a record against the small subset of Mongo operators these routes use.
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
  deleteOne: jest.fn(async () => true),
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
  };
});

const community = require('../../services/community.service');

const users = {
  member: {
    id: 'u-member',
    email: 'member@example.com',
    role: 'customer',
    verified: true,
    adultDeclaration: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    communityHandle: 'sam',
  },
  moderator: {
    id: 'u-mod',
    email: 'mod@example.com',
    role: 'customer',
    communityRole: 'moderator',
    verified: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    communityHandle: 'modsam',
  },
  admin: {
    id: 'u-admin',
    email: 'admin@example.com',
    role: 'admin',
    verified: true,
    createdAt: '2023-01-01T00:00:00.000Z',
    communityHandle: 'eventflowteam',
  },
};

/**
 * Build an auth cookie for a fixture user.
 * @param {Object} user User fixture.
 * @returns {string} Cookie header value.
 */
function cookie(user) {
  return `token=${jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  )}`;
}

const discussion = {
  id: 'd-1',
  stableId: 'aaaabbbbcccc',
  slug: 'marquee-hire',
  title: 'Marquee hire in Kent',
  bodyHtml: '<p>Original body</p>',
  bodyText: 'Original body',
  excerpt: 'Original body',
  authorId: users.member.id,
  author: { handle: 'sam', displayName: 'Sam' },
  categorySlug: 'venues',
  categoryName: 'Venues',
  state: 'published',
  replyCount: 1,
  createdAt: '2026-07-01T00:00:00.000Z',
  lastActivityAt: '2026-07-05T00:00:00.000Z',
  riskScore: 10,
  riskSignals: ['internal_signal'],
};

const reply = {
  id: 'r-1',
  discussionId: 'd-1',
  discussionStableId: 'aaaabbbbcccc',
  authorId: users.member.id,
  author: { handle: 'sam', displayName: 'Sam' },
  bodyHtml: '<p>A reply</p>',
  bodyText: 'A reply',
  state: 'published',
  createdAt: '2026-07-05T00:00:00.000Z',
  reactionCounts: { helpful: 2 },
  isOfficialAnswer: false,
};

let app;

beforeEach(() => {
  mockDb.reset();
  community.invalidateSettingsCache();
  mockDb.seed('users', Object.values(users));
  mockDb.seed('community_categories', [
    {
      id: 'cat-venues',
      slug: 'venues',
      name: 'Venues',
      description: 'Venues',
      order: 10,
      visible: true,
      archived: false,
    },
  ]);
  mockDb.seed('community_discussions', [discussion]);
  mockDb.seed('community_replies', [reply]);
  mockDb.seed('community_reports', []);
  mockDb.seed('community_appeals', []);
  mockDb.seed('community_restrictions', []);
  mockDb.seed('community_moderation_actions', []);
  mockDb.seed('community_settings', []);
  mockDb.seed('community_user_stats', []);
  mockDb.seed('notifications', []);

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/admin/community', require('../../routes/admin-community'));
});

describe('admin dashboard', () => {
  it('computes responsiveness from real reply timings', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/dashboard')
      .set('Cookie', cookie(users.admin));
    expect(res.status).toBe(200);
    expect(res.body.responsiveness.medianHoursToFirstReply).toBeGreaterThan(0);
    expect(res.body.content.answeredPercentage).toBe(100);
  });

  it('reports no median when nothing has been answered', async () => {
    mockDb.seed('community_replies', []);
    const res = await request(app)
      .get('/api/v1/admin/community/dashboard')
      .set('Cookie', cookie(users.admin));
    expect(res.body.responsiveness.medianHoursToFirstReply).toBeNull();
    expect(res.body.content.unanswered).toBe(1);
  });

  it('is open to a community moderator, not only a global admin', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/dashboard')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(200);
  });
});

describe('admin categories', () => {
  it('lists categories including hidden ones', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/categories')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(1);
  });

  it('creates a category', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/categories')
      .set('Cookie', cookie(users.admin))
      .send({ name: 'Transport', description: 'Getting people there', icon: '🚐', order: 5 });
    expect(res.status).toBe(201);
    expect(res.body.category.slug).toBe('transport');
  });

  it('rejects a category without a usable name', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/categories')
      .set('Cookie', cookie(users.admin))
      .send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate category address', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/categories')
      .set('Cookie', cookie(users.admin))
      .send({ name: 'Venues' });
    expect(res.status).toBe(409);
  });

  it('refuses category creation to a plain moderator', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/categories')
      .set('Cookie', cookie(users.moderator))
      .send({ name: 'Transport' });
    expect(res.status).toBe(403);
  });

  it('updates, hides and archives a category', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/categories/cat-venues')
      .set('Cookie', cookie(users.admin))
      .send({
        name: 'Venues and spaces',
        description: 'Updated',
        rules: 'Be specific',
        icon: '🏰',
        order: 3,
        visible: false,
        archived: true,
      });
    expect(res.status).toBe(200);
    const updated = mockDb.all('community_categories')[0];
    expect(updated.name).toBe('Venues and spaces');
    expect(updated.visible).toBe(false);
    expect(updated.archived).toBe(true);
  });

  it('404s an unknown category', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/categories/nope')
      .set('Cookie', cookie(users.admin))
      .send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });
});

describe('admin content review', () => {
  it('lists discussions with their risk signals', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/content?state=published')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.items[0].riskSignals).toContain('internal_signal');
  });

  it('lists replies when asked', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/content?type=reply')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.type).toBe('reply');
    expect(res.body.items).toHaveLength(1);
  });

  it('supports free-text search over content', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/content?q=marquee')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.items).toHaveLength(1);

    const miss = await request(app)
      .get('/api/v1/admin/community/content?q=zzzznothing')
      .set('Cookie', cookie(users.moderator));
    expect(miss.body.items).toHaveLength(0);
  });

  const stateActions = [
    ['hide', 'hidden'],
    ['remove', 'removed'],
    ['quarantine', 'quarantined'],
    ['approve', 'published'],
    ['restore', 'published'],
    ['archive', 'archived'],
    ['mark_spam', 'removed'],
  ];

  it.each(stateActions)('applies %s and moves the state to %s', async (action, state) => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action, reason: 'testing', publicReason: 'A reason' });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].state).toBe(state);
  });

  const flagActions = [
    ['lock', 'locked', true],
    ['unlock', 'locked', false],
    ['pin', 'pinned', true],
    ['unpin', 'pinned', false],
    ['feature', 'featured', true],
    ['unfeature', 'featured', false],
  ];

  it.each(flagActions)('applies %s and sets %s to %s', async (action, field, value) => {
    await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action });
    expect(mockDb.all('community_discussions')[0][field]).toBe(value);
  });

  it('moves a discussion to another category', async () => {
    mockDb.seed('community_categories', [
      ...mockDb.all('community_categories'),
      { id: 'cat-chat', slug: 'general-event-chat', name: 'General event chat', visible: true },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'move', categorySlug: 'general-event-chat' });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_discussions')[0].categoryName).toBe('General event chat');
  });

  it('rejects a move to an unknown category', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'move', categorySlug: 'does-not-exist' });
    expect(res.status).toBe(400);
  });

  it('supersedes a discussion with a canonical replacement', async () => {
    mockDb.seed('community_discussions', [
      discussion,
      { ...discussion, id: 'd-2', stableId: 'ddddeeeeffff', slug: 'newer' },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'supersede', canonicalStableId: 'ddddeeeeffff' });
    expect(res.status).toBe(200);
    const updated = mockDb.all('community_discussions')[0];
    expect(updated.state).toBe('superseded');
    expect(updated.locked).toBe(true);
    expect(mockDb.all('community_canonical_links')).toHaveLength(1);
  });

  it('rejects a supersede with an unknown canonical discussion', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'supersede', canonicalStableId: 'ffffffffffff' });
    expect(res.status).toBe(400);
  });

  it('redacts personal information from a post', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'redact', body: 'Contact details removed by a moderator.' });
    expect(res.status).toBe(200);
    const updated = mockDb.all('community_discussions')[0];
    expect(updated.bodyText).toBe('Contact details removed by a moderator.');
    expect(updated.redactedAt).toBeTruthy();
  });

  it('rejects a redaction with no replacement text', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'redact' });
    expect(res.status).toBe(400);
  });

  it('sets a moderator notice on a discussion', async () => {
    await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'lock', moderatorNotice: 'Locked while we check the facts.' });
    expect(mockDb.all('community_discussions')[0].moderatorNotice).toContain('Locked while');
  });

  it('acts on a reply as well as a discussion', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/reply/r-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'hide' });
    expect(res.status).toBe(200);
    expect(mockDb.all('community_replies')[0].state).toBe('hidden');
  });

  it('404s unknown content', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/nope/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'hide' });
    expect(res.status).toBe(404);
  });

  it('refuses a member', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.member))
      .send({ action: 'hide' });
    expect(res.status).toBe(403);
  });
});

describe('admin reports', () => {
  const report = {
    id: 'rep-1',
    targetType: 'discussion',
    targetId: 'd-1',
    discussionStableId: 'aaaabbbbcccc',
    reportedUserId: users.member.id,
    reporterId: 'u-reporter',
    reason: 'spam',
    reasonLabel: 'Spam or unwanted promotion',
    detail: 'Posted five times',
    priority: 'normal',
    status: 'open',
    snapshot: { title: 'Marquee hire in Kent', body: 'Original body' },
    createdAt: '2026-07-06T00:00:00.000Z',
  };

  beforeEach(() => {
    mockDb.seed('community_reports', [
      report,
      { ...report, id: 'rep-2', priority: 'urgent', reason: 'child_safety', status: 'escalated' },
    ]);
  });

  it('orders the queue by priority then age', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/reports')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.reports[0].priority).toBe('urgent');
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/reports?status=open')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.reports).toHaveLength(1);
  });

  it('searches report detail', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/reports?q=five')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.reports).toHaveLength(2);
  });

  it('assigns a report to the acting moderator', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/reports/rep-1')
      .set('Cookie', cookie(users.moderator))
      .send({ assignToMe: true });
    expect(res.status).toBe(200);
    expect(res.body.report.assignedTo).toBe(users.moderator.id);
    expect(res.body.report.status).toBe('in_review');
  });

  it('dismisses a report and tells the reporter', async () => {
    await request(app)
      .patch('/api/v1/admin/community/reports/rep-1')
      .set('Cookie', cookie(users.moderator))
      .send({ status: 'dismissed', decision: 'No breach', decisionReason: 'Within guidelines' });
    const notification = mockDb.all('notifications').find(item => item.userId === 'u-reporter');
    expect(notification.message).toContain('did not break');
  });

  it('will not let a plain moderator resolve an escalated report', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/reports/rep-2')
      .set('Cookie', cookie(users.moderator))
      .send({ status: 'actioned' });
    expect(res.status).toBe(403);
  });

  it('lets a senior moderator resolve an escalated report', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/reports/rep-2')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'actioned', actionTaken: 'removed' });
    expect(res.status).toBe(200);
  });

  it('404s an unknown report', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/reports/nope')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'dismissed' });
    expect(res.status).toBe(404);
  });
});

describe('admin members and restrictions', () => {
  it('shows a member’s posts, reports and standing without contact details', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/members/sam')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(200);
    expect(res.body.posts.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('member@example.com');
  });

  it('404s a member with no community activity', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/members/nobody')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(404);
  });

  const restrictionTypes = ['warned', 'read_only', 'link_blocked'];

  it.each(restrictionTypes)('applies a %s restriction and notifies the member', async type => {
    const res = await request(app)
      .post('/api/v1/admin/community/restrictions')
      .set('Cookie', cookie(users.moderator))
      .send({
        userId: users.member.id,
        type,
        reason: 'Repeated promotion',
        publicReason: 'Repeated promotional posts',
        days: 7,
      });
    expect(res.status).toBe(201);
    expect(res.body.restriction.expiresAt).toBeTruthy();
    const notification = mockDb.all('notifications').find(item => item.userId === users.member.id);
    expect(notification.actionUrl).toContain('/community/help');
  });

  it('will not let a plain moderator suspend an account', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/restrictions')
      .set('Cookie', cookie(users.moderator))
      .send({ userId: users.member.id, type: 'suspended' });
    expect(res.status).toBe(403);
  });

  it('lets a senior moderator suspend an account indefinitely', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/restrictions')
      .set('Cookie', cookie(users.admin))
      .send({ userId: users.member.id, type: 'suspended' });
    expect(res.status).toBe(201);
    expect(res.body.restriction.expiresAt).toBeNull();
  });

  it('rejects an unknown restriction type', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/restrictions')
      .set('Cookie', cookie(users.admin))
      .send({ userId: users.member.id, type: 'banished' });
    expect(res.status).toBe(400);
  });

  it('404s a restriction on an unknown member', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/restrictions')
      .set('Cookie', cookie(users.admin))
      .send({ userId: 'nobody', type: 'warned' });
    expect(res.status).toBe(404);
  });

  it('lifts a restriction', async () => {
    mockDb.seed('community_restrictions', [
      { id: 'res-1', userId: users.member.id, type: 'read_only', active: true, selfApplied: false },
    ]);
    const res = await request(app)
      .delete('/api/v1/admin/community/restrictions/res-1')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(200);
    expect(mockDb.all('community_restrictions')[0].active).toBe(false);
  });

  it('will not lift a member’s own mute through the admin route', async () => {
    mockDb.seed('community_restrictions', [
      {
        id: 'mute-1',
        userId: users.member.id,
        type: 'muted_user',
        active: true,
        selfApplied: true,
      },
    ]);
    const res = await request(app)
      .delete('/api/v1/admin/community/restrictions/mute-1')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(404);
  });
});

describe('admin appeals', () => {
  beforeEach(() => {
    mockDb.seed('community_appeals', [
      {
        id: 'app-1',
        userId: users.member.id,
        targetType: 'content',
        targetId: 'd-1',
        message: 'I do not think this broke the guidelines because it was on topic.',
        status: 'open',
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
  });

  it('lists appeals for a senior moderator', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/appeals')
      .set('Cookie', cookie(users.admin));
    expect(res.status).toBe(200);
    expect(res.body.appeals).toHaveLength(1);
  });

  it('refuses the appeals queue to a plain moderator', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/appeals')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(403);
  });

  it('overturns an appeal and tells the member', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/appeals/app-1')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'overturned', decision: 'Reinstated', decisionReason: 'On reflection' });
    expect(res.status).toBe(200);
    const notification = mockDb.all('notifications').find(item => item.userId === users.member.id);
    expect(notification.title).toContain('successful');
  });

  it('upholds an appeal', async () => {
    await request(app)
      .patch('/api/v1/admin/community/appeals/app-1')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'upheld', decision: 'Decision stands' });
    const notification = mockDb.all('notifications').find(item => item.userId === users.member.id);
    expect(notification.title).toContain('reviewed your appeal');
  });

  it('rejects an unknown appeal status', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/appeals/app-1')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'ignored' });
    expect(res.status).toBe(400);
  });

  it('404s an unknown appeal', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/appeals/nope')
      .set('Cookie', cookie(users.admin))
      .send({ status: 'upheld' });
    expect(res.status).toBe(404);
  });
});

describe('admin settings and audit', () => {
  it('reads the effective settings', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.admin));
    expect(res.status).toBe(200);
    expect(res.body.settings.requireAdultDeclaration).toBe(true);
  });

  it('refuses settings to a plain moderator', async () => {
    const res = await request(app)
      .get('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(403);
  });

  it('updates booleans and numbers', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.admin))
      .send({
        quarantineLowTrustLinks: false,
        requireAdultDeclaration: false,
        autoArchiveDays: 500,
        maxRepliesPerHour: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.settings.autoArchiveDays).toBe(500);
    expect(res.body.settings.quarantineLowTrustLinks).toBe(false);
  });

  it('ignores a non-numeric value for a numeric setting', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.admin))
      .send({ autoArchiveDays: 'soon' });
    expect(res.body.settings.autoArchiveDays).toBe(1095);
  });

  it('updates an existing settings document rather than inserting a second', async () => {
    await request(app)
      .patch('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.admin))
      .send({ maxDiscussionsPerDay: 3 });
    await request(app)
      .patch('/api/v1/admin/community/settings')
      .set('Cookie', cookie(users.admin))
      .send({ maxDiscussionsPerDay: 4 });
    expect(mockDb.all('community_settings')).toHaveLength(1);
  });

  it('returns the audit trail, newest first', async () => {
    await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'hide', reason: 'spam' });
    const res = await request(app)
      .get('/api/v1/admin/community/audit')
      .set('Cookie', cookie(users.moderator));
    expect(res.status).toBe(200);
    expect(res.body.actions[0].action).toBe('hide');
  });

  it('searches the audit trail', async () => {
    await request(app)
      .post('/api/v1/admin/community/content/discussion/d-1/action')
      .set('Cookie', cookie(users.moderator))
      .send({ action: 'hide', reason: 'spam' });
    const res = await request(app)
      .get('/api/v1/admin/community/audit?q=zzzz')
      .set('Cookie', cookie(users.moderator));
    expect(res.body.actions).toHaveLength(0);
  });

  it('seeds categories on demand', async () => {
    const res = await request(app)
      .post('/api/v1/admin/community/seed-categories')
      .set('Cookie', cookie(users.admin));
    expect(res.status).toBe(200);
    expect(res.body.created).toBeGreaterThan(0);
  });
});
