/**
 * Unit tests for the EventFlow Community data service: identity, ranking,
 * reputation, filtering and the public projections.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
  insertOne: jest.fn(async () => true),
  updateOne: jest.fn(async () => true),
  deleteOne: jest.fn(async () => true),
  read: jest.fn(async () => []),
}));

const community = require('../../services/community.service');
const { CONTENT_STATES } = require('../../models/CommunityContent');

describe('community identity', () => {
  it('creates a stable, url-safe discussion id', () => {
    const id = community.createStableId();
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(community.createStableId()).not.toBe(id);
  });

  it('slugifies a title for readability', () => {
    expect(community.slugify('Marquee hire in Kent — who did you use?')).toBe(
      'marquee-hire-in-kent-who-did-you-use'
    );
  });

  it('falls back to a usable slug when a title has no usable characters', () => {
    expect(community.slugify('!!!')).toBe('discussion');
  });

  it('builds a discussion path from the stable id, not the title', () => {
    const discussion = {
      stableId: 'abc123abc123',
      slug: 'original-title',
      title: 'Original title',
    };
    expect(community.discussionPath(discussion)).toBe(
      '/community/discussion/abc123abc123/original-title'
    );
  });

  it('keeps the same stable id when a title changes', () => {
    const discussion = { stableId: 'abc123abc123', title: 'A new title' };
    expect(community.discussionPath(discussion)).toContain('abc123abc123');
  });

  it('derives a unique public handle when one is taken', () => {
    const taken = new Set(['jordan']);
    expect(community.deriveHandle({ firstName: 'Jordan' }, taken)).not.toBe('jordan');
    expect(community.deriveHandle({ firstName: 'Sam' }, taken)).toBe('sam');
  });
});

describe('community reputation', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('starts everyone as a new member', () => {
    expect(community.computeLevel({}, { createdAt: now.toISOString() }, now).key).toBe(
      'new_member'
    );
  });

  it('will not promote on post volume alone', () => {
    const level = community.computeLevel(
      { discussions: 500, replies: 500, helpfulAnswers: 0 },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      now
    );
    expect(level.key).toBe('new_member');
  });

  it('promotes a member with sustained, helpful contribution', () => {
    const level = community.computeLevel(
      { discussions: 40, replies: 200, helpfulAnswers: 25 },
      { createdAt: '2024-01-01T00:00:00.000Z' },
      now
    );
    expect(level.key).toBe('trusted_member');
  });

  it('holds a member back while upheld reports stand', () => {
    const level = community.computeLevel(
      { discussions: 300, replies: 300, helpfulAnswers: 100, upheldReports: 2 },
      { createdAt: '2018-01-01T00:00:00.000Z' },
      now
    );
    expect(level.key).toBe('new_member');
  });
});

describe('community ranking', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  it('ranks a lively recent discussion above a quiet one', () => {
    const lively = {
      replyCount: 12,
      participants: ['a', 'b', 'c'],
      helpfulVotes: 6,
      uniqueViews: 400,
      lastActivityAt: '2026-07-31T00:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const quiet = {
      replyCount: 1,
      participants: ['a'],
      uniqueViews: 10,
      lastActivityAt: '2026-07-31T00:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    expect(community.popularityScore(lively, now)).toBeGreaterThan(
      community.popularityScore(quiet, now)
    );
  });

  it('decays an old discussion below an equally active new one', () => {
    const shape = {
      replyCount: 10,
      participants: ['a', 'b'],
      helpfulVotes: 4,
      uniqueViews: 200,
    };
    const fresh = { ...shape, createdAt: '2026-07-25', lastActivityAt: '2026-07-31' };
    const stale = { ...shape, createdAt: '2019-01-01', lastActivityAt: '2019-02-01' };
    expect(community.popularityScore(fresh, now)).toBeGreaterThan(
      community.popularityScore(stale, now)
    );
  });

  it('pushes moderated content down rather than leaving it ranked', () => {
    const base = {
      replyCount: 10,
      participants: ['a', 'b'],
      uniqueViews: 200,
      lastActivityAt: '2026-07-31',
      createdAt: '2026-07-20',
    };
    expect(community.popularityScore({ ...base, moderationPenalty: 2 }, now)).toBeLessThan(
      community.popularityScore(base, now)
    );
  });

  it('never returns a negative score', () => {
    expect(
      community.popularityScore(
        { moderationPenalty: 100, lastActivityAt: '2026-07-31', createdAt: '2026-07-20' },
        now
      )
    ).toBe(0);
  });

  it('sorts by the requested field', () => {
    const items = [
      { replyCount: 1, uniqueViews: 50, createdAt: '2026-01-01', lastActivityAt: '2026-01-01' },
      { replyCount: 9, uniqueViews: 5, createdAt: '2026-05-01', lastActivityAt: '2026-05-01' },
    ];
    expect(items.slice().sort(community.comparatorFor('most-replies'))[0].replyCount).toBe(9);
    expect(items.slice().sort(community.comparatorFor('most-viewed'))[0].uniqueViews).toBe(50);
    expect(items.slice().sort(community.comparatorFor('newest'))[0].createdAt).toBe('2026-05-01');
    expect(items.slice().sort(community.comparatorFor('oldest'))[0].createdAt).toBe('2026-01-01');
  });
});

describe('community filters', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const discussions = [
    {
      id: '1',
      categorySlug: 'venues',
      eventType: 'wedding',
      region: 'london',
      replyCount: 0,
      tags: ['marquee'],
      createdAt: '2026-07-01',
      lastActivityAt: '2026-07-20',
      attachments: [],
    },
    {
      id: '2',
      categorySlug: 'venues',
      eventType: 'corporate',
      region: 'scotland',
      replyCount: 4,
      helpfulAnswerId: 'r1',
      officialAnswerIds: ['r2'],
      hasSupplierReply: true,
      tags: [],
      createdAt: '2019-01-01',
      lastActivityAt: '2019-02-01',
      attachments: [{ kind: 'image' }],
    },
  ];

  it('filters by category, event type and region', () => {
    expect(community.applyFilters(discussions, { category: 'venues' }, now)).toHaveLength(2);
    expect(community.applyFilters(discussions, { eventType: 'wedding' }, now)).toHaveLength(1);
    expect(community.applyFilters(discussions, { region: 'scotland' }, now)[0].id).toBe('2');
  });

  it('ignores an unknown event type rather than returning nothing', () => {
    expect(community.applyFilters(discussions, { eventType: 'nonsense' }, now)).toHaveLength(2);
  });

  it('filters unanswered, solved, official and supplier answers', () => {
    expect(community.applyFilters(discussions, { answer: 'unanswered' }, now)[0].id).toBe('1');
    expect(community.applyFilters(discussions, { answer: 'solved' }, now)[0].id).toBe('2');
    expect(community.applyFilters(discussions, { answer: 'official' }, now)[0].id).toBe('2');
    expect(community.applyFilters(discussions, { answer: 'supplier' }, now)[0].id).toBe('2');
  });

  it('filters by freshness', () => {
    expect(community.applyFilters(discussions, { freshness: 'archive' }, now)[0].id).toBe('2');
  });

  it('filters by media and tag', () => {
    expect(community.applyFilters(discussions, { media: 'true' }, now)[0].id).toBe('2');
    expect(community.applyFilters(discussions, { tag: 'MARQUEE' }, now)[0].id).toBe('1');
  });
});

describe('community projections', () => {
  it('never leaks moderation fields to the public', () => {
    const stripped = community.stripInternalFields({
      id: 'd1',
      title: 'Hello',
      riskScore: 90,
      riskSignals: ['blocked_domain'],
      moderation: { autoDecision: 'review' },
      fingerprint: 'abcd',
      searchText: 'hello',
      authorTrustTier: 'new',
      _id: 'mongo',
    });
    expect(stripped).toEqual({ id: 'd1', title: 'Hello' });
  });

  it('exposes only safe author fields', () => {
    const author = community.publicAuthor({
      handle: 'sam',
      displayName: 'Sam',
      email: 'sam@example.com',
      phone: '07700900000',
      postcode: 'SW1A 1AA',
      isSupplier: true,
      supplierApproved: true,
    });
    expect(author.email).toBeUndefined();
    expect(author.phone).toBeUndefined();
    expect(author.postcode).toBeUndefined();
    expect(author.supplierApproved).toBe(true);
  });

  it('hides the body of withdrawn replies but keeps their place', () => {
    const view = community.toReplyView({
      id: 'r1',
      state: CONTENT_STATES.REMOVED,
      bodyHtml: '<p>Something removed</p>',
      author: { handle: 'sam', displayName: 'Sam' },
      moderationPublicReason: 'Removed by moderators',
      createdAt: '2026-07-01',
    });
    expect(view.body).toBeNull();
    expect(view.withdrawn).toBe(true);
    expect(view.withdrawnReason).toBe('Removed by moderators');
  });

  it('builds a discussion card with human labels', () => {
    const card = community.toDiscussionCard(
      {
        stableId: 'abc123abc123',
        slug: 'test',
        title: 'Test',
        excerpt: 'Excerpt',
        author: { handle: 'sam', displayName: 'Sam' },
        eventType: 'corporate',
        region: 'north-west',
        replyCount: 3,
        createdAt: '2026-07-01',
        lastActivityAt: '2026-07-20',
        state: CONTENT_STATES.PUBLISHED,
      },
      { now: new Date('2026-08-01') }
    );
    expect(card.eventTypeLabel).toBe('Corporate event');
    expect(card.regionLabel).toBe('North West');
    expect(card.url).toBe('/community/discussion/abc123abc123/test');
  });

  it('truncates excerpts on a word boundary', () => {
    const excerpt = community.buildExcerpt('word '.repeat(100), 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('community visibility', () => {
  it('shows published content to anyone', () => {
    expect(community.canView({ state: CONTENT_STATES.PUBLISHED })).toBe(true);
  });

  it('hides quarantined content from the public', () => {
    expect(community.canView({ state: CONTENT_STATES.QUARANTINED }, null)).toBe(false);
  });

  it('shows quarantined content to its author, so nothing is a silent shadow ban', () => {
    expect(
      community.canView(
        { state: CONTENT_STATES.QUARANTINED, authorId: 'u1' },
        { user: { id: 'u1' }, role: 'member' }
      )
    ).toBe(true);
  });

  it('does not show one member the held content of another', () => {
    expect(
      community.canView(
        { state: CONTENT_STATES.QUARANTINED, authorId: 'u1' },
        { user: { id: 'u2' }, role: 'member' }
      )
    ).toBe(false);
  });

  it('shows held content to moderators', () => {
    expect(
      community.canView(
        { state: CONTENT_STATES.QUARANTINED, authorId: 'u1' },
        { user: { id: 'u9' }, role: 'moderator' }
      )
    ).toBe(true);
  });
});

describe('community roles', () => {
  it('treats a global admin as a senior moderator', () => {
    expect(community.communityRoleFor({ role: 'admin' })).toBe('senior_moderator');
    expect(community.isSeniorModerator({ role: 'admin' })).toBe(true);
  });

  it('ignores an unrecognised community role sent on a user record', () => {
    expect(community.communityRoleFor({ role: 'customer', communityRole: 'superuser' })).toBe(
      'member'
    );
  });

  it('recognises an assigned moderator', () => {
    expect(community.isModerator({ role: 'customer', communityRole: 'moderator' })).toBe(true);
    expect(community.isSeniorModerator({ role: 'customer', communityRole: 'moderator' })).toBe(
      false
    );
  });
});

describe('community pagination', () => {
  it('clamps the page size to the documented maximum', () => {
    expect(community.parsePagination({ limit: '5000' }).limit).toBe(50);
    expect(community.parsePagination({ limit: '-5' }).limit).toBe(1);
    // A missing or unparseable limit falls back to the default page size.
    expect(community.parsePagination({ limit: '0' }).limit).toBe(20);
    expect(community.parsePagination({}).limit).toBe(20);
  });

  it('never returns a page below 1', () => {
    expect(community.parsePagination({ page: '-3' }).page).toBe(1);
    expect(community.parsePagination({ page: 'abc' }).page).toBe(1);
  });

  it('computes the skip offset', () => {
    expect(community.parsePagination({ page: '3', limit: '10' }).skip).toBe(20);
  });
});

describe('community view privacy', () => {
  it('keys signed-in viewers by user id', () => {
    expect(community.viewerKey({ user: { id: 'u1' } })).toBe('u:u1');
  });

  it('hashes anonymous viewers rather than storing an IP', () => {
    const key = community.viewerKey({ ip: '203.0.113.5', get: () => 'Mozilla' });
    expect(key.startsWith('a:')).toBe(true);
    expect(key).not.toContain('203.0.113.5');
  });

  it('produces a stable key for the same anonymous viewer', () => {
    const request = { ip: '203.0.113.5', get: () => 'Mozilla' };
    expect(community.viewerKey(request)).toBe(community.viewerKey(request));
  });
});
