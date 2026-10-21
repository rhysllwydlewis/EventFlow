'use strict';

/**
 * GET /api/supplier/dashboard-summary - the honest-data contract.
 *
 * Runs the real route, services and subscription helpers over an in-memory
 * database (tests/helpers/fake-db-unified.js). Time is frozen at NOW so every
 * window boundary is exact. Fixtures are described next to the expectation that
 * depends on them.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

// The signed-in user is chosen per request with a header so one test can switch
// between two suppliers.
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');
const { clearEngagementCache } = require('../../services/supplierEngagementMetrics');

const NOW = new Date('2026-07-16T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const SUPPLIER_USER = { id: 'user-1', role: 'supplier' };
const OTHER_SUPPLIER_USER = { id: 'user-2', role: 'supplier' };

/**
 * Build an app mounting the real supplier router.
 *
 * @returns {Object} Express app
 */
function buildApp() {
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/supplier', router);
  return app;
}

/**
 * Fetch the summary as a given user.
 *
 * @param {Object} user - Authenticated user
 * @param {string} [query] - Query string including the leading "?"
 * @returns {Promise<Object>} supertest response
 */
function getSummary(user, query = '') {
  return request(buildApp())
    .get(`/api/supplier/dashboard-summary${query}`)
    .set('x-test-user', JSON.stringify(user));
}

/**
 * ISO timestamp a number of hours before NOW.
 *
 * @param {number} hours - Hours ago
 * @returns {string} ISO string
 */
function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

/**
 * Build one conversation and its messages.
 *
 * @param {Object} spec - Conversation description
 * @returns {{conversation: Object, messages: Object[]}} Rows to seed
 */
function conversation(spec) {
  const participants = [
    {
      userId: spec.supplierUser || 'user-1',
      role: 'supplier',
      unreadCount: spec.unread || 0,
      isArchived: Boolean(spec.archived),
      isMuted: Boolean(spec.muted),
    },
    { userId: spec.other, role: spec.otherRole || 'customer', unreadCount: 0 },
  ];
  const messages = spec.messages.map(([senderId, at]) => ({
    conversationId: spec.id,
    senderId,
    createdAt: new Date(at),
  }));
  const lastAt = messages.reduce(
    (latest, message) => (message.createdAt > latest ? message.createdAt : latest),
    new Date(spec.createdAt)
  );
  return {
    conversation: {
      _id: spec.id,
      type: spec.type || 'enquiry',
      participants,
      status: 'active',
      messageCount: messages.length,
      createdAt: new Date(spec.createdAt),
      updatedAt: lastAt,
      lastMessage: { sentAt: lastAt },
    },
    messages,
  };
}

const COMPLETE_PROFILE = {
  id: 'sup-1',
  ownerUserId: 'user-1',
  name: 'Moor Audio',
  category: 'Entertainment',
  email: 'hello@moor.example',
  phone: '01234 567890',
  location: 'Cardiff',
  basePostcode: 'CF10 1AA',
  logo: 'https://img.example/logo.png',
  description_long: 'x'.repeat(140),
  photosGallery: ['a.jpg', 'b.jpg', 'c.jpg'],
  socialLinks: { instagram: 'https://i.example/x', facebook: 'https://f.example/x' },
  website: 'https://moor.example',
  approved: true,
  verified: true,
  verificationStatus: 'approved',
  verificationSubmittedAt: '2026-05-01T09:00:00.000Z',
  verifiedAt: '2026-05-03T09:00:00.000Z',
};

/**
 * The fully populated world used by the main contract test.
 *
 * @returns {Object} Seed for fakeDb.__reset
 */
function populatedSeed() {
  const convs = [
    // A: customer c1 opens, supplier replies after 30 minutes. Unread 2.
    conversation({
      id: 'conv-a',
      other: 'c1',
      createdAt: '2026-07-10T09:00:00.000Z',
      unread: 2,
      messages: [
        ['c1', '2026-07-10T09:00:00.000Z'],
        ['user-1', '2026-07-10T09:30:00.000Z'],
        ['c1', '2026-07-10T10:00:00.000Z'],
      ],
    }),
    // B: replied after 90 minutes.
    conversation({
      id: 'conv-b',
      other: 'c2',
      createdAt: '2026-07-05T10:00:00.000Z',
      messages: [
        ['c2', '2026-07-05T10:00:00.000Z'],
        ['user-1', '2026-07-05T11:30:00.000Z'],
      ],
    }),
    // C: more than a day old and never answered. Unread 1.
    conversation({
      id: 'conv-c',
      other: 'c3',
      createdAt: '2026-07-12T08:00:00.000Z',
      unread: 1,
      messages: [['c3', '2026-07-12T08:00:00.000Z']],
    }),
    // D: two hours old, not answered yet (too young to count as ignored). Unread 1.
    conversation({
      id: 'conv-d',
      other: 'c4',
      createdAt: hoursAgo(2),
      unread: 1,
      messages: [['c4', hoursAgo(2)]],
    }),
    // E: the supplier started it, the customer answered: outreach, not an enquiry.
    conversation({
      id: 'conv-e',
      other: 'c5',
      createdAt: '2026-07-08T14:00:00.000Z',
      messages: [
        ['user-1', '2026-07-08T14:00:00.000Z'],
        ['c5', '2026-07-08T15:00:00.000Z'],
      ],
    }),
    // F: supplier-to-supplier networking: not an enquiry. Muted with 5 unread.
    conversation({
      id: 'conv-f',
      other: 'user-9',
      otherRole: 'supplier',
      type: 'supplier_network',
      createdAt: '2026-07-02T09:00:00.000Z',
      unread: 5,
      muted: true,
      messages: [['user-9', '2026-07-02T09:00:00.000Z']],
    }),
    // G: customer-initiated in the PREVIOUS 30 days (2026-05-17 .. 2026-06-16).
    conversation({
      id: 'conv-g',
      other: 'c6',
      createdAt: '2026-06-01T10:00:00.000Z',
      messages: [
        ['c6', '2026-06-01T10:00:00.000Z'],
        ['user-1', '2026-06-01T12:00:00.000Z'],
      ],
    }),
    // H: belongs to a DIFFERENT supplier. Must never show up for user-1.
    conversation({
      id: 'conv-h',
      supplierUser: 'user-2',
      other: 'c7',
      createdAt: '2026-07-11T09:00:00.000Z',
      unread: 9,
      messages: [['c7', '2026-07-11T09:00:00.000Z']],
    }),
    // I: older than both windows: still part of the inbox, not of the enquiry counts.
    conversation({
      id: 'conv-i',
      other: 'c8',
      createdAt: '2026-04-01T09:00:00.000Z',
      messages: [['c8', '2026-04-01T09:00:00.000Z']],
    }),
    // J: customer-initiated, replied after 20 minutes, archived with 4 unread (excluded from unread).
    conversation({
      id: 'conv-j',
      other: 'c9',
      createdAt: '2026-06-20T09:00:00.000Z',
      unread: 4,
      archived: true,
      messages: [
        ['c9', '2026-06-20T09:00:00.000Z'],
        ['user-1', '2026-06-20T09:20:00.000Z'],
      ],
    }),
  ];

  return {
    users: [
      { id: 'user-1', verified: true, email: 'owner@moor.example' },
      { id: 'user-2', verified: false },
    ],
    suppliers: [
      COMPLETE_PROFILE,
      {
        id: 'sup-2',
        ownerUserId: 'user-2',
        name: 'Other Catering',
        approved: false,
        verificationStatus: 'pending_review',
      },
    ],
    subscriptions: [
      {
        id: 'sub-1',
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_x',
        currentPeriodEnd: '2026-08-10T00:00:00.000Z',
        cancelAtPeriodEnd: true,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    packages: [
      { id: 'p1', supplierId: 'sup-1', approved: true, image: '/uploads/p1.jpg' },
      { id: 'p2', supplierId: 'sup-1', approved: true, paused: true, image: '/uploads/p2.jpg' },
      {
        id: 'p3',
        supplierId: 'sup-1',
        approved: false,
        image: '/assets/images/package-placeholder.webp',
      },
      { id: 'p4', supplierId: 'sup-2', approved: true },
    ],
    reviews: [
      { id: 'r1', supplierId: 'sup-1', rating: 5, moderation: { state: 'approved' } },
      { id: 'r2', supplierId: 'sup-1', rating: 4, moderation: { state: 'approved' } },
      { id: 'r3', supplierId: 'sup-1', moderation: { state: 'approved' } },
      { id: 'r4', supplierId: 'sup-1', rating: 1, moderation: { state: 'pending' } },
      { id: 'r5', supplierId: 'sup-1', rating: 1, moderation: { state: 'rejected' } },
      { id: 'r6', supplierId: 'sup-2', rating: 2, moderation: { state: 'approved' } },
    ],
    reviewRequests: [
      { id: 'rr1', supplierId: 'sup-1', status: 'sent' },
      { id: 'rr2', supplierId: 'sup-1', status: 'failed' },
    ],
    conversations_v4: convs.map(item => item.conversation),
    chat_messages_v4: convs.flatMap(item => item.messages),
    quoteRequests: [
      {
        id: 'q1',
        createdAt: '2026-07-01T09:00:00.000Z',
        suppliers: [{ supplierId: 'sup-1' }, { supplierId: 'sup-2' }],
      },
      { id: 'q2', createdAt: '2026-06-01T09:00:00.000Z', suppliers: [{ supplierId: 'sup-1' }] },
      { id: 'q3', createdAt: '2026-07-02T09:00:00.000Z', suppliers: [{ supplierId: 'sup-2' }] },
      { id: 'q4', createdAt: '2026-03-01T09:00:00.000Z', suppliers: [{ supplierId: 'sup-1' }] },
    ],
    enquiries: [
      { id: 'e1', supplierId: 'sup-1', createdAt: '2026-07-14T09:00:00.000Z' },
      { id: 'e2', supplierId: 'sup-2', createdAt: '2026-07-14T09:00:00.000Z' },
    ],
    events: [
      // 5 page loads in the window, 3 in the previous window, 2 before that.
      ...['2026-07-15', '2026-07-14', '2026-07-10', '2026-07-01', '2026-06-20'].map((date, i) => ({
        id: `v${i}`,
        type: 'profile_view',
        supplierId: 'sup-1',
        timestamp: `${date}T10:00:00.000Z`,
        date,
      })),
      ...['2026-06-10', '2026-06-01', '2026-05-20'].map((date, i) => ({
        id: `pv${i}`,
        type: 'profile_view',
        supplierId: 'sup-1',
        timestamp: `${date}T10:00:00.000Z`,
        date,
      })),
      ...['2026-04-10', '2026-04-11'].map((date, i) => ({
        id: `ov${i}`,
        type: 'profile_view',
        supplierId: 'sup-1',
        timestamp: `${date}T10:00:00.000Z`,
        date,
      })),
      // Unverifiable client beacons must not inflate the enquiry count.
      ...[0, 1, 2, 3].map(i => ({
        id: `fake${i}`,
        type: 'enquiry_sent',
        supplierId: 'sup-1',
        timestamp: '2026-07-14T10:00:00.000Z',
        date: '2026-07-14',
      })),
      // Another supplier's traffic.
      ...[0, 1, 2, 3, 4, 5, 6].map(i => ({
        id: `s2v${i}`,
        type: 'profile_view',
        supplierId: 'sup-2',
        timestamp: '2026-07-15T10:00:00.000Z',
        date: '2026-07-15',
      })),
    ],
    customer_calendar_entries: [
      { id: 'ce1', userId: 'user-1', title: 'Venue visit', date: '2026-07-20', time: '14:00' },
      { id: 'ce2', userId: 'user-1', title: 'Tasting', date: '2026-07-18', time: null },
      { id: 'ce3', userId: 'user-1', title: 'Expo', date: '2026-08-01', time: '09:00' },
      { id: 'ce4', userId: 'user-1', title: 'Past meeting', date: '2026-07-01', time: '09:00' },
      { id: 'ce5', userId: 'user-2', title: 'Not yours', date: '2026-07-17', time: '09:00' },
    ],
    public_calendar_events: [
      {
        id: 'pe1',
        createdByUserId: 'user-1',
        title: 'Open day',
        startDate: '2026-07-19T10:00:00.000Z',
        status: 'published',
      },
      {
        id: 'pe2',
        createdByUserId: 'user-1',
        title: 'Removed',
        startDate: '2026-07-17T10:00:00.000Z',
        status: 'deleted',
      },
      {
        id: 'pe3',
        createdByUserId: 'user-2',
        title: 'Not yours',
        startDate: '2026-07-17T10:00:00.000Z',
        status: 'published',
      },
    ],
    tickets: [
      { id: 't1', senderId: 'user-1', senderType: 'supplier', status: 'open' },
      { id: 't2', senderId: 'user-1', senderType: 'supplier', status: 'in_progress' },
      { id: 't3', senderId: 'user-2', senderType: 'supplier', status: 'open' },
    ],
  };
}

/**
 * Seed for a brand-new supplier who has done nothing yet.
 *
 * @returns {Object} Seed for fakeDb.__reset
 */
function emptySeed() {
  return {
    users: [{ id: 'user-1', verified: false }],
    suppliers: [
      {
        id: 'sup-new',
        ownerUserId: 'user-1',
        name: 'Fresh Florals',
        approved: false,
        verificationStatus: 'unverified',
      },
    ],
  };
}

/**
 * Write the real responses out for the front-end team when asked to.
 *
 * @param {string} name - File base name
 * @param {Object} body - Response body
 * @returns {void}
 */
function dumpExample(name, body) {
  const dir = process.env.SUPPLIER_CONTRACT_DUMP_DIR;
  if (dir) {
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
  }
}

describe('GET /api/supplier/dashboard-summary contract', () => {
  beforeEach(() => {
    clearEngagementCache();
  });

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('populated, approved supplier on the Professional plan', () => {
    let body;

    beforeAll(async () => {
      fakeDb.__reset(populatedSeed());
      const res = await getSummary(SUPPLIER_USER, '?days=30');
      expect(res.status).toBe(200);
      body = res.body;
      dumpExample('populated-approved-supplier', body);
    });

    it('returns every top-level key of the contract, and nothing failed', () => {
      expect(Object.keys(body).sort()).toEqual(
        [
          'analytics',
          'enquiries',
          'messages',
          'nextSteps',
          'packages',
          'profile',
          'responses',
          'reviews',
          'subscription',
          'tickets',
          'unavailable',
          'upcoming',
          'verification',
          'views',
          'window',
        ].sort()
      );
      expect(body.unavailable).toEqual([]);
    });

    it('serves the requested 30 day window because the plan allows it', () => {
      expect(body.window).toEqual({ days: 30, maxDays: 90, requestedDays: 30 });
    });

    it('reports verification from the stored supplier and user fields', () => {
      expect(body.verification).toEqual({
        emailVerified: true,
        approved: true,
        state: 'approved',
        status: 'approved',
        submittedAt: '2026-05-01T09:00:00.000Z',
        reviewedAt: '2026-05-03T09:00:00.000Z',
        rejectionCount: 0,
        notes: null,
      });
    });

    it('computes profile completeness server-side with per-check hrefs', () => {
      expect(body.profile.name).toBe('Moor Audio');
      expect(body.profile.publicProfilePath).toMatch(/^\/supplier\//);
      // Everything except the banner image: 100 - 15.
      expect(body.profile.completeness.score).toBe(85);
      expect(body.profile.healthScore).toBe(85);
      expect(body.profile.completeness.checks).toHaveLength(7);
      expect(body.profile.completeness.checks.find(check => check.id === 'coverImage')).toEqual({
        id: 'coverImage',
        label: 'Banner image',
        weight: 15,
        done: false,
        href: '/supplier/profile-customization#sup-banner-drop',
      });
      expect(body.profile.completionFlags.hasCoverImage).toBe(false);
      expect(body.profile.completionFlags.hasLogo).toBe(true);
    });

    it('classifies packages and takes the limit from the plan', () => {
      expect(body.packages).toEqual({
        total: 3,
        active: 1,
        paused: 1,
        awaitingApproval: 1,
        limit: 50,
        countedTowardsLimit: 2,
        draft: 1,
      });
    });

    it('reads messages from conversations_v4, excluding archived, muted and other people', () => {
      // A(2) + C(1) + D(1) unread; J is archived, F is muted, H belongs to another supplier.
      expect(body.messages.unreadMessages).toBe(4);
      expect(body.messages.conversationsWithUnread).toBe(3);
      expect(body.messages.latestAt).toBe(hoursAgo(2));
      // Legacy keys: total inbox conversations, conversations with unread.
      expect(body.messages.total).toBe(9);
      expect(body.messages.unread).toBe(3);
    });

    it('counts enquiries from real records only, window-bound, with a previous period', () => {
      expect(body.enquiries.sources).toEqual({
        // A B C D J (E is outreach, F is supplier-to-supplier, G is the previous window).
        conversations: 5,
        quoteRequests: 1,
        contactForm: 1,
      });
      expect(body.enquiries.newThisPeriod).toBe(7);
      // G (conversation) + q2 (quote request).
      expect(body.enquiries.previousPeriod).toBe(2);
      expect(body.enquiries.truncated).toBe(false);
    });

    it('ignores spoofable enquiry_sent beacons', () => {
      expect(body.analytics.totalEnquiries).toBe(7);
    });

    it('computes reply statistics over customer-initiated conversations in the window', () => {
      // Sample: A B C D J. Mature (>= 24h old): A B C J. Replied among mature: A B J => 75%.
      // Reply gaps: 30, 90 and 20 minutes => median 30.
      expect(body.responses).toEqual({
        sampleSize: 5,
        matureSampleSize: 4,
        repliedPct: 75,
        medianMinutes: 30,
      });
      // Legacy analytics keys agree with the new block.
      expect(body.analytics.responseRate).toBe(75);
      expect(body.analytics.avgResponseTime).toBe(0.5);
    });

    it('labels views honestly as page loads over the served window', () => {
      expect(body.views).toEqual({
        total: 5,
        days: 30,
        basis: 'page_loads',
        description: expect.stringMatching(/once per visitor per hour/),
      });
      expect(body.analytics.totalViews).toBe(5);
      // 5 now vs 3 in the previous window.
      expect(body.analytics.viewsTrend).toBe(67);
      expect(body.analytics.enquiriesTrend).toBe(250);
      expect(body.analytics.responseTrend).toBeNull();
    });

    it('draws the daily series from the same windows and real enquiries', () => {
      expect(body.analytics.dailyData).toHaveLength(30);
      const last = body.analytics.dailyData[29];
      expect(last.date).toBe('2026-07-16');
      const day = date => body.analytics.dailyData.find(entry => entry.date === date);
      expect(day('2026-07-14')).toMatchObject({ views: 1, enquiries: 1 });
      expect(day('2026-07-10')).toMatchObject({ views: 1, enquiries: 1 });
      const enquirySum = body.analytics.dailyData.reduce((sum, entry) => sum + entry.enquiries, 0);
      expect(enquirySum).toBe(7);
    });

    it('makes the daily series add up exactly to the headline totals', () => {
      const sum = key => body.analytics.dailyData.reduce((total, day) => total + day[key], 0);

      expect(sum('views')).toBe(body.analytics.totalViews);
      expect(sum('enquiries')).toBe(body.analytics.totalEnquiries);
    });

    it('counts only approved reviews and leaves unrated ones out of the average', () => {
      expect(body.reviews).toEqual({
        approvedCount: 3,
        averageRating: 4.5,
        pendingCount: 1,
        total: 3,
        pending: 1,
      });
    });

    it('describes the subscription from the database without calling Stripe', () => {
      expect(body.subscription).toMatchObject({
        plan: 'pro',
        status: 'active',
        activeUntil: '2026-08-10T00:00:00.000Z',
        cancelAtPeriodEnd: true,
        tier: 'pro',
      });
      expect(body.subscription.limits).toMatchObject({
        maxPackages: 50,
        maxPhotos: 500,
        analyticsWindowDays: 90,
      });
    });

    it('lists the next three calendar items for this supplier only', () => {
      expect(body.upcoming).toEqual([
        { id: 'ce2', title: 'Tasting', date: '2026-07-18', time: null, source: 'personal' },
        { id: 'pe1', title: 'Open day', date: '2026-07-19', time: '10:00', source: 'public' },
        { id: 'ce1', title: 'Venue visit', date: '2026-07-20', time: '14:00', source: 'personal' },
      ]);
    });

    it('builds an ordered next-steps list with the first open step as the primary action', () => {
      expect(body.nextSteps.total).toBe(body.nextSteps.steps.length);
      expect(body.nextSteps.steps.map(step => step.priority)).toEqual(
        body.nextSteps.steps.map((step, index) => index + 1)
      );
      const byId = id => body.nextSteps.steps.find(step => step.id === id);
      expect(byId('verify-email').done).toBe(true);
      expect(byId('get-verified').done).toBe(true);
      expect(byId('banner')).toMatchObject({ done: false, locked: false });
      expect(byId('first-package').done).toBe(true);
      // p3 has only the placeholder image.
      expect(byId('package-photos').done).toBe(false);
      expect(byId('request-review').done).toBe(true);
      expect(byId('calendar').done).toBe(true);
      expect(body.nextSteps.primaryStepId).toBe('banner');
      expect(body.nextSteps.completed).toBe(body.nextSteps.steps.filter(step => step.done).length);
      expect(body.nextSteps.percent).toBe(
        Math.round((body.nextSteps.completed / body.nextSteps.total) * 100)
      );
    });

    it('keeps the legacy ticket counts', () => {
      expect(body.tickets).toEqual({ total: 2, open: 1, inProgress: 1 });
    });
  });

  describe('plan entitlement and window clamping', () => {
    beforeEach(() => {
      const seed = populatedSeed();
      seed.subscriptions = [];
      fakeDb.__reset(seed);
    });

    it('caps a Starter supplier at 7 days and says what was asked for', async () => {
      const res = await getSummary(SUPPLIER_USER, '?days=30');

      expect(res.body.window).toEqual({ days: 7, maxDays: 7, requestedDays: 30 });
      expect(res.body.views.days).toBe(7);
      expect(res.body.analytics.dailyData).toHaveLength(7);
      expect(res.body.subscription.plan).toBe('free');
      expect(res.body.packages.limit).toBe(3);
      // Only the 2026-07-15, 2026-07-14 and 2026-07-10 views fall in the last 7 days.
      expect(res.body.views.total).toBe(3);
    });

    it('defaults to 30 days on a plan that allows it', async () => {
      const seed = populatedSeed();
      fakeDb.__reset(seed);
      const res = await getSummary(SUPPLIER_USER);

      expect(res.body.window).toEqual({ days: 30, maxDays: 90, requestedDays: 30 });
    });

    it('caps any request at 90 days, even on a 365 day plan', async () => {
      const seed = populatedSeed();
      seed.subscriptions[0].plan = 'pro_plus';
      fakeDb.__reset(seed);

      const res = await getSummary(SUPPLIER_USER, '?days=365');

      expect(res.body.window).toEqual({ days: 90, maxDays: 90, requestedDays: 90 });
    });

    it.each([
      ['0', 1],
      ['-5', 30],
      ['abc', 30],
      ['1e9', 30],
      ['7.5', 30],
    ])('treats days=%s safely', async (value, expectedRequested) => {
      const seed = populatedSeed();
      fakeDb.__reset(seed);
      const res = await getSummary(SUPPLIER_USER, `?days=${value}`);

      expect(res.status).toBe(200);
      expect(res.body.window.requestedDays).toBe(expectedRequested);
      expect(res.body.window.days).toBeGreaterThanOrEqual(1);
      expect(res.body.window.days).toBeLessThanOrEqual(90);
    });

    it('counts the whole first UTC day of the window, so totals equal the chart', async () => {
      const seed = populatedSeed();
      seed.subscriptions = [];
      // 7 day window ending 2026-07-16 starts 2026-07-10 00:00 UTC. One view just inside
      // that first day (00:30) and one just outside it (23:30 the day before).
      seed.events = [
        {
          id: 'in',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-10T00:30:00.000Z',
          date: '2026-07-10',
        },
        {
          id: 'out',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-09T23:30:00.000Z',
          date: '2026-07-09',
        },
        {
          id: 'late',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-16T11:59:00.000Z',
          date: '2026-07-16',
        },
      ];
      fakeDb.__reset(seed);

      const res = await getSummary(SUPPLIER_USER);
      const chartViews = res.body.analytics.dailyData.reduce((total, day) => total + day.views, 0);

      expect(res.body.analytics.dailyData[0].date).toBe('2026-07-10');
      expect(res.body.views.total).toBe(2);
      expect(chartViews).toBe(2);
    });

    it('does not count conversations from before a shorter window as new enquiries', async () => {
      const seed = populatedSeed();
      fakeDb.__reset(seed);
      const res = await getSummary(SUPPLIER_USER, '?days=7');

      // Last 7 days: A (07-10 is 6 days ago), C (07-12), D (2h ago); B is 07-05 (11 days).
      expect(res.body.enquiries.sources.conversations).toBe(3);
      expect(res.body.enquiries.sources.contactForm).toBe(1);
      expect(res.body.enquiries.sources.quoteRequests).toBe(0);
    });
  });

  describe('brand-new supplier with no activity', () => {
    let body;

    beforeAll(async () => {
      fakeDb.__reset(emptySeed());
      const res = await getSummary(SUPPLIER_USER);
      expect(res.status).toBe(200);
      body = res.body;
      dumpExample('empty-new-supplier', body);
    });

    it('reports real zeros where something was counted and null where nothing can be said', () => {
      expect(body.enquiries).toEqual({
        newThisPeriod: 0,
        previousPeriod: 0,
        sources: { conversations: 0, quoteRequests: 0, contactForm: 0 },
        truncated: false,
        requests: { received: 0, new: 0 },
      });
      expect(body.responses).toEqual({
        sampleSize: 0,
        matureSampleSize: 0,
        repliedPct: null,
        medianMinutes: null,
      });
      expect(body.reviews).toMatchObject({
        approvedCount: 0,
        averageRating: null,
        pendingCount: 0,
      });
      expect(body.views).toMatchObject({ total: 0, days: 7, basis: 'page_loads' });
      expect(body.messages).toMatchObject({
        unreadMessages: 0,
        conversationsWithUnread: 0,
        latestAt: null,
      });
      expect(body.analytics.responseRate).toBeNull();
      expect(body.analytics.avgResponseTime).toBeNull();
      expect(body.analytics.viewsTrend).toBeNull();
      expect(body.analytics.enquiriesTrend).toBeNull();
    });

    it('never defaults the reply figures to 100% or 0 hours', () => {
      expect(body.analytics.responseRate).not.toBe(100);
      expect(body.analytics.avgResponseTime).not.toBe(0);
      expect(body.responses.repliedPct).toBeNull();
    });

    it('is unverified, unapproved and on the Starter plan', () => {
      expect(body.verification).toMatchObject({
        emailVerified: false,
        approved: false,
        state: 'unverified',
        status: 'unverified',
        submittedAt: null,
        reviewedAt: null,
        rejectionCount: 0,
      });
      expect(body.window).toEqual({ days: 7, maxDays: 7, requestedDays: 30 });
      expect(body.subscription).toMatchObject({ plan: 'free', status: 'free', activeUntil: null });
      expect(body.subscription.limits.maxPackages).toBe(3);
    });

    it('still reports packages (with the plan limit) for a supplier that is not approved', () => {
      expect(body.packages).toEqual({
        total: 0,
        active: 0,
        paused: 0,
        awaitingApproval: 0,
        limit: 3,
        countedTowardsLimit: 0,
        draft: 0,
      });
    });

    it('scores an empty profile at 0 with all seven checks open', () => {
      expect(body.profile.completeness.score).toBe(0);
      expect(body.profile.completeness.checks.every(check => check.done === false)).toBe(true);
      expect(body.profile.name).toBe('Fresh Florals');
    });

    it('has no upcoming items and an honest, locked next-steps list', () => {
      expect(body.upcoming).toEqual([]);
      const byId = id => body.nextSteps.steps.find(step => step.id === id);
      expect(body.nextSteps.completed).toBe(0);
      expect(body.nextSteps.percent).toBe(0);
      // The very first thing to do is verify the email; that is the primary action.
      expect(body.nextSteps.primaryStepId).toBe('verify-email');
      expect(byId('verify-email')).toMatchObject({ done: false, locked: false });
      // Everything that needs a verified email says so rather than being offered.
      expect(byId('business-details')).toMatchObject({
        done: false,
        locked: true,
        lockedReason: 'Verify your email address first',
      });
      expect(byId('first-package')).toMatchObject({ locked: true });
      expect(byId('request-review')).toMatchObject({ locked: true });
    });

    it('reports nothing as unavailable', () => {
      expect(body.unavailable).toEqual([]);
    });
  });

  describe('verification states', () => {
    /**
     * Fetch the verification block for a supplier with the given stored fields.
     *
     * @param {Object} fields - Fields merged onto the supplier document
     * @returns {Promise<Object>} verification block
     */
    async function verificationFor(fields) {
      const seed = emptySeed();
      Object.assign(seed.suppliers[0], fields);
      fakeDb.__reset(seed);
      const res = await getSummary(SUPPLIER_USER);
      return res.body;
    }

    it.each([
      [{ verificationStatus: 'pending_review' }, 'pending'],
      [
        { verificationStatus: 'needs_changes', verificationNotes: 'Add a phone number' },
        'rejected',
      ],
      [{ verificationStatus: 'rejected', verificationRejectionCount: 2 }, 'rejected'],
      [{ verificationStatus: 'suspended' }, 'rejected'],
      [{ verificationStatus: 'approved', approved: true }, 'approved'],
      [{ verificationStatus: undefined }, 'unverified'],
    ])('maps %j to state %s', async (fields, expected) => {
      const body = await verificationFor(fields);

      expect(body.verification.state).toBe(expected);
    });

    it('explains changes requested and rejections with the admin note', async () => {
      const body = await verificationFor({
        verificationStatus: 'needs_changes',
        verificationNotes: 'Add a phone number',
        verificationRejectionCount: 1,
      });

      expect(body.verification).toMatchObject({
        status: 'needs_changes',
        notes: 'Add a phone number',
        rejectionCount: 1,
      });
    });

    it('does not leak admin notes for other states', async () => {
      const body = await verificationFor({
        verificationStatus: 'pending_review',
        verificationNotes: 'internal',
      });

      expect(body.verification.notes).toBeNull();
    });

    it('locks the verification step while a review is pending', async () => {
      const body = await verificationFor({ verificationStatus: 'pending_review' });
      const step = body.nextSteps.steps.find(item => item.id === 'get-verified');

      expect(step).toMatchObject({ done: false, locked: true });
      expect(step.lockedReason).toMatch(/waiting for an admin/);
    });

    it('treats approved:true as approved even if the state field is stale', async () => {
      const body = await verificationFor({ approved: true, verificationStatus: 'unverified' });

      expect(body.verification.approved).toBe(true);
      expect(body.verification.state).toBe('approved');
    });
  });

  describe('request-level behaviour', () => {
    it('isolates suppliers: user-2 never sees user-1 data and vice versa', async () => {
      fakeDb.__reset(populatedSeed());

      const first = (await getSummary(SUPPLIER_USER, '?days=30')).body;
      const second = (await getSummary(OTHER_SUPPLIER_USER, '?days=30')).body;

      // user-2 owns sup-2 on the Starter plan (7 days): 7 page loads, one inbox
      // conversation (H) with 9 unread, one contact enquiry, one calendar entry and one
      // public event. Its two quote requests are older than 7 days.
      expect(second.profile.name).toBe('Other Catering');
      expect(second.window.days).toBe(7);
      expect(second.views.total).toBe(7);
      expect(second.messages).toMatchObject({
        unreadMessages: 9,
        conversationsWithUnread: 1,
        total: 1,
      });
      expect(second.enquiries.sources).toEqual({
        conversations: 1,
        quoteRequests: 0,
        contactForm: 1,
      });
      expect(second.packages.total).toBe(1);
      expect(second.reviews.approvedCount).toBe(1);
      expect(second.reviews.averageRating).toBe(2);
      expect(second.upcoming.map(item => item.id).sort()).toEqual(['ce5', 'pe3']);
      expect(second.tickets.total).toBe(1);

      expect(first.profile.name).toBe('Moor Audio');
      expect(first.messages.unreadMessages).toBe(4);
      expect(JSON.stringify(first)).not.toContain('Other Catering');
      expect(JSON.stringify(first)).not.toContain('ce5');
      expect(JSON.stringify(first)).not.toContain('pe3');
    });

    it('rejects customers', async () => {
      fakeDb.__reset(populatedSeed());

      const res = await getSummary({ id: 'cust-1', role: 'customer' });

      expect(res.status).toBe(403);
    });

    it('returns 404 for a supplier account with no profile', async () => {
      fakeDb.__reset({ users: [{ id: 'user-1', verified: true }] });

      const res = await getSummary(SUPPLIER_USER);

      expect(res.status).toBe(404);
    });

    it('names failing blocks as unavailable and returns null instead of zero, as the real db would fail', async () => {
      // The test double swallows errors unless the caller asks for them, exactly like the real
      // db-unified, so this only passes if the summary asks for errors on every read.
      fakeDb.__reset(populatedSeed());
      fakeDb.__failOn('conversations_v4', 'chat_messages_v4');

      const res = await getSummary(SUPPLIER_USER, '?days=30');

      expect(res.status).toBe(200);
      expect(res.body.unavailable).toEqual(expect.arrayContaining(['messages', 'enquiries']));
      expect(res.body.messages.unreadMessages).toBeNull();
      expect(res.body.messages.conversationsWithUnread).toBeNull();
      expect(res.body.enquiries.newThisPeriod).toBeNull();
      expect(res.body.responses.repliedPct).toBeNull();
      expect(res.body.analytics.totalEnquiries).toBeNull();
      expect(res.body.analytics.responseRate).toBeNull();
      // Unrelated blocks are unaffected.
      expect(res.body.views.total).toBe(5);
      expect(res.body.reviews.approvedCount).toBe(3);
    });

    it.each([
      ['events', 'views', body => expect(body.views.total).toBeNull()],
      ['packages', 'packages', body => expect(body.packages.total).toBeNull()],
      ['reviews', 'reviews', body => expect(body.reviews.approvedCount).toBeNull()],
      ['tickets', 'tickets', body => expect(body.tickets.total).toBeNull()],
      ['quoteRequests', 'enquiries', body => expect(body.enquiries.newThisPeriod).toBeNull()],
      ['enquiries', 'enquiries', body => expect(body.enquiries.sources.contactForm).toBeNull()],
      ['subscriptions', 'subscription', body => expect(body.subscription.plan).toBeNull()],
      ['customer_calendar_entries', 'calendar', body => expect(body.upcoming).toEqual([])],
    ])(
      'a failed %s read is reported as unavailable (%s), never as zeros',
      async (collection, label, check) => {
        fakeDb.__reset(populatedSeed());
        fakeDb.__failOn(collection);

        const res = await getSummary(SUPPLIER_USER, '?days=30');

        expect(res.status).toBe(200);
        expect(res.body.unavailable).toContain(label);
        check(res.body);
      }
    );

    it.each([
      ['packages', ['first-package', 'package-photos']],
      ['customer_calendar_entries', ['calendar']],
    ])(
      'a failed %s read holds back the next steps it feeds instead of marking them undone',
      async (collection, held) => {
        fakeDb.__reset(populatedSeed());
        fakeDb.__failOn(collection);

        const res = await getSummary(SUPPLIER_USER, '?days=30');

        const byId = id => res.body.nextSteps.steps.find(step => step.id === id);
        held.forEach(id => {
          expect(byId(id)).toMatchObject({
            done: false,
            locked: true,
            lockedReason: 'We could not check this just now',
          });
        });
        expect(res.body.nextSteps.steps.filter(step => step.locked).map(step => step.id)).toEqual(
          expect.arrayContaining(held)
        );
      }
    );

    it('does not lock every next step when the user lookup fails (verification unknown, not false)', async () => {
      fakeDb.__reset(populatedSeed());
      fakeDb.__failOn('users');

      const res = await getSummary(SUPPLIER_USER, '?days=30');

      expect(res.body.unavailable).toContain('user');
      expect(res.body.verification.emailVerified).toBeNull();
      const locked = res.body.nextSteps.steps.filter(step => step.locked);
      expect(locked.map(step => step.id)).toEqual(['verify-email']);
      expect(res.body.nextSteps.primaryStepId).toBe('banner');
    });

    it('treats a missing user row as unverified, not as unknown', async () => {
      const seed = populatedSeed();
      seed.users = [];
      fakeDb.__reset(seed);

      const res = await getSummary(SUPPLIER_USER);

      expect(res.body.verification.emailVerified).toBe(false);
      expect(res.body.unavailable).toEqual([]);
    });

    it('answers a failed supplier lookup with a 500, not a "no profile" 404', async () => {
      fakeDb.__reset(populatedSeed());
      fakeDb.__failOn('suppliers');

      const res = await getSummary(SUPPLIER_USER);

      expect(res.status).toBe(500);
    });

    it('agrees with the email gates on truthiness (verified: 1 counts as verified)', async () => {
      const seed = populatedSeed();
      seed.users[0].verified = 1;
      fakeDb.__reset(seed);

      const res = await getSummary(SUPPLIER_USER);

      expect(res.body.verification.emailVerified).toBe(true);
    });

    it('does not call Stripe or any network service on this path', async () => {
      fakeDb.__reset(populatedSeed());
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
        throw new Error('network call attempted');
      });

      const res = await getSummary(SUPPLIER_USER);

      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });
});
