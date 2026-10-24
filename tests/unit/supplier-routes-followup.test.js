'use strict';

/**
 * Supplier routes added in the dashboard follow-up: replying to a customer's enquiry
 * (POST /enquiries/:id/reply), the setup guide's saved progress (/guide-progress) and the category
 * check on verification submit. Runs the real routes and services over the in-memory database
 * double with a stand-in mailer.
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
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const mockSendMail = jest.fn();
jest.mock('../../utils/postmark', () => ({
  sendMail: (...args) => mockSendMail(...args),
  FROM_NOREPLY: 'EventFlow <noreply@example.com>',
}));

const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');
const { clearEngagementCache } = require('../../services/supplierEngagementMetrics');

const OWNER = { id: 'user-1', role: 'supplier' };
const OTHER_OWNER = { id: 'user-2', role: 'supplier' };

function reply(id, message, user = OWNER) {
  const router = require('../../routes/supplier');
  const app = express();
  app.use(express.json());
  app.use('/api/supplier', router);
  return request(app)
    .post(`/api/supplier/enquiries/${id}/reply`)
    .set('x-test-user', JSON.stringify(user))
    .send({ message });
}

function seed(overrides = {}) {
  return {
    users: [
      { id: 'user-1', email: 'owner@moor.example', verified: true },
      { id: 'user-2', email: 'owner@other.example', verified: true },
    ],
    suppliers: [
      { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true },
      { id: 'sup-2', ownerUserId: 'user-2', name: 'Other Catering', approved: true },
    ],
    quoteRequests: [
      {
        id: 'qr_1',
        name: 'Alice O&#x27;Brien',
        email: 'alice@example.com',
        notes: 'Need a DJ',
        suppliers: [{ supplierId: 'sup-1' }],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'qr_other',
        name: 'Bob',
        email: 'bob@example.com',
        notes: 'For the other supplier',
        suppliers: [{ supplierId: 'sup-2' }],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'qr_noemail',
        name: 'Nobody',
        notes: 'No address',
        suppliers: [{ supplierId: 'sup-1' }],
        createdAt: new Date().toISOString(),
      },
    ],
    enquiries: [],
    supplier_enquiry_states: [],
    supplier_enquiry_replies: [],
    ...overrides,
  };
}

beforeEach(() => {
  fakeDb.__reset(seed());
  clearEngagementCache();
  mockSendMail.mockReset();
  mockSendMail.mockResolvedValue({ MessageID: 'm1' });
});

describe('POST /enquiries/:id/reply', () => {
  it('emails the customer from EventFlow with the owner as Reply-To, stores it and marks handled', async () => {
    const res = await reply('qr_1', 'Hi Alice,\n\nWe are free on 12 June.\nBest, Moor');

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: 'alice@example.com',
      replyTo: 'owner@moor.example',
      from: 'EventFlow <noreply@example.com>',
      template: 'supplier-enquiry-reply',
      subject: 'Moor Audio replied to your enquiry',
    });
    // The template renderer escapes names itself; escaping here too would show "O&amp;#x27;Brien".
    expect(mail.templateData.customerName).toBe("Alice O'Brien");
    expect(mail.criticalDelivery).toBe(true);
    expect(mail.templateData.replyMessageHtml).toBe(
      '<p>Hi Alice,</p><p>We are free on 12 June.<br>Best, Moor</p>'
    );
    expect(res.body.enquiry.status).toBe('handled');
    expect(res.body.enquiry.replies).toHaveLength(1);
    expect(res.body.enquiry.replies[0].message).toContain('We are free on 12 June.');
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(1);
    expect(fakeDb.__store().supplier_enquiry_replies[0].status).toBe('sent');
  });

  it('shows the customer’s name once-escaped in the real email', () => {
    const { loadEmailTemplate } = jest.requireActual('../../utils/postmark');
    const html = loadEmailTemplate('supplier-enquiry-reply', {
      customerName: "Alice O'Brien",
      supplierName: 'Moor & Sons',
      replyMessageHtml: '<p>Hello</p>',
    });
    expect(html).toContain('Alice O&#039;Brien');
    expect(html).not.toContain('&amp;#');
    expect(html).toContain('Moor &amp; Sons');
  });

  it('does not send when the reply cannot be saved first', async () => {
    fakeDb.insertOne.mockResolvedValueOnce(null);
    const res = await reply('qr_1', 'Hello');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SEND_FAILED');
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(0);
  });

  it('once the email has gone, a failure to mark it handled is a warning, not "Failed to send"', async () => {
    fakeDb.upsertOne.mockResolvedValueOnce(false);

    const res = await reply('qr_1', 'Hello Alice');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(res.body.warning).toMatch(/reply was sent.*could not be marked as handled/i);
    // The enquiry keeps the state it had; "handled" was never stored.
    expect(res.body.enquiry.status).not.toBe('handled');
    expect(fakeDb.__store().supplier_enquiry_states).toHaveLength(0);
    expect(fakeDb.__store().supplier_enquiry_replies[0].status).toBe('sent');
  });

  it('a state write that throws after sending is also a warning, and the reply is not sent twice', async () => {
    fakeDb.upsertOne.mockRejectedValueOnce(new Error('mongo down'));

    const res = await reply('qr_1', 'Hello Alice');

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeTruthy();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('a normal reply carries no warning', async () => {
    const res = await reply('qr_1', 'Hello Alice');

    expect(res.body.warning).toBeUndefined();
  });

  it('gives the place back when the email fails, so the failed attempt does not count', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Postmark down'));
    expect((await reply('qr_1', 'Hello')).body.code).toBe('SEND_FAILED');
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(0);
  });

  it('never sends more than three replies to one enquiry when requests overlap', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => reply('qr_1', `Reply ${i}`))
    );
    expect(results.filter(res => res.status === 200).length).toBeLessThanOrEqual(3);
    expect(mockSendMail.mock.calls.length).toBeLessThanOrEqual(3);
    const stored = fakeDb.__store().supplier_enquiry_replies;
    expect(stored.filter(row => row.status === 'sent').length).toBe(mockSendMail.mock.calls.length);
  });

  it('escapes HTML typed into the reply', async () => {
    await reply('qr_1', '<script>alert(1)</script> & more');
    expect(mockSendMail.mock.calls[0][0].templateData.replyMessageHtml).toBe(
      '<p>&lt;script&gt;alert(1)&lt;&#x2F;script&gt; &amp; more</p>'
    );
  });

  it('shows the reply in the enquiry detail afterwards', async () => {
    await reply('qr_1', 'First reply');
    const router = require('../../routes/supplier');
    const app = express();
    app.use('/api/supplier', router);
    const detail = await request(app)
      .get('/api/supplier/enquiries/qr_1')
      .set('x-test-user', JSON.stringify(OWNER));
    expect(detail.body.enquiry.replies.map(r => r.message)).toEqual(['First reply']);
  });

  it('answers 404 for an enquiry that belongs to another supplier and sends nothing', async () => {
    const res = await reply('qr_other', 'Not mine');
    expect(res.status).toBe(404);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(0);
  });

  it.each([undefined, '', '   \n ', 42, ['a'], { a: 1 }])(
    'rejects the message %j',
    async message => {
      const res = await reply('qr_1', message);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EMPTY');
      expect(mockSendMail).not.toHaveBeenCalled();
    }
  );

  it('rejects a reply over 2000 characters', async () => {
    const res = await reply('qr_1', 'x'.repeat(2001));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_LONG');
  });

  it('says so when the customer left no email address', async () => {
    const res = await reply('qr_noemail', 'Hello');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('NO_EMAIL');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('refuses when the owner has not verified their email', async () => {
    fakeDb.__reset(
      seed({ users: [{ id: 'user-1', email: 'owner@moor.example', verified: false }] })
    );
    const res = await reply('qr_1', 'Hello');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('stores nothing and says so when the email cannot be sent', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('postmark down'));
    const res = await reply('qr_1', 'Hello');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SEND_FAILED');
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(0);
    expect(fakeDb.__store().supplier_enquiry_states).toHaveLength(0);
  });

  it('stops at three replies to one enquiry', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await reply('qr_1', `Reply ${i}`)).status).toBe(200);
    }
    const sixth = await reply('qr_1', 'One more');
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('ENQUIRY_LIMIT');
    expect(mockSendMail).toHaveBeenCalledTimes(3);
  });

  it('stops a supplier at ten replies an hour', async () => {
    const quotes = Array.from({ length: 11 }, (_, i) => ({
      id: `qr_bulk_${i}`,
      name: `C${i}`,
      email: `c${i}@example.com`,
      notes: 'hi',
      suppliers: [{ supplierId: 'sup-1' }],
      createdAt: new Date().toISOString(),
    }));
    fakeDb.__reset(seed({ quoteRequests: quotes }));
    for (let i = 0; i < 10; i += 1) {
      expect((await reply(`qr_bulk_${i}`, 'Hello')).status).toBe(200);
    }
    const over = await reply('qr_bulk_10', 'Hello');
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('HOURLY_LIMIT');
  });

  it('stops a supplier at thirty replies a day', async () => {
    const yesterdayish = new Date(Date.now() - 5 * 3600000).toISOString();
    const past = Array.from({ length: 30 }, (_, i) => ({
      id: `rep_old_${i}`,
      supplierId: 'sup-1',
      enquiryId: `qr_x${i}`,
      message: 'earlier',
      status: 'sent',
      sentAt: yesterdayish,
    }));
    fakeDb.__reset(seed({ supplier_enquiry_replies: past }));
    const res = await reply('qr_1', 'Hello');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('DAILY_LIMIT');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('stops counting a reply that was reserved but never finished', async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    fakeDb.__reset(
      seed({
        supplier_enquiry_replies: [
          {
            id: 'rep_a',
            supplierId: 'sup-1',
            enquiryId: 'qr_1',
            message: 'x',
            status: 'sending',
            sentAt: stale,
          },
          {
            id: 'rep_b',
            supplierId: 'sup-1',
            enquiryId: 'qr_1',
            message: 'x',
            status: 'sending',
            sentAt: stale,
          },
          {
            id: 'rep_c',
            supplierId: 'sup-1',
            enquiryId: 'qr_1',
            message: 'x',
            status: 'sending',
            sentAt: stale,
          },
        ],
      })
    );
    expect((await reply('qr_1', 'Hello')).status).toBe(200);

    // A reservation still being sent does count.
    fakeDb.__reset(
      seed({
        supplier_enquiry_replies: ['a', 'b', 'c'].map(n => ({
          id: `rep_${n}`,
          supplierId: 'sup-1',
          enquiryId: 'qr_1',
          message: 'x',
          status: 'sending',
          sentAt: fresh,
        })),
      })
    );
    expect((await reply('qr_1', 'Hello')).body.code).toBe('ENQUIRY_LIMIT');
  });

  it('will not reply to an enquiry more than thirty days old', async () => {
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    fakeDb.__reset(
      seed({
        quoteRequests: [
          {
            id: 'qr_old',
            name: 'Old',
            email: 'old@example.com',
            notes: 'ancient',
            suppliers: [{ supplierId: 'sup-1' }],
            createdAt: old,
          },
        ],
      })
    );
    const res = await reply('qr_old', 'Hello');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ENQUIRY_TOO_OLD');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('only lets suppliers use it', async () => {
    const res = await reply('qr_1', 'Hello', { id: 'user-9', role: 'customer' });
    expect(res.status).toBe(403);
  });

  it('does not let one supplier reply as another', async () => {
    const res = await reply('qr_1', 'Hello', OTHER_OWNER);
    expect(res.status).toBe(404);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('POST /verification/submit category', () => {
  function submit(body) {
    const router = require('../../routes/supplier');
    const app = express();
    app.use(express.json());
    app.use('/api/supplier', router);
    return request(app)
      .post('/api/supplier/verification/submit')
      .set('x-test-user', JSON.stringify(OWNER))
      .send(body);
  }

  it('refuses a category the site does not know (it is shown on public pages)', async () => {
    const res = await submit({
      name: 'Moor Audio',
      email: 'owner@moor.example',
      phone: '07123456789',
      location: 'Cardiff',
      category: '<img src=x onerror=alert(1)>',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid category');
    expect(res.body.validCategories).toContain('Catering');
  });
});

describe('/guide-progress (the setup guide, kept on the account)', () => {
  function call(method, body, user = OWNER) {
    const router = require('../../routes/supplier');
    const app = express();
    app.use(express.json());
    app.use('/api/supplier', router);
    const req = request(app)
      [method]('/api/supplier/guide-progress')
      .set('x-test-user', JSON.stringify(user));
    return body === undefined ? req : req.send(body);
  }

  it('is empty before the supplier starts', async () => {
    const res = await call('get');
    expect(res.status).toBe(200);
    expect(res.body.progress).toEqual({});
  });

  it('saves where they got to and returns it, to any device', async () => {
    const put = await call('put', { status: 'dismissed', step: 'package' });
    expect(put.status).toBe(200);
    expect(put.body.progress).toMatchObject({ status: 'dismissed', step: 'package' });

    const got = await call('get');
    expect(got.body.progress).toMatchObject({ status: 'dismissed', step: 'package' });
    expect(
      fakeDb.__store().users.find(u => u.id === 'user-1').onboarding.supplierGuide.status
    ).toBe('dismissed');
  });

  it('saves for an account that has no onboarding record yet', async () => {
    await call('put', { status: 'active', step: 'profile' });
    const user = fakeDb.__store().users.find(u => u.id === 'user-1');
    expect(user.onboarding.supplierGuide).toMatchObject({ status: 'active', step: 'profile' });
  });

  it('keeps other onboarding fields it does not own', async () => {
    fakeDb.__reset(
      seed({
        users: [
          { id: 'user-1', email: 'owner@moor.example', verified: true, onboarding: { other: 1 } },
        ],
      })
    );
    await call('put', { status: 'completed' });
    const user = fakeDb.__store().users.find(u => u.id === 'user-1');
    expect(user.onboarding.other).toBe(1);
    expect(user.onboarding.supplierGuide.status).toBe('completed');
  });

  it.each([
    [{ status: 'finished' }],
    [{ status: 'active', step: 'a b' }],
    [{ status: 'active', step: 'x'.repeat(41) }],
    [{ status: 'active', step: { $ne: 1 } }],
    [{}],
    [undefined],
  ])('refuses %j', async body => {
    const res = await call('put', body === undefined ? {} : body);
    expect(res.status).toBe(400);
  });

  it('is for suppliers only', async () => {
    expect((await call('get', undefined, { id: 'user-9', role: 'customer' })).status).toBe(403);
    expect(
      (await call('put', { status: 'active' }, { id: 'user-9', role: 'customer' })).status
    ).toBe(403);
  });
});
