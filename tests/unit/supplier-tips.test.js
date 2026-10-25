'use strict';

/**
 * Dashboard tips: derived from this supplier's real category, account status, plan
 * limits and data. Runs GET /api/v1/supplier/performance-tips over the in-memory
 * database double.
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
const { ACTION_TYPES, MAX_TIPS, categoryGroup } = require('../../services/supplierTips');

const USER = { id: 'user-1', role: 'supplier' };
const HOUR = 3600000;

/**
 * ISO timestamp some hours before now.
 *
 * @param {number} hours - Hours ago
 * @returns {string} ISO string
 */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

/**
 * A supplier whose profile checklist is fully done.
 *
 * @param {Object} [overrides] - Fields to override
 * @returns {Object} Supplier document
 */
function completeSupplier(overrides = {}) {
  return {
    id: 'sup-1',
    ownerUserId: 'user-1',
    name: 'Moor Audio',
    category: 'Photography',
    email: 'hello@moor.example',
    phone: '01234 567890',
    location: 'Cardiff',
    basePostcode: 'CF10 1AA',
    logo: 'https://img.example/logo.png',
    description_long: 'x'.repeat(150),
    bannerUrl: 'https://img.example/banner.jpg',
    photosGallery: ['a.jpg', 'b.jpg', 'c.jpg'],
    socialLinks: { instagram: 'https://i.example/x', facebook: 'https://f.example/x' },
    website: 'https://moor.example',
    approved: true,
    verified: true,
    verificationStatus: 'approved',
    ...overrides,
  };
}

/**
 * Seed one world and fetch the tips.
 *
 * @param {Object} [world] - { supplier, user, extra (collections), subscription, failOn (collections that error) }
 * @returns {Promise<Object>} supertest response
 */
async function tipsFor({ supplier, user = {}, extra = {}, subscription, failOn = [] } = {}) {
  clearEngagementCache();
  fakeDb.__reset({
    users: [{ id: 'user-1', verified: true, email: 'owner@example.com', ...user }],
    suppliers: [supplier || completeSupplier()],
    subscriptions: subscription ? [subscription] : [],
    ...extra,
  });
  fakeDb.__failOn(...failOn);
  const router = require('../../routes/supplier');
  const app = express();
  app.use('/api/v1/supplier', router);
  return request(app)
    .get('/api/v1/supplier/performance-tips')
    .set('x-test-user', JSON.stringify(USER));
}

/**
 * Ids of the tips in a response.
 *
 * @param {Object} res - supertest response
 * @returns {string[]} Tip ids
 */
function ids(res) {
  return res.body.tips.map(item => item.id);
}

/**
 * One tip by id.
 *
 * @param {Object} res - supertest response
 * @param {string} id - Tip id
 * @returns {Object} Tip
 */
function find(res, id) {
  return res.body.tips.find(item => item.id === id);
}

const PRO = {
  id: 's',
  userId: 'user-1',
  plan: 'pro',
  status: 'active',
  stripeSubscriptionId: 'x',
  currentPeriodEnd: '2999-01-01T00:00:00.000Z',
};

describe('access and shape', () => {
  it('refuses a customer and answers 404 without a profile', async () => {
    await tipsFor();
    const router = require('../../routes/supplier');
    const app = express();
    app.use('/api/v1/supplier', router);

    const customer = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user', JSON.stringify({ id: 'c', role: 'customer' }));
    const noProfile = await request(app)
      .get('/api/v1/supplier/performance-tips')
      .set('x-test-user', JSON.stringify({ id: 'user-99', role: 'supplier' }));

    expect(customer.status).toBe(403);
    expect(noProfile.status).toBe(404);
  });

  it('every tip has the documented shape and a known action type', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'unverified',
        logo: '',
        bannerUrl: '',
        website: '',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.tips.length).toBeGreaterThan(0);
    res.body.tips.forEach(item => {
      expect(Object.keys(item).sort()).toEqual(
        ['action', 'body', 'category', 'icon', 'id', 'priority', 'title'].sort()
      );
      expect(ACTION_TYPES).toContain(item.action.type);
      expect(item.action.label).toBeTruthy();
      expect(item.action).toHaveProperty('href');
      expect(item.title).toBeTruthy();
      expect(item.body).toBeTruthy();
    });
  });

  it('returns at most three tips, most useful first, and says how many applied', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        description_long: '',
        photosGallery: [],
        logo: '',
        bannerUrl: '',
        website: '',
        socialLinks: {},
        category: 'Other',
      }),
    });

    expect(res.body.tips).toHaveLength(MAX_TIPS);
    expect(res.body.total).toBeGreaterThan(MAX_TIPS);
    const priorities = res.body.tips.map(item => item.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it('a supplier with nothing to improve gets no tips (no filler)', async () => {
    const res = await tipsFor({
      extra: {
        packages: [{ id: 'p1', supplierId: 'sup-1', approved: true, image: '/uploads/p1.jpg' }],
        reviews: [
          {
            id: 'r1',
            supplierId: 'sup-1',
            rating: 5,
            approved: true,
            approvedBy: 'system',
            comment: 'Lovely',
            response: { text: 'Thanks!' },
          },
        ],
      },
    });

    expect(res.body).toEqual({ tips: [], total: 0 });
  });

  it('contains no invented statistics or promises in any tip copy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../services/supplierTips.js'), 'utf8');
    const strings = [...source.matchAll(/(?:body|title):\s*\n?\s*[`'"]([^`'"]+)[`'"]/g)].map(
      m => m[1]
    );

    expect(strings.length).toBeGreaterThan(10);
    strings.forEach(text => {
      expect(text).not.toMatch(
        /\d\s*×|\d+\s*%|triples|times more|more bookings|conversion|guarantee|boost your|increase your/i
      );
    });
  });
});

describe('tip copy', () => {
  it('no tip a supplier can be shown contains an invented statistic or promise', async () => {
    const worlds = [
      { supplier: completeSupplier({ description_long: '', photosGallery: [], logo: '' }) },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'needs_changes' }),
        subscription: PRO,
      },
      {
        supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
        extra: {
          enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
          reviews: [],
          packages: [],
        },
      },
      { user: { verified: false } },
    ];
    const copy = [];
    for (const world of worlds) {
      const res = await tipsFor(world);
      res.body.tips.forEach(item => copy.push(`${item.title} ${item.body}`));
    }

    expect(copy.length).toBeGreaterThan(6);
    copy.forEach(text => {
      expect(text).not.toMatch(
        /\d\s*×|\d+\s*%|triples|times more|more bookings|conversion|guarantee|boost your|increase your/i
      );
    });
  });
});

describe('account status comes first', () => {
  it('unverified email: only the email tip, and nothing the supplier cannot do yet', async () => {
    const res = await tipsFor({
      user: { verified: false },
      supplier: completeSupplier({ approved: false, verificationStatus: 'unverified', logo: '' }),
    });

    expect(ids(res)).toEqual(['verify-email']);
    expect(res.body.tips[0].action).toMatchObject({ type: 'verify-email', href: '/verify' });
  });

  it('verified email but never submitted: submit for review, then profile advice', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ approved: false, verificationStatus: 'unverified', logo: '' }),
    });

    expect(ids(res)[0]).toBe('submit-verification');
    expect(res.body.tips[0].action.type).toBe('open-verification');
    expect(ids(res)).toContain('add-profile-photo');
    // Packages cannot be created before approval, so no package tip.
    expect(ids(res)).not.toContain('first-package');
  });

  it('pending review: says it is waiting and when it was submitted', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'pending_review',
        verificationSubmittedAt: '2026-07-12T09:00:00.000Z',
      }),
    });

    const item = find(res, 'verification-pending');
    expect(item.body).toContain('12 Jul 2026');
    expect(item.action.type).toBe('open-profile-editor');
  });

  it('changes requested: shows the admin note and offers to resubmit', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'needs_changes',
        verificationNotes: 'Please add a phone number',
      }),
    });

    const item = find(res, 'verification-changes');
    expect(item.body).toContain('Please add a phone number');
    expect(item.action.type).toBe('open-verification');
  });

  it('rejected: resubmit while attempts remain, support once they are used up', async () => {
    const open = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'rejected',
        verificationRejectionCount: 2,
        verificationNotes: 'Profile incomplete',
      }),
    });
    const spent = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'rejected',
        verificationRejectionCount: 5,
      }),
    });

    expect(find(open, 'verification-rejected').action.type).toBe('open-verification');
    expect(find(open, 'verification-rejected').body).toContain('Profile incomplete');
    expect(find(spent, 'verification-rejected-final').action.type).toBe('open-support');
  });

  it('suspended: points at support', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ approved: false, verificationStatus: 'suspended' }),
    });

    expect(find(res, 'profile-suspended').action.type).toBe('open-support');
  });

  it('approved: no account tip at all', async () => {
    const res = await tipsFor({ supplier: completeSupplier({ logo: '' }) });

    expect(res.body.tips.map(item => item.category)).not.toContain('account');
  });
});

describe('category-specific advice', () => {
  const BARE = { description_long: '', photosGallery: [] };

  it.each([
    ['Venues', 'venue', /hire/],
    ['Photography', 'photo', /length of coverage/],
    ['Videography', 'photo', /length of coverage/],
    ['Catering', 'food', /menu or service style/],
    ['Cake', 'food', /menu or service style/],
    ['Music/DJ', 'music', /length of performance/],
    ['Entertainment', 'music', /length of performance/],
    ['Florist', 'styling', /event size or style/],
    ['Decor', 'styling', /event size or style/],
    ['Event Planner', 'planner', /level of planning/],
    ['Planning', 'planner', /level of planning/],
    ['Hair & Makeup', 'general', /roughly what it costs/],
  ])('%s gets %s package advice', async (category, group, pattern) => {
    expect(categoryGroup(category)).toBe(group);
    const res = await tipsFor({
      supplier: completeSupplier({ category }),
      extra: { packages: [] },
    });

    expect(find(res, 'first-package').body).toMatch(pattern);
  });

  it.each([
    ['Venues', /guests you can hold/],
    ['Photography', /your style/],
    ['Catering', /dietary needs/],
    ['Music/DJ', /equipment you bring/],
    ['Florist', /styles you create/],
    ['Event Planner', /parts of an event/],
    ['Wedding Fayre', /fayres run/],
    ['Transport', /what you offer and where you work/],
  ])(
    '%s gets a matching description prompt that reports the real length',
    async (category, pattern) => {
      const res = await tipsFor({
        supplier: completeSupplier({ category, description_long: 'Short text only.' }),
        extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
      });

      const item = find(res, 'write-description');
      expect(item.body).toMatch(pattern);
      expect(item.body).toContain('16 characters');
      expect(item.action).toMatchObject({ type: 'open-profile-editor', field: 'description' });
    }
  );

  it('measures the description with the same text the completeness check uses (incl. legacy blurb)', async () => {
    const { getSupplierDescriptionText } = require('../../services/supplierProfileCompleteness');
    expect(
      getSupplierDescriptionText({ description_long: ' long ', description_short: 'short' })
    ).toBe('long');
    expect(getSupplierDescriptionText({ description_short: 'short' })).toBe('short');
    expect(getSupplierDescriptionText({ blurb: 'admin blurb' })).toBe('admin blurb');
    expect(getSupplierDescriptionText(null)).toBe('');

    const res = await tipsFor({
      supplier: completeSupplier({ description_long: '', blurb: 'Only an admin blurb.' }),
      extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
    });
    // The prompt says how long the text the check measured is, not "no description".
    expect(find(res, 'write-description').body).toContain('20 characters');
  });

  it('gallery advice is category-specific and quotes the real photo count', async () => {
    const venue = await tipsFor({
      supplier: completeSupplier({ category: 'Venues', ...BARE, photosGallery: ['a.jpg'] }),
      extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
    });
    const caterer = await tipsFor({
      supplier: completeSupplier({
        category: 'Catering',
        ...BARE,
        photosGallery: ['a.jpg', 'b.jpg'],
      }),
      extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
    });

    expect(find(venue, 'add-photos').title).toBe('Add more photos (1 of 3)');
    expect(find(venue, 'add-photos').body).toMatch(/space set up/);
    expect(find(caterer, 'add-photos').title).toBe('Add more photos (2 of 3)');
    expect(find(caterer, 'add-photos').body).toMatch(/real dishes/);
  });

  it('a Wedding Fayre gets event advice, not a package tip', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ category: 'Wedding Fayre' }),
      extra: { packages: [] },
    });

    expect(ids(res)).not.toContain('first-package');
    expect(find(res, 'publish-event').action).toMatchObject({ type: 'open-calendar' });
  });

  it('only publisher categories are told about the public calendar', async () => {
    const photographer = await tipsFor({ supplier: completeSupplier() });
    const granted = await tipsFor({
      supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
    });
    const blocked = await tipsFor({
      supplier: completeSupplier({
        category: 'Event Planner',
        publicCalendarPublisherOverride: false,
      }),
    });

    expect(ids(photographer)).not.toContain('publish-event');
    expect(ids(granted)).toContain('publish-event');
    expect(ids(blocked)).not.toContain('publish-event');
  });

  it('does not tell a planner with an event coming up to add one', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ category: 'Event Planner' }),
      extra: {
        public_calendar_events: [
          {
            id: 'e1',
            createdByUserId: 'user-1',
            title: 'Open day',
            startDate: new Date(Date.now() + 5 * 24 * HOUR).toISOString(),
            status: 'published',
          },
        ],
      },
    });

    expect(ids(res)).not.toContain('publish-event');
  });

  it('asks a supplier left in "Other" to pick a category, as it hides them from category browsing', async () => {
    const res = await tipsFor({ supplier: completeSupplier({ category: 'Other' }) });

    const item = find(res, 'choose-category');
    expect(item.action).toMatchObject({ type: 'open-profile-editor', field: 'category' });
  });
});

describe('customers waiting on the supplier', () => {
  const CUSTOMER_CONVERSATION = (id, { created, replied = false, unread = 0 } = {}) => ({
    conversation: {
      _id: id,
      status: 'active',
      messageCount: replied ? 2 : 1,
      createdAt: new Date(created),
      updatedAt: new Date(created),
      participants: [
        { userId: 'user-1', role: 'supplier', unreadCount: unread },
        { userId: `cust-${id}`, role: 'customer' },
      ],
    },
    messages: [
      { conversationId: id, senderId: `cust-${id}`, createdAt: new Date(created) },
      ...(replied
        ? [
            {
              conversationId: id,
              senderId: 'user-1',
              createdAt: new Date(Date.parse(created) + 600000),
            },
          ]
        : []),
    ],
  });

  it('new enquiries outrank everything else, and disappear once handled', async () => {
    const extra = {
      quoteRequests: [
        {
          id: 'qr_1',
          name: 'Alice',
          createdAt: hoursAgo(5),
          suppliers: [{ supplierId: 'sup-1' }],
        },
      ],
      enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
      packages: [],
    };
    const res = await tipsFor({
      supplier: completeSupplier({ logo: '' }),
      extra,
      subscription: PRO,
    });

    if (process.env.SUPPLIER_CONTRACT_DUMP_DIR) {
      fs.writeFileSync(
        path.join(process.env.SUPPLIER_CONTRACT_DUMP_DIR, 'performance-tips.json'),
        `${JSON.stringify(res.body, null, 2)}\n`
      );
    }
    expect(ids(res)[0]).toBe('new-enquiries');
    expect(find(res, 'new-enquiries').title).toBe('2 new enquiries to look at');
    expect(find(res, 'new-enquiries').action.type).toBe('open-enquiries');

    const handled = await tipsFor({
      supplier: completeSupplier({ logo: '' }),
      subscription: PRO,
      extra: {
        ...extra,
        supplier_enquiry_states: [
          { id: 'sup-1:qr_1', supplierId: 'sup-1', enquiryId: 'qr_1', status: 'handled' },
          { id: 'sup-1:enq_1', supplierId: 'sup-1', enquiryId: 'enq_1', status: 'read' },
        ],
      },
    });
    expect(ids(handled)).not.toContain('new-enquiries');
  });

  it('uses the singular for one enquiry', async () => {
    const res = await tipsFor({
      subscription: PRO,
      extra: {
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
      },
    });

    expect(find(res, 'new-enquiries').title).toBe('1 new enquiry to look at');
  });

  it("does not count another supplier's enquiries", async () => {
    const res = await tipsFor({
      subscription: PRO,
      extra: {
        enquiries: [{ id: 'enq_9', supplierId: 'sup-2', createdAt: hoursAgo(3) }],
        quoteRequests: [
          { id: 'qr_9', createdAt: hoursAgo(3), suppliers: [{ supplierId: 'sup-2' }] },
        ],
      },
    });

    expect(ids(res)).not.toContain('new-enquiries');
  });

  it('flags conversations older than a day with no reply, with the real count and window', async () => {
    const a = CUSTOMER_CONVERSATION('a', { created: hoursAgo(50) });
    const b = CUSTOMER_CONVERSATION('b', { created: hoursAgo(60) });
    const replied = CUSTOMER_CONVERSATION('c', { created: hoursAgo(70), replied: true });
    const fresh = CUSTOMER_CONVERSATION('d', { created: hoursAgo(2) });
    const res = await tipsFor({
      subscription: PRO,
      extra: {
        conversations_v4: [a, b, replied, fresh].map(item => item.conversation),
        chat_messages_v4: [a, b, replied, fresh].flatMap(item => item.messages),
      },
    });

    const item = find(res, 'unanswered-conversations');
    expect(item.title).toBe('2 conversations still need a reply');
    expect(item.body).toContain('last 30 days');
    expect(item.action.type).toBe('open-messages');
  });

  it('falls back to unread messages when nothing is overdue', async () => {
    const fresh = CUSTOMER_CONVERSATION('d', { created: hoursAgo(2), unread: 3 });
    const res = await tipsFor({
      subscription: PRO,
      extra: {
        conversations_v4: [fresh.conversation],
        chat_messages_v4: fresh.messages,
      },
    });

    expect(ids(res)).not.toContain('unanswered-conversations');
    expect(find(res, 'unread-messages').title).toBe('You have 3 unread messages');
  });

  it('counts unanswered published reviews of both stored shapes, not pending or answered ones', async () => {
    const res = await tipsFor({
      extra: {
        reviews: [
          { id: 'l1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' },
          { _id: 'v1', supplierId: 'sup-1', rating: 4, moderation: { state: 'approved' } },
          {
            _id: 'v2',
            supplierId: 'sup-1',
            rating: 4,
            moderation: { state: 'approved' },
            response: { text: 'Thanks' },
          },
          { id: 'l2', supplierId: 'sup-1', rating: 2, approved: false, approvedBy: null },
          { _id: 'v3', supplierId: 'sup-1', rating: 2, moderation: { state: 'pending' } },
          { id: 'x', supplierId: 'sup-2', rating: 5, approved: true },
        ],
      },
    });

    const item = find(res, 'unanswered-reviews');
    expect(item.title).toBe('Reply to 2 reviews');
    expect(item.action.type).toBe('open-reviews');
  });

  it('asks for a first review only when there are none published; mentions ones in moderation', async () => {
    const none = await tipsFor({ extra: { reviews: [] } });
    const pending = await tipsFor({
      extra: {
        reviews: [{ _id: 'v3', supplierId: 'sup-1', rating: 2, moderation: { state: 'pending' } }],
      },
    });

    expect(find(none, 'first-review').action).toMatchObject({
      type: 'open-review-request',
      data: 'request-review',
    });
    expect(find(pending, 'first-review').body).toMatch(/waiting for moderation/);
  });

  it('gives no customer tips to a supplier who is not approved yet', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ approved: false, verificationStatus: 'pending_review' }),
      extra: {
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
        reviews: [],
      },
    });

    expect(ids(res)).toEqual(['verification-pending']);
  });

  it('survives the messenger being unavailable and still gives the other tips', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ logo: '' }),
      failOn: ['conversations_v4'],
    });

    expect(res.status).toBe(200);
    expect(ids(res)).toContain('add-profile-photo');
    expect(ids(res)).not.toContain('unanswered-conversations');
    expect(ids(res)).not.toContain('unread-messages');
  });
});

describe('packages and the real plan limits', () => {
  const PACKAGE = (id, fields = {}) => ({
    id,
    supplierId: 'sup-1',
    approved: true,
    image: '/uploads/p.jpg',
    ...fields,
  });

  it('counts packages with no photo of their own', async () => {
    const res = await tipsFor({
      extra: {
        packages: [
          PACKAGE('p1'),
          PACKAGE('p2', { image: '/assets/images/package-placeholder.webp' }),
          PACKAGE('p3', { image: '' }),
        ],
      },
    });

    const item = find(res, 'package-photos');
    expect(item.title).toBe('2 packages have no photo');
    expect(item.action).toMatchObject({ type: 'open-packages', field: 'photos' });
  });

  it('reports packages waiting for approval', async () => {
    const res = await tipsFor({
      extra: { packages: [PACKAGE('p1'), PACKAGE('p2', { approved: false })] },
    });

    expect(find(res, 'packages-awaiting-approval').title).toBe('1 package is waiting for approval');
  });

  it('on the free plan, using all 3 package places says so and points at the plan', async () => {
    const res = await tipsFor({
      extra: { packages: [PACKAGE('p1'), PACKAGE('p2'), PACKAGE('p3')] },
    });

    const item = find(res, 'package-limit');
    expect(item.title).toBe('You have used all 3 package places on your plan');
    expect(item.action.type).toBe('open-plan');
  });

  it('does not count paused packages towards the limit, and has no limit tip below it', async () => {
    const res = await tipsFor({
      extra: { packages: [PACKAGE('p1'), PACKAGE('p2'), PACKAGE('p3', { paused: true })] },
    });

    expect(ids(res)).not.toContain('package-limit');
  });

  it('uses the plan the supplier is really on (Professional allows 50)', async () => {
    const res = await tipsFor({
      subscription: PRO,
      extra: { packages: [PACKAGE('p1'), PACKAGE('p2'), PACKAGE('p3')] },
    });

    expect(ids(res)).not.toContain('package-limit');
  });

  it('a full photo gallery is reported against the real allowance', async () => {
    const photos = Array.from({ length: 10 }, (_, index) => `photo-${index}.jpg`);
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: photos }),
      extra: { packages: [PACKAGE('p1')] },
    });

    const item = find(res, 'photo-limit');
    expect(item.title).toBe('Your gallery is full (10 of 10 photos)');
    expect(item.action.type).toBe('open-plan');
  });

  it('a Professional supplier with the same 10 photos is not told the gallery is full', async () => {
    const photos = Array.from({ length: 10 }, (_, index) => `photo-${index}.jpg`);
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: photos }),
      subscription: PRO,
      extra: { packages: [PACKAGE('p1')] },
    });

    expect(ids(res)).not.toContain('photo-limit');
  });

  it("does not use another supplier's packages", async () => {
    const res = await tipsFor({
      extra: {
        packages: [PACKAGE('x1', { supplierId: 'sup-2', image: '' })],
      },
    });

    expect(ids(res)).toContain('first-package');
    expect(ids(res)).not.toContain('package-photos');
  });
});

describe('photo limit counts only the photos the plan lets the supplier use', () => {
  const hidden = name => ({ url: name, hiddenByPlanLimit: true });
  const shown = name => ({ url: name });
  const PACKAGES = {
    packages: [{ id: 'p1', supplierId: 'sup-1', approved: true, image: '/p.jpg' }],
  };

  it('12 photos of which 2 are hidden on the free plan reads "10 of 10", never "12 of 10"', async () => {
    const photos = [
      ...Array.from({ length: 10 }, (_, index) => shown(`v${index}.jpg`)),
      hidden('h1.jpg'),
      hidden('h2.jpg'),
    ];
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: photos }),
      extra: PACKAGES,
    });

    expect(find(res, 'photo-limit').title).toBe('Your gallery is full (10 of 10 photos)');
  });

  it('a downgraded supplier with room left is not told the gallery is full', async () => {
    const photos = [
      ...Array.from({ length: 6 }, (_, index) => shown(`v${index}.jpg`)),
      ...Array.from({ length: 6 }, (_, index) => hidden(`h${index}.jpg`)),
    ];
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: photos }),
      extra: PACKAGES,
    });

    expect(ids(res)).not.toContain('photo-limit');
  });

  it('"Add more photos (n of 3)" does not count a hidden photo either', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: [shown('a.jpg'), hidden('b.jpg')] }),
      extra: PACKAGES,
    });

    expect(find(res, 'add-photos').title).toBe('Add more photos (1 of 3)');
  });

  it('"Add more photos (n of 3)" counts a legacy-only photo, as the checklist that opened it does', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ photosGallery: [], images: ['/uploads/old-1.jpg'] }),
      extra: PACKAGES,
    });

    expect(find(res, 'add-photos').title).toBe('Add more photos (1 of 3)');
  });

  it('the tip and the upload check share one helper, so they cannot disagree', () => {
    const { countAllowanceGalleryPhotos } = require('../../utils/photoGalleryAllowance');
    const supplier = { photosGallery: [shown('a'), hidden('b'), 'c.jpg'], images: ['legacy.jpg'] };

    expect(countAllowanceGalleryPhotos(supplier)).toBe(2);
    expect(countAllowanceGalleryPhotos({})).toBe(0);
    expect(countAllowanceGalleryPhotos(null)).toBe(0);
    const source = fs.readFileSync(path.join(__dirname, '../../services/supplierTips.js'), 'utf8');
    expect(source).toContain("require('../utils/photoGalleryAllowance')");
    // The limit tip counts like the upload check; only the "add photos" tip (which a checklist
    // count under 3 opens) uses the checklist's own gallery count.
    expect(source).not.toContain('getSupplierGalleryCount(supplier)');
  });
});

describe('tips never state something the data does not show', () => {
  it('no "nothing coming up" tip when the calendar could not be read', async () => {
    const publisher = completeSupplier({ publicCalendarPublisherOverride: true });
    const readable = await tipsFor({ supplier: publisher });
    const unreadable = await tipsFor({
      supplier: publisher,
      failOn: ['customer_calendar_entries'],
    });

    expect(ids(readable)).toContain('publish-event');
    expect(unreadable.status).toBe(200);
    expect(ids(unreadable)).not.toContain('publish-event');
  });

  it('an approved record whose listing is not approved is not asked to submit again', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verified: true,
        verificationStatus: 'approved',
      }),
    });

    expect(ids(res)).not.toContain('submit-verification');
    const item = find(res, 'listing-awaiting-approval');
    expect(item.title).toMatch(/waiting for listing approval/);
    expect(item.action.type).toBe('open-support');
  });

  it('a pending profile with no submission date says nothing about a date (not 1 Jan 1970)', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ approved: false, verificationStatus: 'pending_review' }),
    });

    const item = find(res, 'verification-pending');
    expect(item.body).not.toMatch(/1970|You submitted it on/);
    expect(item.body).toMatch(/^An admin is reviewing it/);
  });

  it('an approved supplier with an unverified email is not offered what the server would refuse', async () => {
    const publisher = completeSupplier({ publicCalendarPublisherOverride: true });
    const quiet = await tipsFor({ user: { verified: false }, supplier: publisher });
    const waiting = await tipsFor({
      user: { verified: false },
      supplier: publisher,
      extra: { enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }] },
    });

    expect(ids(quiet)).toEqual(['verify-email']);
    // A customer waiting is still worth knowing about; publishing and review requests are not.
    expect(ids(waiting)).toEqual(['verify-email', 'new-enquiries']);
  });
});

describe('tip wording', () => {
  const conversations = count => {
    const items = Array.from({ length: count }, (_, index) => {
      const created = hoursAgo(50 + index);
      return {
        conversation: {
          _id: `c${index}`,
          status: 'active',
          messageCount: 1,
          createdAt: new Date(created),
          updatedAt: new Date(created),
          participants: [
            { userId: 'user-1', role: 'supplier', unreadCount: 0 },
            { userId: `cust-${index}`, role: 'customer' },
          ],
        },
        message: {
          conversationId: `c${index}`,
          senderId: `cust-${index}`,
          createdAt: new Date(created),
        },
      };
    });
    return {
      conversations_v4: items.map(item => item.conversation),
      chat_messages_v4: items.map(item => item.message),
    };
  };

  it('unanswered conversations: grammatical for one and for several', async () => {
    const one = await tipsFor({ subscription: PRO, extra: conversations(1) });
    const three = await tipsFor({ subscription: PRO, extra: conversations(3) });

    expect(find(one, 'unanswered-conversations').body).toBe(
      '1 conversation started by customers in the last 30 days is more than a day old and has no reply from you.'
    );
    expect(find(three, 'unanswered-conversations').body).toBe(
      '3 conversations started by customers in the last 30 days are more than a day old and have no reply from you.'
    );
  });

  it('a one-character description is "1 character"', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ description_long: 'x' }),
      extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
    });

    expect(find(res, 'write-description').body).toContain('Your description is 1 character;');
  });

  it.each([
    ['needs_changes', 'An admin asked for changes before approving it.'],
    ['rejected', 'Your profile was not approved.'],
  ])('%s: the admin note ends in a full stop before the next sentence', async (status, lead) => {
    for (const note of ['add a logo', 'add a logo!  ']) {
      const res = await tipsFor({
        supplier: completeSupplier({
          approved: false,
          verificationStatus: status,
          verificationNotes: note,
        }),
      });
      const item = res.body.tips.find(entry => entry.category === 'account');
      expect(item.body).toContain(`${lead} Admin note: add a logo. `);
      expect(item.body).not.toContain('logo Update');
      expect(item.body).not.toContain('..');
    }
  });

  it('the final-rejection tip also punctuates the admin note', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'rejected',
        verificationRejectionCount: 5,
        verificationNotes: 'not suitable',
      }),
    });

    expect(find(res, 'verification-rejected-final').body).toContain(
      'Admin note: not suitable. Contact support'
    );
  });

  it('a supplier with no category is told that, not that they are listed under "Other"', async () => {
    const none = await tipsFor({ supplier: completeSupplier({ category: '' }) });
    const other = await tipsFor({ supplier: completeSupplier({ category: 'Other' }) });

    expect(find(none, 'choose-category').body).toMatch(/^Your profile has no category/);
    expect(find(other, 'choose-category').body).toMatch(/^Your profile is listed under "Other"/);
  });

  it.each([
    [{ location: '', basePostcode: '' }, 'Add your location and postcode', /without one/],
    [{ location: 'Cardiff', basePostcode: '' }, 'Add your postcode', /postcode, so a profile/],
    [
      { location: '', basePostcode: 'CF10 1AA' },
      'Add your location',
      /has a postcode but no location/,
    ],
  ])('add-location names what is missing: %j', async (fields, title, pattern) => {
    const res = await tipsFor({
      supplier: completeSupplier(fields),
      extra: { packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }] },
    });

    const item = find(res, 'add-location');
    expect(item.title).toBe(title);
    expect(item.body).toMatch(pattern);
  });

  it('the banner, social and website tips have different icons', async () => {
    const { buildTips } = require('../../services/supplierTips');
    const { buildSummaryWithContext } = require('../../services/supplierDashboardSummary');
    clearEngagementCache();
    const supplier = completeSupplier({ bannerUrl: '', socialLinks: {}, website: '' });
    fakeDb.__reset({
      users: [{ id: 'user-1', verified: true, email: 'owner@example.com' }],
      suppliers: [supplier],
      packages: [{ id: 'p', supplierId: 'sup-1', approved: true, image: '/p.jpg' }],
      reviews: [
        {
          id: 'r1',
          supplierId: 'sup-1',
          rating: 5,
          approved: true,
          approvedBy: 'system',
          response: { text: 'Thanks!' },
        },
      ],
    });
    const { summary, raw } = await buildSummaryWithContext({
      userId: 'user-1',
      supplier,
      lean: true,
    });

    const built = buildTips({ supplier, summary, raw, canPublishPublicCalendar: false });

    expect(built.tips.map(item => item.id).sort()).toEqual(
      ['add-banner', 'add-social-links', 'add-website'].sort()
    );
    const icons = built.tips.map(item => item.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('the tips request is cheap', () => {
  it('does not read events, tickets, review requests or the owner profile list', async () => {
    const reads = ['find', 'findOne', 'count', 'aggregate', 'findWithOptions'];
    reads.forEach(name => fakeDb[name].mockClear());

    const res = await tipsFor({ subscription: PRO });

    expect(res.status).toBe(200);
    const collections = reads.flatMap(name => fakeDb[name].mock.calls.map(call => call[0]));
    expect(collections).not.toContain('events');
    expect(collections).not.toContain('tickets');
    expect(collections).not.toContain('reviewRequests');
    // What the tips do need is still read.
    expect(collections).toEqual(expect.arrayContaining(['users', 'packages', 'reviews']));
    // The owner's profile list is only for the dashboard's profile count.
    expect(fakeDb.find.mock.calls.filter(call => call[0] === 'suppliers')).toHaveLength(0);
  });
});
