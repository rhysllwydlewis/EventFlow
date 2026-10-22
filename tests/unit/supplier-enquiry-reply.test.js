'use strict';

/**
 * Replying to a customer's enquiry from the supplier dashboard (POST /enquiries/:id/reply).
 * Runs the real route and service over the in-memory database double with a stand-in mailer.
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
    expect(mail.templateData.customerName).toBe('Alice O&#x27;Brien');
    expect(mail.templateData.replyMessageHtml).toBe(
      '<p>Hi Alice,</p><p>We are free on 12 June.<br>Best, Moor</p>'
    );
    expect(res.body.enquiry.status).toBe('handled');
    expect(res.body.enquiry.replies).toHaveLength(1);
    expect(res.body.enquiry.replies[0].message).toContain('We are free on 12 June.');
    expect(fakeDb.__store().supplier_enquiry_replies).toHaveLength(1);
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
      sentAt: yesterdayish,
    }));
    fakeDb.__reset(seed({ supplier_enquiry_replies: past }));
    const res = await reply('qr_1', 'Hello');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('DAILY_LIMIT');
    expect(mockSendMail).not.toHaveBeenCalled();
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
