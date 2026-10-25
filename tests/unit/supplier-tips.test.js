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
const { ACTION_TYPES, MAX_TIPS } = require('../../services/supplierTips');
const { buildDashboardSummary } = require('../../services/supplierDashboardSummary');

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

/**
 * Seed one world, fetch the tips, and read the Next steps checklist the dashboard would show for the
 * same supplier (same database, no reset in between).
 *
 * @param {Object} [world] - Same as tipsFor
 * @returns {Promise<{res: Object, steps: Object[], open: string[], done: string[]}>} Tips response and checklist
 */
async function tipsAndChecklist(world = {}) {
  const res = await tipsFor(world);
  const supplier = await fakeDb.findOne('suppliers', { ownerUserId: 'user-1' });
  const summary = await buildDashboardSummary({ userId: 'user-1', supplier });
  const steps = summary.nextSteps.steps;
  return {
    res,
    steps,
    open: steps.filter(step => !step.done).map(step => step.id),
    done: steps.filter(step => step.done).map(step => step.id),
  };
}

/**
 * The checklist step each tip would restate. A tip listed here must never be shown while its step
 * is open; the ones marked `keptWhenDone` are real tips that only appear once the step is done.
 * A tip id that is not here has no checklist counterpart.
 */
const TIP_RESTATES_STEP = {
  'verify-email': 'verify-email',
  'submit-verification': 'get-verified',
  'verification-pending': 'get-verified',
  'write-description': 'description',
  'add-photos': 'gallery',
  'add-profile-photo': 'profile-photo',
  'add-location': 'business-details',
  'add-banner': 'banner',
  'add-social-links': 'social-links',
  'add-website': 'website',
  'first-package': 'first-package',
  'package-photos': 'package-photos',
  'first-review': 'request-review',
  'publish-event': 'calendar',
};
/** Tips that still exist, and may only be shown once their step is done. */
const KEPT_WHEN_STEP_DONE = ['publish-event'];
/** Tips that existed only to restate a step and are gone. */
const REMOVED_TIPS = Object.keys(TIP_RESTATES_STEP).filter(id => !KEPT_WHEN_STEP_DONE.includes(id));

/** A calendar entry in the past: the supplier has used their calendar, but nothing is coming up. */
const PAST_ENTRY = { id: 'ce1', userId: 'user-1', title: 'Old job', date: '2020-01-01' };

/** A supplier with every checklist item open: nothing set up. */
const NOTHING_SET_UP = {
  description_long: '',
  photosGallery: [],
  logo: '',
  bannerUrl: '',
  website: '',
  socialLinks: {},
  location: '',
  basePostcode: '',
};

const TEN_PHOTOS = Array.from({ length: 10 }, (_, index) => `photo-${index}.jpg`);

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
    const worlds = [
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'needs_changes' }),
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'suspended' }),
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'rejected' }),
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'approved' }),
      },
      {
        supplier: completeSupplier({ category: 'Other', photosGallery: TEN_PHOTOS }),
        extra: {
          enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
          reviews: [
            { id: 'r1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' },
          ],
          packages: [{ id: 'p1', supplierId: 'sup-1', approved: false, image: '/p.jpg' }],
        },
      },
      {
        supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
        extra: { customer_calendar_entries: [PAST_ENTRY] },
      },
    ];
    const seen = [];
    for (const world of worlds) {
      const res = await tipsFor(world);
      expect(res.status).toBe(200);
      seen.push(...res.body.tips);
    }

    expect(seen.length).toBeGreaterThan(6);
    seen.forEach(item => {
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
      supplier: completeSupplier({ category: 'Other', photosGallery: TEN_PHOTOS }),
      extra: {
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
        reviews: [
          { id: 'r1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' },
        ],
        packages: [
          { id: 'p1', supplierId: 'sup-1', approved: false, image: '/p.jpg' },
          { id: 'p2', supplierId: 'sup-1', approved: true, image: '/p.jpg' },
          { id: 'p3', supplierId: 'sup-1', approved: true, image: '/p.jpg' },
        ],
      },
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
      {
        supplier: completeSupplier({ category: 'Other', photosGallery: TEN_PHOTOS }),
        extra: { packages: [{ id: 'p1', supplierId: 'sup-1', approved: false, image: '/p.jpg' }] },
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'needs_changes' }),
        subscription: PRO,
      },
      {
        supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
        extra: {
          customer_calendar_entries: [PAST_ENTRY],
          enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
          reviews: [
            { id: 'r1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' },
          ],
        },
      },
      { supplier: completeSupplier({ approved: false, verificationStatus: 'suspended' }) },
      { supplier: completeSupplier({ approved: false, verificationStatus: 'rejected' }) },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'approved' }),
      },
    ];
    const copy = [];
    for (const world of worlds) {
      const res = await tipsFor(world);
      res.body.tips.forEach(item => copy.push(`${item.title} ${item.body}`));
    }

    expect(copy.length).toBeGreaterThan(8);
    copy.forEach(text => {
      expect(text).not.toMatch(
        /\d\s*×|\d+\s*%|triples|times more|more bookings|conversion|guarantee|boost your|increase your/i
      );
    });
  });
});

describe('account status comes first', () => {
  it('unverified email: no tip, the checklist already leads with "Verify your email address"', async () => {
    const { res, open, steps } = await tipsAndChecklist({
      user: { verified: false },
      supplier: completeSupplier({ approved: false, verificationStatus: 'unverified', logo: '' }),
    });

    expect(res.body).toEqual({ tips: [], total: 0 });
    expect(open).toContain('verify-email');
    expect(steps.find(step => step.id === 'verify-email').locked).toBe(false);
  });

  it('a suspended profile is still told, whatever the email state', async () => {
    const res = await tipsFor({
      user: { verified: false },
      supplier: completeSupplier({ approved: false, verificationStatus: 'suspended' }),
    });

    expect(ids(res)).toEqual(['profile-suspended']);
  });

  it('verified email but never submitted: no tip, "Get your profile verified" is the checklist step', async () => {
    const { res, open } = await tipsAndChecklist({
      supplier: completeSupplier({ approved: false, verificationStatus: 'unverified', logo: '' }),
    });

    expect(res.body).toEqual({ tips: [], total: 0 });
    expect(open).toEqual(expect.arrayContaining(['get-verified', 'profile-photo']));
  });

  it('pending review: no tip, the checklist step already says an admin is reviewing it', async () => {
    const { res, steps } = await tipsAndChecklist({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'pending_review',
        verificationSubmittedAt: '2026-07-12T09:00:00.000Z',
      }),
    });

    expect(res.body).toEqual({ tips: [], total: 0 });
    expect(steps.find(step => step.id === 'get-verified')).toMatchObject({
      done: false,
      locked: true,
      lockedReason: 'Your profile is waiting for an admin to review it',
    });
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

describe('calendar and category advice', () => {
  const USED_CALENDAR = { customer_calendar_entries: [PAST_ENTRY] };

  it('a Wedding Fayre is told about the public calendar once it has used it, and never about packages', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ category: 'Wedding Fayre' }),
      extra: { ...USED_CALENDAR, packages: [] },
    });

    expect(ids(res)).toEqual(['publish-event']);
    expect(find(res, 'publish-event').action).toMatchObject({ type: 'open-calendar' });
  });

  it('a publisher who has never added a calendar event is not told twice: the checklist step covers it', async () => {
    const { res, open } = await tipsAndChecklist({
      supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
    });

    expect(open).toContain('calendar');
    expect(ids(res)).not.toContain('publish-event');
  });

  it('only publisher categories are told about the public calendar', async () => {
    const extra = { customer_calendar_entries: [PAST_ENTRY] };
    const photographer = await tipsFor({ supplier: completeSupplier(), extra });
    const granted = await tipsFor({
      supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
      extra,
    });
    const blocked = await tipsFor({
      supplier: completeSupplier({
        category: 'Event Planner',
        publicCalendarPublisherOverride: false,
      }),
      extra,
    });

    expect(ids(photographer)).not.toContain('publish-event');
    expect(ids(granted)).toContain('publish-event');
    expect(ids(blocked)).not.toContain('publish-event');
  });

  it('does not tell a planner with an event coming up to add one', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ category: 'Event Planner' }),
      extra: {
        customer_calendar_entries: [PAST_ENTRY],
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
    const { res, done } = await tipsAndChecklist({
      supplier: completeSupplier({ category: 'Other' }),
    });

    const item = find(res, 'choose-category');
    expect(item.action).toMatchObject({ type: 'open-profile-editor', field: 'category' });
    // "Other" is a valid category for the verification form, so the checklist step is done.
    expect(done).toContain('business-details');
  });

  it('a supplier with no category is not given a tip: the checklist step "Complete your business details" covers it', async () => {
    const { res, open } = await tipsAndChecklist({ supplier: completeSupplier({ category: '' }) });

    expect(open).toContain('business-details');
    expect(ids(res)).not.toContain('choose-category');
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
      supplier: completeSupplier({ category: 'Other' }),
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
      supplier: completeSupplier({ category: 'Other' }),
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

  it('does not ask for a first review: that is the checklist step "Ask a past customer for a review"', async () => {
    const none = await tipsAndChecklist({ extra: { reviews: [] } });
    const pending = await tipsAndChecklist({
      extra: {
        reviews: [{ _id: 'v3', supplierId: 'sup-1', rating: 2, moderation: { state: 'pending' } }],
      },
    });

    expect(none.open).toContain('request-review');
    expect(pending.open).toContain('request-review');
    expect(none.res.body).toEqual({ tips: [], total: 0 });
    expect(ids(pending.res)).toEqual([]);
  });

  it('gives no customer tips to a supplier who is not approved yet', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ approved: false, verificationStatus: 'needs_changes' }),
      extra: {
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
        reviews: [],
      },
    });

    expect(ids(res)).toEqual(['verification-changes']);
  });

  it('survives the messenger being unavailable and still gives the other tips', async () => {
    const res = await tipsFor({
      supplier: completeSupplier({ category: 'Other' }),
      failOn: ['conversations_v4'],
    });

    expect(res.status).toBe(200);
    expect(ids(res)).toContain('choose-category');
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

  it('does not tell the supplier about packages with no photo: that is the checklist step "Add a photo to every package"', async () => {
    const { res, open } = await tipsAndChecklist({
      extra: {
        packages: [
          PACKAGE('p1'),
          PACKAGE('p2', { image: '/assets/images/package-placeholder.webp' }),
        ],
      },
    });

    expect(open).toContain('package-photos');
    expect(ids(res)).not.toContain('package-photos');
    expect(res.body).toEqual({ tips: [], total: 0 });
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
        packages: [
          PACKAGE('x1', { supplierId: 'sup-2', approved: false }),
          PACKAGE('x2', { supplierId: 'sup-2' }),
          PACKAGE('x3', { supplierId: 'sup-2' }),
          PACKAGE('x4', { supplierId: 'sup-2' }),
        ],
      },
    });

    expect(ids(res)).not.toContain('package-limit');
    expect(ids(res)).not.toContain('packages-awaiting-approval');
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

  it('a gallery with fewer than 3 photos is no tip: that is the checklist step "Add at least 3 gallery photos"', async () => {
    const hiddenOne = await tipsAndChecklist({
      supplier: completeSupplier({ photosGallery: [shown('a.jpg'), hidden('b.jpg')] }),
      extra: PACKAGES,
    });
    const legacyOnly = await tipsAndChecklist({
      supplier: completeSupplier({ photosGallery: [], images: ['/uploads/old-1.jpg'] }),
      extra: PACKAGES,
    });

    expect(hiddenOne.open).toContain('gallery');
    expect(legacyOnly.open).toContain('gallery');
    expect(ids(hiddenOne.res)).not.toContain('add-photos');
    expect(ids(legacyOnly.res)).not.toContain('add-photos');
    // Nowhere does the "full" tip fire for them either: the allowance is 10.
    expect(ids(hiddenOne.res)).not.toContain('photo-limit');
    expect(ids(legacyOnly.res)).not.toContain('photo-limit');
  });

  it('the tip and the upload check share one helper, so they cannot disagree', () => {
    const { countAllowanceGalleryPhotos } = require('../../utils/photoGalleryAllowance');
    const supplier = { photosGallery: [shown('a'), hidden('b'), 'c.jpg'], images: ['legacy.jpg'] };

    expect(countAllowanceGalleryPhotos(supplier)).toBe(2);
    expect(countAllowanceGalleryPhotos({})).toBe(0);
    expect(countAllowanceGalleryPhotos(null)).toBe(0);
    const source = fs.readFileSync(path.join(__dirname, '../../services/supplierTips.js'), 'utf8');
    expect(source).toContain("require('../utils/photoGalleryAllowance')");
    // The limit tip counts like the upload check, never with the checklist's own gallery count.
    expect(source).not.toContain('getSupplierGalleryCount');
  });
});

describe('tips never state something the data does not show', () => {
  it('no "nothing coming up" tip when the calendar could not be read', async () => {
    const publisher = completeSupplier({ publicCalendarPublisherOverride: true });
    const extra = { customer_calendar_entries: [PAST_ENTRY] };
    const readable = await tipsFor({ supplier: publisher, extra });
    const unreadable = await tipsFor({
      supplier: publisher,
      extra,
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

  it('an approved supplier with an unverified email is not offered what the server would refuse', async () => {
    const publisher = completeSupplier({ publicCalendarPublisherOverride: true });
    const calendar = { customer_calendar_entries: [PAST_ENTRY] };
    const quiet = await tipsFor({
      user: { verified: false },
      supplier: publisher,
      extra: calendar,
    });
    const waiting = await tipsFor({
      user: { verified: false },
      supplier: publisher,
      extra: {
        ...calendar,
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
      },
    });

    // Publishing a calendar event needs a verified email, so it is not offered.
    expect(ids(quiet)).toEqual([]);
    // A customer waiting is still worth knowing about.
    expect(ids(waiting)).toEqual(['new-enquiries']);
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

  it('the "Other" category tip says what is wrong in the supplier\'s own terms', async () => {
    const other = await tipsFor({ supplier: completeSupplier({ category: 'Other' }) });

    expect(find(other, 'choose-category').body).toMatch(/^Your profile is listed under "Other"/);
  });
});

describe('tips never repeat the Next steps checklist', () => {
  const PACKAGE = (id, fields = {}) => ({
    id,
    supplierId: 'sup-1',
    approved: true,
    image: '/uploads/p.jpg',
    ...fields,
  });

  it('a profile with every setup step open and no live activity gets no tips at all', async () => {
    const { res, open } = await tipsAndChecklist({
      supplier: completeSupplier(NOTHING_SET_UP),
      extra: { packages: [], reviews: [] },
    });

    expect(open).toEqual(
      expect.arrayContaining([
        'profile-photo',
        'description',
        'gallery',
        'banner',
        'social-links',
        'website',
        'business-details',
        'first-package',
        'request-review',
        'calendar',
      ])
    );
    expect(res.body).toEqual({ tips: [], total: 0 });
  });

  it.each(REMOVED_TIPS)(
    'the removed tip "%s" is never produced while its checklist step is open',
    async tipId => {
      const stepId = TIP_RESTATES_STEP[tipId];
      // A world in which this step is open, whatever else the supplier has.
      const worlds = {
        'verify-email': {
          user: { verified: false },
          supplier: completeSupplier({ approved: false, verificationStatus: 'unverified' }),
        },
        'submit-verification': {
          supplier: completeSupplier({ approved: false, verificationStatus: 'unverified' }),
        },
        'verification-pending': {
          supplier: completeSupplier({ approved: false, verificationStatus: 'pending_review' }),
        },
        'write-description': { supplier: completeSupplier({ description_long: 'Too short.' }) },
        'add-photos': { supplier: completeSupplier({ photosGallery: ['a.jpg'] }) },
        'add-profile-photo': { supplier: completeSupplier({ logo: '' }) },
        'add-location': { supplier: completeSupplier({ location: '', basePostcode: '' }) },
        'add-banner': { supplier: completeSupplier({ bannerUrl: '' }) },
        'add-social-links': { supplier: completeSupplier({ socialLinks: {} }) },
        'add-website': { supplier: completeSupplier({ website: '' }) },
        'first-package': { extra: { packages: [] } },
        'package-photos': { extra: { packages: [PACKAGE('p1', { image: '' })] } },
        'first-review': { extra: { reviews: [] } },
      };
      expect(Object.keys(worlds).sort()).toEqual([...REMOVED_TIPS].sort());

      const { res, open } = await tipsAndChecklist(worlds[tipId]);

      expect(open).toContain(stepId);
      expect(ids(res)).not.toContain(tipId);
      // The only tips a supplier like this can get are ones with no checklist counterpart.
      expect(res.body.total).toBe(0);
    }
  );

  it('a single-field gap is flagged by the checklist, not by a tip: description, location, category', async () => {
    const short = await tipsAndChecklist({
      supplier: completeSupplier({ description_long: 'Short text only.' }),
    });
    const noPostcode = await tipsAndChecklist({
      supplier: completeSupplier({ basePostcode: '' }),
    });

    expect(short.open).toContain('description');
    expect(noPostcode.open).toContain('business-details');
    expect(short.res.body.total).toBe(0);
    expect(noPostcode.res.body.total).toBe(0);
  });

  it('whatever tips a supplier gets, none restates an open checklist step', async () => {
    const calendar = { customer_calendar_entries: [PAST_ENTRY] };
    const busy = {
      enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
      reviews: [{ id: 'r1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' }],
      packages: [PACKAGE('p1'), PACKAGE('p2'), PACKAGE('p3'), PACKAGE('p4', { approved: false })],
    };
    const worlds = [
      { supplier: completeSupplier(NOTHING_SET_UP), extra: busy },
      { supplier: completeSupplier({ ...NOTHING_SET_UP, category: 'Other' }), extra: busy },
      { supplier: completeSupplier({ category: 'Other' }), extra: { ...busy, ...calendar } },
      {
        supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
        extra: { ...busy, ...calendar },
      },
      { supplier: completeSupplier({ publicCalendarPublisherOverride: true }), extra: busy },
      {
        supplier: completeSupplier({ category: 'Other', photosGallery: TEN_PHOTOS }),
        extra: { ...busy, ...calendar },
      },
      { user: { verified: false }, supplier: completeSupplier(NOTHING_SET_UP), extra: busy },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'needs_changes' }),
        extra: busy,
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'rejected' }),
        extra: busy,
      },
      {
        supplier: completeSupplier({ approved: false, verificationStatus: 'suspended' }),
        extra: busy,
      },
    ];

    let shown = 0;
    for (const world of worlds) {
      const { res, open } = await tipsAndChecklist(world);
      res.body.tips.forEach(item => {
        shown += 1;
        // No tip carries the id of an open step, and none maps onto one.
        expect(open).not.toContain(item.id);
        const restated = TIP_RESTATES_STEP[item.id];
        if (restated) {
          expect(KEPT_WHEN_STEP_DONE).toContain(item.id);
          expect(open).not.toContain(restated);
        }
      });
    }
    expect(shown).toBeGreaterThan(10);
  });

  it('live-data tips still appear while the checklist is wide open', async () => {
    const conversation = {
      _id: 'c1',
      status: 'active',
      messageCount: 1,
      createdAt: new Date(hoursAgo(60)),
      updatedAt: new Date(hoursAgo(60)),
      participants: [
        { userId: 'user-1', role: 'supplier', unreadCount: 0 },
        { userId: 'cust-1', role: 'customer' },
      ],
    };
    const { res, open } = await tipsAndChecklist({
      supplier: completeSupplier({ ...NOTHING_SET_UP, category: 'Other', photosGallery: [] }),
      subscription: PRO,
      extra: {
        enquiries: [{ id: 'enq_1', supplierId: 'sup-1', createdAt: hoursAgo(3) }],
        conversations_v4: [conversation],
        chat_messages_v4: [
          { conversationId: 'c1', senderId: 'cust-1', createdAt: new Date(hoursAgo(60)) },
        ],
        reviews: [
          { id: 'r1', supplierId: 'sup-1', rating: 5, approved: true, approvedBy: 'system' },
        ],
        packages: [PACKAGE('p1', { approved: false })],
      },
    });

    expect(open.length).toBeGreaterThan(6);
    expect(res.body.total).toBe(5);
    // Five apply (the unanswered review and the packages awaiting approval too); the best three show.
    expect(ids(res)).toEqual(['new-enquiries', 'unanswered-conversations', 'choose-category']);
  });

  it('account problems with an admin note, a plan limit and a calendar gap are tips the checklist cannot give', async () => {
    const note = await tipsAndChecklist({
      supplier: completeSupplier({
        approved: false,
        verificationStatus: 'rejected',
        verificationNotes: 'Please add a phone number',
      }),
    });
    const limits = await tipsAndChecklist({
      supplier: completeSupplier({ photosGallery: TEN_PHOTOS }),
      extra: { packages: [PACKAGE('p1'), PACKAGE('p2'), PACKAGE('p3')] },
    });
    const gap = await tipsAndChecklist({
      supplier: completeSupplier({ publicCalendarPublisherOverride: true }),
      extra: { customer_calendar_entries: [PAST_ENTRY] },
    });

    expect(note.open).toContain('get-verified');
    expect(find(note.res, 'verification-rejected').body).toContain('Please add a phone number');
    expect(ids(limits.res).sort()).toEqual(['package-limit', 'photo-limit']);
    expect(gap.done).toContain('calendar');
    expect(ids(gap.res)).toEqual(['publish-event']);
  });

  it('the Tips card empty state is an empty list with a total of 0 (the dashboard hides the card)', async () => {
    const res = await tipsFor({
      extra: { packages: [PACKAGE('p1')], reviews: [] },
      subscription: PRO,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tips: [], total: 0 });
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
