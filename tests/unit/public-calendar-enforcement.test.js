'use strict';

/**
 * Public calendar publishing is a privilege (Event Planner and Wedding Fayre
 * suppliers by default, plus an admin override per supplier). These tests pin that
 * it is enforced SERVER-SIDE on every write path, and that a supplier's private
 * calendar is a separate feature that does not depend on it.
 */

const JWT_SECRET = 'test-secret-for-jest-min-32-characters-long'; // pragma: allowlist secret
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

jest.mock('../../middleware/rateLimits', () => ({
  searchLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');

const USERS = {
  planner: { id: 'u-planner', role: 'supplier', verified: true, email: 'p@example.com' },
  photographer: { id: 'u-photo', role: 'supplier', verified: true, email: 'ph@example.com' },
  disabledPlanner: { id: 'u-disabled', role: 'supplier', verified: true, email: 'd@example.com' },
  grantedPhotographer: {
    id: 'u-granted',
    role: 'supplier',
    verified: true,
    email: 'g@example.com',
  },
  unapprovedPlanner: {
    id: 'u-unapproved',
    role: 'supplier',
    verified: true,
    email: 'u@example.com',
  },
  unverifiedPlanner: {
    id: 'u-unverified',
    role: 'supplier',
    verified: false,
    email: 'v@example.com',
  },
  customer: { id: 'u-customer', role: 'customer', verified: true, email: 'c@example.com' },
  admin: { id: 'u-admin', role: 'admin', verified: true, email: 'a@example.com' },
};

const SUPPLIERS = [
  {
    id: 's-planner',
    ownerUserId: 'u-planner',
    category: 'Event Planner',
    name: 'Planner',
    approved: true,
    adminNotes: 'secret admin note',
    email: 'biz@example.com',
  },
  { id: 's-photo', ownerUserId: 'u-photo', category: 'Photography', name: 'Photo', approved: true },
  {
    id: 's-disabled',
    ownerUserId: 'u-disabled',
    category: 'Wedding Fayre',
    name: 'Disabled',
    approved: true,
    publicCalendarPublisherOverride: false,
  },
  {
    id: 's-granted',
    ownerUserId: 'u-granted',
    category: 'Photography',
    name: 'Granted',
    approved: true,
    publicCalendarPublisherOverride: true,
  },
  {
    id: 's-unapproved',
    ownerUserId: 'u-unapproved',
    category: 'Event Planner',
    name: 'Unapproved',
    approved: false,
  },
  {
    id: 's-unverified',
    ownerUserId: 'u-unverified',
    category: 'Event Planner',
    name: 'Unverified',
    approved: true,
  },
];

const OWN_EVENT = {
  id: 'pce_own',
  title: 'Autumn Fayre',
  startDate: '2027-03-01T10:00:00.000Z',
  createdByUserId: 'u-planner',
  status: 'pending_review',
};

/**
 * Cookie header for a user.
 *
 * @param {Object} user - One of USERS
 * @returns {string} Cookie header value
 */
function cookieFor(user) {
  return `token=${jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET)}`;
}

/**
 * Build an app with the public calendar and the private calendar routers mounted.
 *
 * @returns {Object} Express app
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/public-calendar', require('../../routes/public-calendar'));
  app.use('/api/me/calendar-entries', require('../../routes/customer-calendar'));
  return app;
}

/**
 * Send a request as a user.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Path
 * @param {Object} user - One of USERS
 * @param {Object} [body] - JSON body
 * @returns {Promise<Object>} supertest response
 */
function send(method, url, user, body) {
  const req = request(buildApp())[method](url).set('Cookie', cookieFor(user));
  return body ? req.send(body) : req;
}

const NEW_EVENT = {
  title: 'Open day',
  startDate: '2027-05-01T10:00:00.000Z',
  endDate: '2027-05-01T16:00:00.000Z',
  location: 'Cardiff',
  description: 'Come and see us',
  category: 'Showcase',
};

/**
 * Switch the "require admin approval" setting.
 *
 * @param {boolean} required - Whether approval is required
 * @returns {void}
 */
function setApprovalRequired(required) {
  const original = fakeDb.read.getMockImplementation();
  fakeDb.read.mockImplementation(async name =>
    name === 'settings' ? { features: { requirePublicCalendarApproval: required } } : original(name)
  );
}

beforeEach(() => {
  fakeDb.__reset({
    users: Object.values(USERS),
    suppliers: SUPPLIERS,
    public_calendar_events: [OWN_EVENT],
    public_calendar_publisher_requests: [],
    customer_calendar_entries: [],
  });
});

describe('every publish path checks the category rule on the server', () => {
  const NOT_AVAILABLE = 'PUBLIC_CALENDAR_PUBLISHING_NOT_AVAILABLE';

  it.each([
    ['post', '/api/public-calendar/events', NEW_EVENT],
    ['put', '/api/public-calendar/events/pce_own', { title: 'Renamed' }],
    ['delete', '/api/public-calendar/events/pce_own', undefined],
  ])('refuses a non-publisher supplier on %s %s', async (method, url, body) => {
    const res = await send(method, url, USERS.photographer, body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(NOT_AVAILABLE);
    expect(res.body.scope).toBe('public_calendar');
    expect(res.body.message).toBe(
      "Public calendar publishing isn't available for your supplier type. Your private calendar is not affected."
    );
  });

  it('does not let a non-publisher create, change or remove anything', async () => {
    await send('post', '/api/public-calendar/events', USERS.photographer, NEW_EVENT);
    await send('put', '/api/public-calendar/events/pce_own', USERS.photographer, { title: 'x' });
    await send('delete', '/api/public-calendar/events/pce_own', USERS.photographer);

    const events = fakeDb.__store().public_calendar_events;
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Autumn Fayre');
  });

  it('an admin override of false blocks even a default-eligible category, with its own message', async () => {
    const res = await send('post', '/api/public-calendar/events', USERS.disabledPlanner, NEW_EVENT);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(NOT_AVAILABLE);
    expect(res.body.message).toMatch(/disabled for this supplier account by an administrator/);
  });

  it('an admin override of true lets another category publish', async () => {
    const res = await send(
      'post',
      '/api/public-calendar/events',
      USERS.grantedPhotographer,
      NEW_EVENT
    );

    expect(res.status).toBe(201);
    expect(res.body.event.createdByUserId).toBe('u-granted');
  });

  it('a default-eligible category can publish', async () => {
    const res = await send('post', '/api/public-calendar/events', USERS.planner, NEW_EVENT);

    expect(res.status).toBe(201);
  });

  it.each([
    ['post', '/api/public-calendar/events', NEW_EVENT],
    ['put', '/api/public-calendar/events/pce_own', { title: 'x' }],
    ['delete', '/api/public-calendar/events/pce_own', undefined],
    ['post', '/api/public-calendar/publisher-request', { reason: 'We run fayres' }],
  ])('needs an approved supplier on %s %s', async (method, url, body) => {
    const res = await send(method, url, USERS.unapprovedPlanner, body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
  });

  it.each([
    ['post', '/api/public-calendar/events', NEW_EVENT],
    ['put', '/api/public-calendar/events/pce_own', { title: 'x' }],
    ['delete', '/api/public-calendar/events/pce_own', undefined],
    ['post', '/api/public-calendar/publisher-request', { reason: 'We run fayres' }],
  ])('needs a verified email on %s %s', async (method, url, body) => {
    const res = await send(method, url, USERS.unverifiedPlanner, body);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it.each([
    ['post', '/api/public-calendar/events', NEW_EVENT],
    ['put', '/api/public-calendar/events/pce_own', { title: 'x' }],
    ['delete', '/api/public-calendar/events/pce_own', undefined],
  ])('refuses a customer on %s %s', async (method, url, body) => {
    const res = await send(method, url, USERS.customer, body);

    expect(res.status).toBe(403);
  });

  it('a publisher cannot edit or delete another supplier events', async () => {
    fakeDb.__store().public_calendar_events.push({
      ...OWN_EVENT,
      id: 'pce_other',
      createdByUserId: 'u-granted',
    });

    const put = await send('put', '/api/public-calendar/events/pce_other', USERS.planner, {
      title: 'Hijacked',
    });
    const del = await send('delete', '/api/public-calendar/events/pce_other', USERS.planner);

    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
    expect(fakeDb.__store().public_calendar_events.find(e => e.id === 'pce_other').title).toBe(
      'Autumn Fayre'
    );
  });
});

describe('publishing cannot bypass admin approval by editing', () => {
  it('queues a new event for review when approval is required', async () => {
    setApprovalRequired(true);

    const res = await send('post', '/api/public-calendar/events', USERS.planner, NEW_EVENT);

    expect(res.status).toBe(201);
    expect(res.body.event.status).toBe('pending_review');
  });

  it('refuses to flip a pending event to published when approval is required', async () => {
    setApprovalRequired(true);

    const res = await send('put', '/api/public-calendar/events/pce_own', USERS.planner, {
      status: 'published',
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PUBLIC_CALENDAR_APPROVAL_REQUIRED');
    expect(fakeDb.__store().public_calendar_events[0].status).toBe('pending_review');
  });

  it('refuses the same via draft then published', async () => {
    setApprovalRequired(true);
    fakeDb.__store().public_calendar_events[0].status = 'draft';

    const res = await send('put', '/api/public-calendar/events/pce_own', USERS.planner, {
      status: 'published',
    });

    expect(res.status).toBe(403);
  });

  it('lets the supplier edit an already published event without re-approval', async () => {
    setApprovalRequired(true);
    fakeDb.__store().public_calendar_events[0].status = 'published';

    const res = await send('put', '/api/public-calendar/events/pce_own', USERS.planner, {
      status: 'published',
      title: 'Autumn Fayre 2',
    });

    expect(res.status).toBe(200);
  });

  it('lets the supplier publish directly when approval is not required', async () => {
    setApprovalRequired(false);

    const res = await send('put', '/api/public-calendar/events/pce_own', USERS.planner, {
      status: 'published',
    });

    expect(res.status).toBe(200);
    expect(res.body.event.status).toBe('published');
  });

  it('lets an admin publish whatever the setting', async () => {
    setApprovalRequired(true);

    const res = await send('put', '/api/public-calendar/events/pce_own', USERS.admin, {
      status: 'published',
    });

    expect(res.status).toBe(200);
  });
});

describe('publisher access request', () => {
  it('does not return the supplier document (admin notes, contact email)', async () => {
    const res = await send('get', '/api/public-calendar/publisher-request', USERS.planner);

    expect(res.status).toBe(200);
    expect(res.body.supplier).toEqual({
      id: 's-planner',
      name: 'Planner',
      category: 'Event Planner',
      publicCalendarPublisherOverride: null,
    });
    expect(JSON.stringify(res.body)).not.toContain('secret admin note');
    expect(JSON.stringify(res.body)).not.toContain('biz@example.com');
    expect(res.body.canPublish).toBe(true);
  });

  it('reports canPublish false for a non-publisher and true after an override', async () => {
    const before = await send('get', '/api/public-calendar/publisher-request', USERS.photographer);
    const granted = await send(
      'get',
      '/api/public-calendar/publisher-request',
      USERS.grantedPhotographer
    );

    expect(before.body.canPublish).toBe(false);
    expect(granted.body.canPublish).toBe(true);
    expect(granted.body.supplier.publicCalendarPublisherOverride).toBe(true);
  });

  it('lets an approved non-publisher request access, and only an admin can grant it', async () => {
    const created = await send(
      'post',
      '/api/public-calendar/publisher-request',
      USERS.photographer,
      {
        reason: 'We host open days',
      }
    );
    expect(created.status).toBe(201);

    const selfApprove = await send(
      'post',
      `/api/public-calendar/publisher-requests/${created.body.request.id}/approve`,
      USERS.photographer,
      {}
    );
    expect(selfApprove.status).toBe(403);

    const approved = await send(
      'post',
      `/api/public-calendar/publisher-requests/${created.body.request.id}/approve`,
      USERS.admin,
      {}
    );
    expect(approved.status).toBe(200);
    expect(
      fakeDb.__store().suppliers.find(supplier => supplier.id === 's-photo')
        .publicCalendarPublisherOverride
    ).toBe(true);
  });

  it('refuses a customer and an existing publisher', async () => {
    const customer = await send('post', '/api/public-calendar/publisher-request', USERS.customer, {
      reason: 'x',
    });
    const publisher = await send('post', '/api/public-calendar/publisher-request', USERS.planner, {
      reason: 'x',
    });

    expect(customer.status).toBe(403);
    expect(publisher.status).toBe(400);
  });
});

describe('the private calendar is separate and always available', () => {
  const ENTRY = { title: 'Venue visit', type: 'appointment', date: '2027-06-15', time: '14:00' };

  it.each([
    ['photographer (not a publisher)', USERS.photographer],
    ['publisher-disabled planner', USERS.disabledPlanner],
    ['planner', USERS.planner],
  ])('lets the %s create, list and delete private entries', async (_label, user) => {
    const created = await send('post', '/api/me/calendar-entries', user, ENTRY);
    expect(created.status).toBe(201);

    const list = await send('get', '/api/me/calendar-entries', user);
    expect(list.body.entries).toHaveLength(1);

    const removed = await send('delete', `/api/me/calendar-entries/${created.body.entry.id}`, user);
    expect(removed.status).toBe(200);
  });

  it('does not make private entries public', async () => {
    await send('post', '/api/me/calendar-entries', USERS.photographer, ENTRY);

    const publicList = await request(buildApp()).get('/api/public-calendar/events');

    expect(JSON.stringify(publicList.body)).not.toContain('Venue visit');
  });

  it('needs a verified email, as for every account', async () => {
    const res = await send('post', '/api/me/calendar-entries', USERS.unverifiedPlanner, ENTRY);

    expect(res.status).toBe(403);
  });
});

describe('database failures are not read as "allowed" or "no profile"', () => {
  it('queues a new event for review when the approval setting cannot be read (fails closed)', async () => {
    const original = fakeDb.read.getMockImplementation();
    fakeDb.read.mockImplementation(async (name, options) => {
      if (name === 'settings') {
        expect(options).toEqual({ throwOnError: true });
        throw new Error('settings unreadable');
      }
      return original(name);
    });

    const res = await send('post', '/api/public-calendar/events', USERS.planner, NEW_EVENT);

    expect(res.status).toBe(201);
    expect(res.body.event.status).toBe('pending_review');
    fakeDb.read.mockImplementation(original);
  });

  it('answers 500, not "No supplier profile found", when the supplier lookup fails', async () => {
    fakeDb.__failOn('suppliers');

    const res = await send('get', '/api/public-calendar/publisher-request', USERS.planner);
    fakeDb.__failOn();

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('No supplier profile');
  });
});
