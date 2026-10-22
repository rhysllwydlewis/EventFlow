'use strict';

/**
 * Supplier-facing enquiries: list, detail, read/handled state and CSV export.
 * Runs the real routes and services over the in-memory database double.
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
const logger = require('../../utils/logger');
const fakeDb = require('../helpers/fake-db-unified');
const { clearEngagementCache } = require('../../services/supplierEngagementMetrics');

/**
 * Write a real response to the front-end team's example folder when asked to.
 *
 * @param {string} name - File name
 * @param {string|Object} body - Response body
 * @returns {void}
 */
function dumpExample(name, body) {
  const dir = process.env.SUPPLIER_CONTRACT_DUMP_DIR;
  if (dir) {
    const text = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
    fs.writeFileSync(path.join(dir, name), text);
  }
}

const SUPPLIER_USER = { id: 'user-1', role: 'supplier' };
const OTHER_USER = { id: 'user-2', role: 'supplier' };
const NOW = new Date('2026-07-16T12:00:00.000Z');

/**
 * Send a request to the real supplier router as the given user.
 *
 * @param {string} method - HTTP method
 * @param {string} url - Path below /api/supplier
 * @param {Object} [user] - Authenticated user
 * @param {Object} [body] - JSON body
 * @returns {Promise<Object>} supertest response
 */
function call(method, url, user = SUPPLIER_USER, body) {
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/supplier', router);
  const req = request(app)[method](`/api/supplier${url}`).set('x-test-user', JSON.stringify(user));
  return body ? req.send(body) : req;
}

/**
 * ISO timestamp some hours before NOW.
 *
 * @param {number} hours - Hours ago
 * @returns {string} ISO string
 */
function hoursAgo(hours) {
  return new Date(NOW.getTime() - hours * 3600000).toISOString();
}

/**
 * The shared world: two suppliers, a mix of requests addressed to each.
 *
 * @returns {Object} Seed
 */
function seed() {
  return {
    users: [
      { id: 'user-1', verified: true },
      { id: 'user-2', verified: true },
    ],
    suppliers: [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true },
      { id: 'sup-2', ownerUserId: 'user-2', name: 'Other Catering', approved: true },
      { id: 'sup-3', ownerUserId: 'user-3', name: 'Pending Florals', approved: false },
    ],
    quoteRequests: [
      {
        id: 'qr_1',
        userId: 'cust-1',
        name: 'Alice O&#x27;Brien',
        email: 'alice@example.com',
        phone: '07123 456789',
        eventType: 'Wedding',
        eventDate: '2027-06-12T00:00:00.000Z',
        location: 'Cardiff',
        budget: '2000',
        notes: 'We need a DJ &amp; sound for 120 guests',
        suppliers: [{ supplierId: 'sup-1' }, { supplierId: 'sup-2' }],
        status: 'pending',
        createdAt: hoursAgo(5),
      },
      {
        id: 'qr_2',
        name: 'Bob',
        email: 'bob@example.com',
        notes: 'Only for the other supplier',
        suppliers: [{ supplierId: 'sup-2' }],
        createdAt: hoursAgo(6),
      },
      {
        id: 'qr_3',
        name: 'Old Request',
        email: 'old@example.com',
        notes: 'Years ago',
        suppliers: [{ supplierId: 'sup-1' }],
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ],
    enquiries: [
      {
        id: 'enq_1',
        supplierId: 'sup-1',
        senderName: 'Carol',
        senderEmail: 'carol@example.com',
        message: 'Do you cover Swansea?',
        status: 'pending',
        createdAt: hoursAgo(2),
      },
      {
        id: 'enq_2',
        supplierId: 'sup-2',
        senderName: 'Dave',
        senderEmail: 'dave@example.com',
        message: 'For the other supplier',
        createdAt: hoursAgo(3),
      },
    ],
    supplier_enquiry_states: [],
  };
}

beforeEach(() => {
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
  fakeDb.__reset(seed());
  clearEngagementCache();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('access control', () => {
  it.each([
    ['get', '/enquiries'],
    ['get', '/enquiries/qr_1'],
    ['get', '/enquiries/export'],
    ['patch', '/enquiries/qr_1'],
  ])('refuses a customer on %s %s', async (method, url) => {
    const res = await call(method, url, { id: 'cust-1', role: 'customer' }, { status: 'read' });

    expect(res.status).toBe(403);
  });

  it('refuses an unapproved supplier with SUPPLIER_NOT_APPROVED', async () => {
    const res = await call('get', '/enquiries', { id: 'user-3', role: 'supplier' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUPPLIER_NOT_APPROVED');
  });

  it('answers 404 for a supplier account with no profile', async () => {
    const res = await call('get', '/enquiries', { id: 'user-9', role: 'supplier' });

    expect(res.status).toBe(404);
  });

  it('a failed profile lookup is a 500, not a "no profile" 404', async () => {
    fakeDb.__failOn('suppliers');

    const res = await call('get', '/enquiries');

    expect(res.status).toBe(500);
  });

  it('takes the supplier from the session, never from the request', async () => {
    const res = await call('get', '/enquiries?supplierId=sup-2&ownerUserId=user-2');

    expect(res.body.enquiries.map(item => item.id)).not.toContain('enq_2');
    expect(res.body.enquiries.map(item => item.id)).not.toContain('qr_2');
  });
});

describe('GET /enquiries', () => {
  it('lists only this supplier records from both sources, newest first', async () => {
    const res = await call('get', '/enquiries');

    dumpExample('enquiries-list.json', res.body);
    expect(res.status).toBe(200);
    expect(res.body.enquiries.map(item => item.id)).toEqual(['enq_1', 'qr_1']);
    expect(res.body.enquiries.map(item => item.source)).toEqual(['contact_form', 'quote_request']);
  });

  it('returns card fields only: no email, phone or full message in the list', async () => {
    const res = await call('get', '/enquiries');
    const item = res.body.enquiries.find(entry => entry.id === 'qr_1');

    expect(Object.keys(item).sort()).toEqual(
      [
        'createdAt',
        'customerName',
        'eventDate',
        'eventType',
        'id',
        'preview',
        'quality',
        'source',
        'status',
      ].sort()
    );
    expect(JSON.stringify(res.body)).not.toContain('alice@example.com');
    expect(JSON.stringify(res.body)).not.toContain('07123');
  });

  it('returns stored text as plain text (not HTML-escaped)', async () => {
    const res = await call('get', '/enquiries');
    const item = res.body.enquiries.find(entry => entry.id === 'qr_1');

    expect(item.customerName).toBe("Alice O'Brien");
    expect(item.preview).toBe('We need a DJ & sound for 120 guests');
  });

  it('applies the window in whole UTC days and counts the window, not the filter', async () => {
    const wide = await call('get', '/enquiries?days=365');
    const narrow = await call('get', '/enquiries?days=1');

    expect(wide.body.window).toEqual({ days: 365 });
    expect(wide.body.counts.total).toBe(2);
    expect(narrow.body.counts.total).toBe(2);
    // qr_3 is from 2025: outside even 365 days.
    expect(wide.body.enquiries.map(item => item.id)).not.toContain('qr_3');
  });

  it('counts per source and new items', async () => {
    const res = await call('get', '/enquiries');

    expect(res.body.counts).toEqual({
      total: 2,
      new: 2,
      bySource: { quoteRequests: 1, contactForm: 1 },
      byQuality: { High: 1, Medium: 0, Low: 1 },
    });
  });

  it('filters by quality, and the detail says why an enquiry was rated as it was', async () => {
    const low = await call('get', '/enquiries?quality=Low');
    expect(low.body.enquiries.map(item => item.id)).toEqual(['enq_1']);
    const detail = await call('get', '/enquiries/enq_1');
    expect(detail.body.enquiry.quality.rating).toBe('Low');
    expect(detail.body.enquiry.quality.reasons).toEqual(
      expect.arrayContaining(['No event date was given'])
    );
    const ignored = await call('get', '/enquiries?quality=Excellent');
    expect(ignored.body.enquiries).toHaveLength(2);
  });

  it('filters by source and status and paginates, capping the page size at 100', async () => {
    const quotes = await call('get', '/enquiries?source=quote_request');
    expect(quotes.body.enquiries.map(item => item.id)).toEqual(['qr_1']);
    expect(quotes.body.pagination.total).toBe(1);

    const paged = await call('get', '/enquiries?limit=1&page=2');
    expect(paged.body.enquiries.map(item => item.id)).toEqual(['qr_1']);
    expect(paged.body.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });

    const huge = await call('get', '/enquiries?limit=100000');
    expect(huge.body.pagination.limit).toBe(100);

    const junk = await call('get', '/enquiries?limit=abc&page=-4&days=x&status=zzz&source=nope');
    expect(junk.status).toBe(200);
    expect(junk.body.pagination).toMatchObject({ page: 1, limit: 20 });
    expect(junk.body.window.days).toBe(90);
  });

  it('is empty, not an error, for a supplier with no enquiries', async () => {
    fakeDb.__reset({
      ...seed(),
      quoteRequests: [],
      enquiries: [],
    });

    const res = await call('get', '/enquiries');

    expect(res.status).toBe(200);
    expect(res.body.enquiries).toEqual([]);
    expect(res.body.counts.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  it('asks the database for this supplier only (no platform-wide quote request read)', async () => {
    fakeDb.aggregate.mockClear();
    fakeDb.find.mockClear();

    await call('get', '/enquiries');

    const quoteCall = fakeDb.aggregate.mock.calls.find(item => item[0] === 'quoteRequests');
    expect(quoteCall[1][0].$match['suppliers.supplierId']).toBe('sup-1');
    expect(fakeDb.find.mock.calls.filter(item => item[0] === 'quoteRequests')).toHaveLength(0);
  });

  it('answers a failing source with a 500, never with an empty list', async () => {
    fakeDb.__failOn('enquiries');

    const res = await call('get', '/enquiries');

    expect(res.status).toBe(500);
  });
});

describe('GET /enquiries/:id', () => {
  it('returns the full record with the contact details the customer submitted', async () => {
    const res = await call('get', '/enquiries/qr_1');

    dumpExample('enquiry-detail.json', res.body);
    expect(res.status).toBe(200);
    expect(res.body.enquiry).toEqual({
      id: 'qr_1',
      source: 'quote_request',
      createdAt: hoursAgo(5),
      customerName: "Alice O'Brien",
      email: 'alice@example.com',
      phone: '07123 456789',
      message: 'We need a DJ & sound for 120 guests',
      eventType: 'Wedding',
      eventDate: '2027-06-12T00:00:00.000Z',
      location: 'Cardiff',
      budget: '2000',
      status: 'new',
      replies: [],
      quality: { rating: 'High', score: 79, reasons: [] },
    });
  });

  it('returns a contact-form enquiry in the same shape', async () => {
    const res = await call('get', '/enquiries/enq_1');

    expect(res.body.enquiry).toMatchObject({
      id: 'enq_1',
      source: 'contact_form',
      customerName: 'Carol',
      email: 'carol@example.com',
      phone: null,
      message: 'Do you cover Swansea?',
      eventType: null,
    });
  });

  it('never reveals another supplier record: the answer is the same as for a missing one', async () => {
    const other = await call('get', '/enquiries/qr_2');
    const otherContact = await call('get', '/enquiries/enq_2');
    const missing = await call('get', '/enquiries/qr_nope');

    expect(other.status).toBe(404);
    expect(otherContact.status).toBe(404);
    expect(other.body).toEqual(missing.body);
    expect(JSON.stringify(other.body)).not.toContain('bob@example.com');
  });

  it.each(['abc', 'qr_%24ne', '..%2F..%2Fetc', 'x'.repeat(300), '%7B%22%24ne%22%3Anull%7D'])(
    'treats the odd id %s as not found',
    async id => {
      const res = await call('get', `/enquiries/${id}`);

      expect(res.status).toBe(404);
    }
  );

  it('does not let the other supplier read it either way round', async () => {
    const res = await call('get', '/enquiries/qr_1', OTHER_USER);

    // sup-2 is also named on qr_1, so it IS theirs; but enq_1 is not.
    expect(res.status).toBe(200);
    const notTheirs = await call('get', '/enquiries/enq_1', OTHER_USER);
    expect(notTheirs.status).toBe(404);
  });
});

describe('PATCH /enquiries/:id', () => {
  it('marks an enquiry read and handled, and the list and counts follow', async () => {
    const read = await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status: 'read' });
    dumpExample('enquiry-mark-read.json', read.body);
    expect(read.status).toBe(200);
    expect(read.body.enquiry.status).toBe('read');

    await call('patch', '/enquiries/enq_1', SUPPLIER_USER, { status: 'handled' });
    const list = await call('get', '/enquiries');
    expect(list.body.enquiries.map(item => `${item.id}:${item.status}`)).toEqual([
      'enq_1:handled',
      'qr_1:read',
    ]);
    expect(list.body.counts.new).toBe(0);

    const onlyNew = await call('get', '/enquiries?status=new');
    expect(onlyNew.body.enquiries).toEqual([]);

    const back = await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status: 'new' });
    expect(back.body.enquiry.status).toBe('new');
    expect(fakeDb.__store().supplier_enquiry_states).toHaveLength(2);
  });

  it.each([undefined, '', 'done', 'READ', 7, null, ['read']])(
    'rejects the status %j with a 400',
    async status => {
      const res = await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status });

      expect(res.status).toBe(400);
      expect(fakeDb.__store().supplier_enquiry_states).toHaveLength(0);
    }
  );

  it('cannot touch another supplier record, and writes nothing', async () => {
    const res = await call('patch', '/enquiries/enq_2', SUPPLIER_USER, { status: 'handled' });

    expect(res.status).toBe(404);
    expect(fakeDb.__store().supplier_enquiry_states).toHaveLength(0);
  });

  it('keeps each supplier state separate for a request sent to both', async () => {
    await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status: 'handled' });

    const mine = await call('get', '/enquiries/qr_1');
    const theirs = await call('get', '/enquiries/qr_1', OTHER_USER);

    expect(mine.body.enquiry.status).toBe('handled');
    expect(theirs.body.enquiry.status).toBe('new');
  });
});

describe('dashboard summary stays consistent with the list', () => {
  /**
   * Fetch the dashboard summary.
   *
   * @param {Object} [user] - Authenticated user
   * @param {string} [query] - Query string
   * @returns {Promise<Object>} supertest response
   */
  function summary(user = SUPPLIER_USER, query = '?days=90') {
    return call('get', `/dashboard-summary${query}`, user);
  }

  it('reports the same received and new counts as the list for the same window', async () => {
    fakeDb.__store().subscriptions = [
      {
        id: 's',
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: 'x',
        currentPeriodEnd: '2999-01-01T00:00:00.000Z',
      },
    ];
    const list = await call('get', '/enquiries?days=90');
    const before = await summary();

    expect(before.body.enquiries.requests).toEqual({
      received: list.body.counts.total,
      new: list.body.counts.new,
    });

    await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status: 'read' });
    const after = await summary();
    const listAfter = await call('get', '/enquiries?days=90');

    expect(after.body.enquiries.requests).toEqual({ received: 2, new: 1 });
    expect(listAfter.body.counts.new).toBe(1);
  });

  it('is null (unknown) when the requests cannot be read', async () => {
    fakeDb.__failOn('supplier_enquiry_states');

    const res = await summary();

    expect(res.body.unavailable).toContain('enquiries');
    expect(res.body.enquiries.requests).toEqual({ received: null, new: null });
  });
});

describe('privacy', () => {
  it('never logs customer details', async () => {
    fakeDb.__failOn('enquiries');
    await call('get', '/enquiries');
    await call('get', '/enquiries/qr_1');
    await call('patch', '/enquiries/qr_1', SUPPLIER_USER, { status: 'read' });
    await call('get', '/enquiries/export');

    const logged = JSON.stringify(
      ['info', 'warn', 'error', 'debug'].flatMap(level => logger[level].mock.calls)
    );
    expect(logged).not.toContain('alice@example.com');
    expect(logged).not.toContain('07123');
    expect(logged).not.toContain('carol@example.com');
  });
});

describe('GET /enquiries/export', () => {
  /**
   * Add messenger conversations for the export tests.
   *
   * @returns {void}
   */
  function addConversations() {
    const store = fakeDb.__store();
    store.users.push({ id: 'cust-9', firstName: 'Erin', lastName: 'Customer', verified: true });
    store.conversations_v4 = [
      {
        _id: 'c1',
        status: 'active',
        messageCount: 3,
        createdAt: new Date(hoursAgo(30)),
        updatedAt: new Date(hoursAgo(1)),
        participants: [
          { userId: 'user-1', role: 'supplier', unreadCount: 2 },
          { userId: 'cust-9', role: 'customer', displayName: 'stale name' },
        ],
        lastMessage: { content: '=HYPERLINK("http://evil.example","x")' },
      },
      {
        _id: 'c2',
        status: 'closed',
        messageCount: 1,
        createdAt: new Date(hoursAgo(50)),
        updatedAt: new Date(hoursAgo(49)),
        participants: [
          { userId: 'user-1', role: 'supplier', unreadCount: 0 },
          { userId: 'user-77', role: 'supplier', displayName: 'Supplier friend' },
        ],
        lastMessage: { content: 'networking chat' },
      },
      {
        _id: 'c3',
        status: 'active',
        messageCount: 1,
        createdAt: new Date(hoursAgo(10)),
        updatedAt: new Date(hoursAgo(9)),
        participants: [
          { userId: 'user-2', role: 'supplier', unreadCount: 0 },
          { userId: 'cust-5', role: 'customer', displayName: 'Other supplier customer' },
        ],
        lastMessage: { content: 'belongs to supplier 2' },
      },
    ];
  }

  it('is a 200 with the header row only, a zero count and an honest filename when empty', async () => {
    fakeDb.__reset({ ...seed(), quoteRequests: [], enquiries: [] });

    const res = await call('get', '/enquiries/export');

    dumpExample('enquiries-export-empty.csv', res.text);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['x-export-row-count']).toBe('0');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="enquiries-and-conversations-2026-07-16.csv"'
    );
    const lines = res.text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      '"Date","Type","Customer","Email","Phone","Event type","Event date","Location","Budget","Status","Message (preview)","Unread messages"'
    );
  });

  it('exports this supplier conversations with customers, quote requests and contact enquiries', async () => {
    addConversations();

    const res = await call('get', '/enquiries/export');

    dumpExample('enquiries-export.csv', res.text);
    // Carol, Alice, Erin's conversation and the 2025 quote request (the export is the full history).
    expect(res.headers['x-export-row-count']).toBe('4');
    const body = res.text;
    expect(body).toContain('"Conversation","Erin Customer"');
    expect(body).toContain(
      '"Quote request","Alice O\'Brien","alice@example.com","07123 456789","Wedding","2027-06-12","Cardiff","2000","New"'
    );
    expect(body).toContain('"Contact form","Carol","carol@example.com"');
    expect(body).toContain('"Open"');
  });

  it('leaves out supplier-to-supplier chats and everything that belongs to another supplier', async () => {
    addConversations();

    const res = await call('get', '/enquiries/export');

    expect(res.text).not.toContain('Supplier friend');
    expect(res.text).not.toContain('networking chat');
    expect(res.text).not.toContain('belongs to supplier 2');
    expect(res.text).not.toContain('Other supplier customer');
    expect(res.text).not.toContain('bob@example.com');
    expect(res.text).not.toContain('dave@example.com');
  });

  it('never exports a customer email or phone for a messenger conversation', async () => {
    addConversations();
    fakeDb.__store().users.find(user => user.id === 'cust-9').email = 'erin-private@example.com';

    const res = await call('get', '/enquiries/export');

    expect(res.text).not.toContain('erin-private@example.com');
  });

  it('neutralises formula-injection cells and escapes quotes, commas and newlines', async () => {
    addConversations();
    const store = fakeDb.__store();
    store.enquiries.push({
      id: 'enq_9',
      supplierId: 'sup-1',
      senderName: "=cmd|' /C calc'!A0",
      senderEmail: '@evil@example.com',
      message: 'line one,\nline "two"\r\n+SUM(1)',
      createdAt: hoursAgo(1),
    });
    store.enquiries.push({
      id: 'enq_8',
      supplierId: 'sup-1',
      senderName: '\t-1+1',
      senderEmail: 'x@example.com',
      message: '\r=1+1',
      createdAt: hoursAgo(1),
    });

    const res = await call('get', '/enquiries/export');
    const csv = res.text;

    // The conversation preview "=HYPERLINK(...)" and the name "=cmd|..." are prefixed with an apostrophe.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.example"",""x"")"');
    expect(csv).toContain("\"'=cmd|' /C calc'!A0\"");
    expect(csv).toContain('"\'@evil@example.com"');
    // Surrounding whitespace is trimmed from stored text, then the formula is neutralised.
    expect(csv).toContain('"\'-1+1"');
    // Embedded quotes are doubled and newlines survive inside the quoted cell.
    expect(csv).toContain('"line one,\nline ""two""\n+SUM(1)"');
  });

  it('only exports the signed-in supplier data', async () => {
    addConversations();

    const other = await call('get', '/enquiries/export', OTHER_USER);

    expect(other.text).toContain('Dave');
    expect(other.text).not.toContain('Erin Customer');
    expect(other.text).not.toContain('Carol');
  });

  it('asks the database for errors, so an outage is a 500 and not an empty file', async () => {
    addConversations();
    fakeDb.__failOn('conversations_v4');

    const res = await call('get', '/enquiries/export');

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('Type');
  });

  it('is not shadowed by the :id route', async () => {
    const res = await call('get', '/enquiries/export');

    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });
});
