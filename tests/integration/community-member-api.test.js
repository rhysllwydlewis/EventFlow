/**
 * Integration tests for the member-facing community endpoints: search,
 * duplicate suggestions, profiles, drafts, mutes, appeals, polls and the
 * member's own data.
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
 * Match a record against the Mongo operators these routes use.
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
  };
});

const community = require('../../services/community.service');

const member = {
  id: 'u-member',
  email: 'member@example.com',
  role: 'customer',
  verified: true,
  adultDeclaration: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  communityHandle: 'sam',
  displayName: 'Sam',
  communityBio: 'Planning a wedding in Kent.',
  communityRegion: 'south-east',
  communityEventType: 'wedding',
};

const other = {
  id: 'u-other',
  email: 'other@example.com',
  role: 'customer',
  verified: true,
  adultDeclaration: true,
  createdAt: '2025-02-01T00:00:00.000Z',
  communityHandle: 'alex',
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
  slug: 'marquee-hire-in-kent',
  title: 'Marquee hire in Kent — who did you use?',
  bodyHtml: '<p>We need a marquee for 120 guests in September near Canterbury.</p>',
  bodyText: 'We need a marquee for 120 guests in September near Canterbury.',
  excerpt: 'We need a marquee for 120 guests in September.',
  authorId: member.id,
  author: { handle: 'sam', displayName: 'Sam', accountType: 'customer' },
  categorySlug: 'venues',
  categoryName: 'Venues',
  eventType: 'wedding',
  region: 'south-east',
  tags: ['marquee'],
  state: 'published',
  replyCount: 1,
  uniqueViews: 10,
  helpfulAnswerId: null,
  officialAnswerIds: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  lastActivityAt: '2026-07-20T00:00:00.000Z',
  poll: {
    question: 'Marquee or barn?',
    options: [
      { id: 'opt1', label: 'Marquee', votes: 0 },
      { id: 'opt2', label: 'Barn', votes: 0 },
    ],
    totalVotes: 0,
  },
};

const reply = {
  id: 'r-1',
  discussionId: 'd-1',
  discussionStableId: 'aaaabbbbcccc',
  authorId: member.id,
  author: { handle: 'sam', displayName: 'Sam' },
  bodyHtml: '<p>A helpful answer about flooring.</p>',
  bodyText: 'A helpful answer about flooring.',
  state: 'published',
  isHelpfulAnswer: true,
  createdAt: '2026-07-10T00:00:00.000Z',
  reactionCounts: { helpful: 1 },
};

let app;

beforeEach(() => {
  mockDb.reset();
  community.invalidateSettingsCache();
  mockDb.seed('users', [member, other]);
  mockDb.seed('community_categories', [
    { id: 'cat-venues', slug: 'venues', name: 'Venues', order: 10, visible: true, archived: false },
  ]);
  mockDb.seed('community_discussions', [discussion]);
  mockDb.seed('community_replies', [reply]);
  mockDb.seed('community_settings', []);
  mockDb.seed('community_user_stats', [
    { id: 'cs-1', userId: member.id, discussions: 1, replies: 1, helpfulAnswers: 3 },
  ]);
  mockDb.seed('community_bookmarks', []);
  mockDb.seed('community_follows', []);
  mockDb.seed('community_drafts', []);
  mockDb.seed('community_restrictions', []);
  mockDb.seed('community_appeals', []);
  mockDb.seed('community_poll_votes', []);
  mockDb.seed('community_reactions', []);

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/community', require('../../routes/community-discovery'));
  app.use('/api/v1/community', require('../../routes/community-interactions'));
});

describe('community search', () => {
  it('scores a title match above a body-only match', async () => {
    mockDb.seed('community_discussions', [
      discussion,
      {
        ...discussion,
        id: 'd-2',
        stableId: 'ddddeeeeffff',
        title: 'Catering questions',
        bodyText: 'We also looked at a marquee at one point.',
      },
    ]);
    const res = await request(app).get('/api/v1/community/search?q=marquee');
    expect(res.body.results[0].stableId).toBe('aaaabbbbcccc');
  });

  it('searches reply bodies as well as original posts', async () => {
    const res = await request(app).get('/api/v1/community/search?q=flooring');
    expect(res.body.results).toHaveLength(1);
  });

  it('returns facet counts', async () => {
    const res = await request(app).get('/api/v1/community/search?q=marquee');
    expect(res.body.facets.categories[0]).toEqual({ key: 'venues', count: 1 });
    expect(res.body.facets.eventTypes[0].key).toBe('wedding');
    expect(res.body.facets.regions[0].key).toBe('south-east');
  });

  it('honours an explicit sort instead of relevance', async () => {
    const res = await request(app).get('/api/v1/community/search?q=marquee&sort=newest');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
  });

  it('applies the shared filters to a search', async () => {
    const res = await request(app).get('/api/v1/community/search?q=marquee&region=scotland');
    expect(res.body.results).toHaveLength(0);
  });

  it('requires most query terms to match', async () => {
    const res = await request(app).get('/api/v1/community/search?q=marquee helicopters submarines');
    expect(res.body.results.length).toBeLessThanOrEqual(1);
  });

  it('de-weights an archived-freshness discussion', async () => {
    mockDb.seed('community_discussions', [
      { ...discussion, createdAt: '2019-01-01', lastActivityAt: '2019-02-01' },
    ]);
    const stale = await request(app).get('/api/v1/community/search?q=marquee');
    mockDb.seed('community_discussions', [discussion]);
    const fresh = await request(app).get('/api/v1/community/search?q=marquee');
    expect(fresh.body.results[0].relevance).toBeGreaterThan(stale.body.results[0].relevance);
  });
});

describe('duplicate suggestions', () => {
  it('says nothing for a title that is too short to judge', async () => {
    const res = await request(app).get('/api/v1/community/similar?title=hi');
    expect(res.body.suggestions).toEqual([]);
  });

  it('marks an older suggestion as archived so the age is visible', async () => {
    mockDb.seed('community_discussions', [
      { ...discussion, createdAt: '2019-01-01', lastActivityAt: '2019-02-01' },
    ]);
    const res = await request(app).get(
      '/api/v1/community/similar?title=Marquee hire in Kent who did you use'
    );
    expect(res.body.suggestions[0].freshness).toBe('archive');
  });
});

describe('member profiles', () => {
  it('returns the published profile with optional context labels', async () => {
    const res = await request(app).get('/api/v1/community/members/sam');
    expect(res.status).toBe(200);
    expect(res.body.member.bio).toContain('Planning a wedding');
    expect(res.body.member.regionLabel).toBe('South East');
    expect(res.body.member.eventTypeLabel).toBe('Wedding');
    expect(res.body.stats.helpfulAnswers).toBe(3);
  });

  it('lists the member’s discussions and replies', async () => {
    const res = await request(app).get('/api/v1/community/members/sam');
    expect(res.body.discussions).toHaveLength(1);
    expect(res.body.replies[0].isHelpfulAnswer).toBe(true);
    expect(res.body.replies[0].url).toContain('#reply-r-1');
  });

  it('omits content that is not public', async () => {
    mockDb.seed('community_discussions', [{ ...discussion, state: 'removed' }]);
    mockDb.seed('community_replies', [{ ...reply, state: 'hidden' }]);
    const res = await request(app).get('/api/v1/community/members/sam');
    expect(res.status).toBe(404);
  });
});

describe('the member’s own state', () => {
  it('reports the trust tier, link policy and declaration state', async () => {
    const res = await request(app).get('/api/v1/community/me').set('Cookie', cookie(member));
    expect(res.status).toBe(200);
    expect(res.body.adultDeclared).toBe(true);
    expect(res.body.emailVerified).toBe(true);
    expect(res.body.restriction).toBeNull();
    expect(res.body.notificationPreferences.email).toBe('weekly');
  });

  it('reports an active restriction with its appeal route', async () => {
    mockDb.seed('community_restrictions', [
      {
        id: 'res-1',
        userId: member.id,
        type: 'read_only',
        active: true,
        publicReason: 'Repeated promotion',
      },
    ]);
    const res = await request(app).get('/api/v1/community/me').set('Cookie', cookie(member));
    expect(res.body.restriction.type).toBe('read_only');
    expect(res.body.restriction.appealable).toBe(true);
  });

  // Every community page asks who is looking at it. Refusing an anonymous
  // visitor made an ordinary logged-out visit produce a console error and a
  // wasted round trip, so the endpoint reports the absence of a member instead.
  it('tells an anonymous visitor that nobody is signed in', async () => {
    const res = await request(app).get('/api/v1/community/me');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('leaks no member state to an anonymous visitor', async () => {
    const res = await request(app).get('/api/v1/community/me');
    expect(Object.keys(res.body)).toEqual(['authenticated']);
  });

  it('marks a signed-in member as authenticated', async () => {
    const res = await request(app).get('/api/v1/community/me').set('Cookie', cookie(member));
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.handle).toBeTruthy();
  });

  it('records the adult declaration', async () => {
    mockDb.seed('users', [{ ...member, adultDeclaration: false }, other]);
    const res = await request(app)
      .post('/api/v1/community/me/adult-declaration')
      .set('Cookie', cookie(member))
      .send({ confirmed: true });
    expect(res.status).toBe(200);
    expect(mockDb.all('users')[0].adultDeclaration).toBe(true);
  });

  it('rejects an unconfirmed declaration', async () => {
    const res = await request(app)
      .post('/api/v1/community/me/adult-declaration')
      .set('Cookie', cookie(member))
      .send({ confirmed: false });
    expect(res.status).toBe(400);
  });
});

describe('the member’s profile settings', () => {
  it('updates the optional public fields', async () => {
    const res = await request(app)
      .patch('/api/v1/community/me/profile')
      .set('Cookie', cookie(member))
      .send({
        bio: 'Updated bio',
        displayName: 'Sam P',
        region: 'scotland',
        eventType: 'corporate',
        notificationPreferences: { inApp: false, email: 'daily' },
      });
    expect(res.status).toBe(200);
    const stored = mockDb.all('users')[0];
    expect(stored.communityBio).toBe('Updated bio');
    expect(stored.communityRegion).toBe('scotland');
    expect(stored.communityNotificationPreferences.email).toBe('daily');
  });

  it('clears an unrecognised region rather than storing it', async () => {
    await request(app)
      .patch('/api/v1/community/me/profile')
      .set('Cookie', cookie(member))
      .send({ region: 'atlantis', eventType: 'moon-landing' });
    const stored = mockDb.all('users')[0];
    expect(stored.communityRegion).toBeNull();
    expect(stored.communityEventType).toBeNull();
  });

  it('falls back to a known email preference', async () => {
    await request(app)
      .patch('/api/v1/community/me/profile')
      .set('Cookie', cookie(member))
      .send({ notificationPreferences: { email: 'hourly' } });
    expect(mockDb.all('users')[0].communityNotificationPreferences.email).toBe('weekly');
  });

  it('strips HTML from the biography', async () => {
    await request(app)
      .patch('/api/v1/community/me/profile')
      .set('Cookie', cookie(member))
      .send({ bio: '<script>alert(1)</script>Just a planner' });
    expect(mockDb.all('users')[0].communityBio).not.toContain('script');
  });

  it('rejects an empty update', async () => {
    const res = await request(app)
      .patch('/api/v1/community/me/profile')
      .set('Cookie', cookie(member))
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('saved, following and drafts', () => {
  it('returns saved discussions', async () => {
    mockDb.seed('community_bookmarks', [
      { id: 'b-1', userId: member.id, discussionId: 'd-1', createdAt: '2026-07-02' },
    ]);
    const res = await request(app).get('/api/v1/community/me/saved').set('Cookie', cookie(member));
    expect(res.body.discussions).toHaveLength(1);
  });

  it('returns followed categories and discussions', async () => {
    mockDb.seed('community_follows', [
      { id: 'f-1', userId: member.id, targetType: 'category', targetId: 'cat-venues' },
      { id: 'f-2', userId: member.id, targetType: 'discussion', targetId: 'd-1' },
    ]);
    const res = await request(app)
      .get('/api/v1/community/me/following')
      .set('Cookie', cookie(member));
    expect(res.body.categories).toHaveLength(1);
    expect(res.body.discussions).toHaveLength(1);
  });

  it('creates, lists, replaces and deletes a draft', async () => {
    const created = await request(app)
      .put('/api/v1/community/me/drafts')
      .set('Cookie', cookie(member))
      .send({ title: 'A draft title', category: 'venues', body: 'Some thoughts so far.' });
    expect(created.status).toBe(200);
    const draftId = created.body.draft.id;

    const listed = await request(app)
      .get('/api/v1/community/me/drafts')
      .set('Cookie', cookie(member));
    expect(listed.body.drafts).toHaveLength(1);

    await request(app)
      .put('/api/v1/community/me/drafts')
      .set('Cookie', cookie(member))
      .send({ id: draftId, title: 'Revised title', body: 'More thoughts.' });
    expect(mockDb.all('community_drafts')).toHaveLength(1);
    expect(mockDb.all('community_drafts')[0].title).toBe('Revised title');

    const deleted = await request(app)
      .delete(`/api/v1/community/me/drafts/${draftId}`)
      .set('Cookie', cookie(member));
    expect(deleted.status).toBe(200);
    expect(mockDb.all('community_drafts')).toHaveLength(0);
  });
});

describe('mutes and appeals', () => {
  it('mutes a member, a category and a discussion', async () => {
    for (const kind of ['user', 'category', 'discussion']) {
      const res = await request(app)
        .post('/api/v1/community/me/mutes')
        .set('Cookie', cookie(member))
        .send({ kind, targetId: 'target-1' });
      expect(res.status).toBe(200);
    }
    expect(mockDb.all('community_restrictions')).toHaveLength(3);
  });

  it('rejects an unknown mute kind', async () => {
    const res = await request(app)
      .post('/api/v1/community/me/mutes')
      .set('Cookie', cookie(member))
      .send({ kind: 'planet', targetId: 'x' });
    expect(res.status).toBe(400);
  });

  it('does not duplicate a mute', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/community/me/mutes')
        .set('Cookie', cookie(member))
        .send({ kind: 'user', targetId: 'target-1' });
    await send();
    await send();
    expect(mockDb.all('community_restrictions')).toHaveLength(1);
  });

  it('removes a self-applied mute', async () => {
    mockDb.seed('community_restrictions', [
      {
        id: 'mute-1',
        userId: member.id,
        type: 'muted_user',
        targetId: 't',
        active: true,
        selfApplied: true,
      },
    ]);
    const res = await request(app)
      .delete('/api/v1/community/me/mutes/mute-1')
      .set('Cookie', cookie(member));
    expect(res.status).toBe(200);
    expect(mockDb.all('community_restrictions')).toHaveLength(0);
  });

  it('will not let a member remove a moderator restriction as if it were a mute', async () => {
    mockDb.seed('community_restrictions', [
      { id: 'res-1', userId: member.id, type: 'read_only', active: true, selfApplied: false },
    ]);
    const res = await request(app)
      .delete('/api/v1/community/me/mutes/res-1')
      .set('Cookie', cookie(member));
    expect(res.status).toBe(404);
    expect(mockDb.all('community_restrictions')).toHaveLength(1);
  });

  it('submits an appeal', async () => {
    const res = await request(app)
      .post('/api/v1/community/me/appeals')
      .set('Cookie', cookie(member))
      .send({ targetType: 'content', targetId: 'd-1', message: 'This was on topic and useful.' });
    expect(res.status).toBe(201);
    expect(mockDb.all('community_appeals')).toHaveLength(1);
  });

  it('rejects an appeal with no explanation', async () => {
    const res = await request(app)
      .post('/api/v1/community/me/appeals')
      .set('Cookie', cookie(member))
      .send({ message: 'unfair' });
    expect(res.status).toBe(400);
  });
});

describe('polls', () => {
  it('records a vote and recomputes the totals', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/poll-vote')
      .set('Cookie', cookie(other))
      .send({ optionId: 'opt1' });
    expect(res.status).toBe(200);
    expect(res.body.poll.totalVotes).toBe(1);
    expect(res.body.poll.options[0].votes).toBe(1);
  });

  it('refuses a second vote from the same member', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/community/discussions/aaaabbbbcccc/poll-vote')
        .set('Cookie', cookie(other))
        .send({ optionId: 'opt1' });
    await send();
    const res = await send();
    expect(res.status).toBe(409);
  });

  it('rejects an unknown option', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/poll-vote')
      .set('Cookie', cookie(other))
      .send({ optionId: 'opt99' });
    expect(res.status).toBe(400);
  });

  it('404s a discussion with no poll', async () => {
    mockDb.seed('community_discussions', [{ ...discussion, poll: null }]);
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/poll-vote')
      .set('Cookie', cookie(other))
      .send({ optionId: 'opt1' });
    expect(res.status).toBe(404);
  });
});

describe('reactions and answers, error paths', () => {
  it('rejects an unknown reaction on removal', async () => {
    const res = await request(app)
      .delete('/api/v1/community/posts/r-1/reactions/upvote')
      .set('Cookie', cookie(member));
    expect(res.status).toBe(400);
  });

  it('removes an existing reaction', async () => {
    await request(app)
      .post('/api/v1/community/posts/r-1/reactions')
      .set('Cookie', cookie(other))
      .send({ reaction: 'thanks' });
    const res = await request(app)
      .delete('/api/v1/community/posts/r-1/reactions/thanks')
      .set('Cookie', cookie(other));
    expect(res.status).toBe(200);
    expect(res.body.reactions.thanks).toBeUndefined();
  });

  it('404s a reaction on content that is not published', async () => {
    mockDb.seed('community_replies', [{ ...reply, state: 'hidden' }]);
    const res = await request(app)
      .post('/api/v1/community/posts/r-1/reactions')
      .set('Cookie', cookie(other))
      .send({ reaction: 'helpful' });
    expect(res.status).toBe(404);
  });

  it('clears the helpful answer when no reply id is given', async () => {
    mockDb.seed('community_discussions', [{ ...discussion, helpfulAnswerId: 'r-1' }]);
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/solve')
      .set('Cookie', cookie(member))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.solved).toBe(false);
    expect(mockDb.all('community_discussions')[0].helpfulAnswerId).toBeNull();
  });

  it('rejects a helpful answer that is not part of the discussion', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/aaaabbbbcccc/solve')
      .set('Cookie', cookie(member))
      .send({ replyId: 'r-elsewhere' });
    expect(res.status).toBe(400);
  });

  it('404s solving an unknown discussion', async () => {
    const res = await request(app)
      .post('/api/v1/community/discussions/ffffffffffff/solve')
      .set('Cookie', cookie(member))
      .send({ replyId: 'r-1' });
    expect(res.status).toBe(404);
  });

  it('lists the public report vocabulary', async () => {
    const res = await request(app).get('/api/v1/community/report-reasons');
    expect(res.status).toBe(200);
    expect(res.body.reasons.length).toBeGreaterThan(10);
  });

  it('404s a report against content that does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/community/posts/ffffffffffff/report')
      .send({ reason: 'spam' });
    expect(res.status).toBe(404);
  });

  it('rejects a bulk report with no account named', async () => {
    const res = await request(app)
      .post('/api/v1/community/reports/bulk')
      .set('Cookie', cookie(other))
      .send({ reason: 'spam' });
    expect(res.status).toBe(400);
  });

  it('404s a bulk report against an account with no public posts', async () => {
    const res = await request(app)
      .post('/api/v1/community/reports/bulk')
      .set('Cookie', cookie(other))
      .send({ handle: 'nobody', reason: 'spam' });
    expect(res.status).toBe(404);
  });

  it('rejects a bulk report with an unknown reason', async () => {
    const res = await request(app)
      .post('/api/v1/community/reports/bulk')
      .set('Cookie', cookie(other))
      .send({ handle: 'sam', reason: 'vibes' });
    expect(res.status).toBe(400);
  });
});
