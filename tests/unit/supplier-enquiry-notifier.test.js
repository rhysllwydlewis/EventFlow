'use strict';

/**
 * A supplier is told when a customer contacts them: a bell notification every time, and one email
 * to the verified owner at most once every 15 minutes.
 */

const request = require('supertest');
const express = require('express');

const mockNotificationCreate = jest.fn(async data => data);
jest.mock('../../services/notification.service', () =>
  jest.fn().mockImplementation(() => ({ create: mockNotificationCreate }))
);
jest.mock('../../db', () => ({ getDb: jest.fn(async () => ({})) }));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  notifySupplierOfEnquiry,
  emailIsDue,
  plainText,
  EMAIL_INTERVAL_MS,
} = require('../../services/supplierEnquiryNotifier');

const NOW = new Date('2026-10-21T12:00:00.000Z');

function makeDb({ supplier, owner } = {}) {
  const suppliers = {
    'sup-1': supplier === undefined ? { id: 'sup-1', ownerUserId: 'user-1' } : supplier,
  };
  const users = {
    'user-1':
      owner === undefined ? { id: 'user-1', email: 'owner@example.com', verified: true } : owner,
  };
  return {
    findOne: jest.fn(
      async (collection, query) =>
        (collection === 'suppliers' ? suppliers : users)[query.id] || null
    ),
    updateOne: jest.fn(async (collection, query, update) => {
      Object.assign(suppliers[query.id], update.$set);
      return true;
    }),
    suppliers,
  };
}

const enquiry = {
  supplierId: 'sup-1',
  kind: 'contact',
  senderName: 'Alice &amp; Bob',
  message: 'Are you free on 12 June? &lt;script&gt;alert(1)&lt;/script&gt;',
};

beforeEach(() => {
  mockNotificationCreate.mockClear();
});

describe('notifySupplierOfEnquiry', () => {
  it('puts a notification in the bell and emails the verified owner', async () => {
    const db = makeDb();
    const sendMail = jest.fn(async () => ({}));
    const result = await notifySupplierOfEnquiry(enquiry, { db, sendMail, now: () => NOW });

    expect(result).toEqual({ bell: true, email: 'sent' });
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
    expect(mockNotificationCreate.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      type: 'message',
      title: 'New enquiry from Alice & Bob',
      actionUrl: '/dashboard/supplier#sdh-enquiries',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ to: 'owner@example.com', template: 'new-enquiry' });
    expect(mail.subject).toBe('New enquiry from Alice & Bob');
    // What the customer typed is escaped for the email, never injected as markup.
    expect(mail.templateData.previewHtml).not.toContain('<script>');
    expect(mail.templateData.previewHtml).toContain('&lt;script&gt;');
  });

  it('calls a quote request a quote request', async () => {
    const db = makeDb();
    const sendMail = jest.fn(async () => ({}));
    await notifySupplierOfEnquiry({ ...enquiry, kind: 'quote' }, { db, sendMail, now: () => NOW });
    expect(mockNotificationCreate.mock.calls[0][0].title).toBe(
      'New quote request from Alice & Bob'
    );
    expect(sendMail.mock.calls[0][0].templateData.enquiryLabel).toBe('a quote request');
  });

  it('sends at most one email every 15 minutes, but a bell notification every time', async () => {
    const db = makeDb();
    const sendMail = jest.fn(async () => ({}));
    let clock = NOW.getTime();
    const now = () => new Date(clock);

    expect((await notifySupplierOfEnquiry(enquiry, { db, sendMail, now })).email).toBe('sent');
    clock += 60 * 1000;
    expect((await notifySupplierOfEnquiry(enquiry, { db, sendMail, now })).email).toBe('throttled');
    clock += EMAIL_INTERVAL_MS;
    expect((await notifySupplierOfEnquiry(enquiry, { db, sendMail, now })).email).toBe('sent');

    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(mockNotificationCreate).toHaveBeenCalledTimes(3);
  });

  it('does not email an owner whose address is not verified, but still rings the bell', async () => {
    const db = makeDb({ owner: { id: 'user-1', email: 'owner@example.com', verified: false } });
    const sendMail = jest.fn();
    const result = await notifySupplierOfEnquiry(enquiry, { db, sendMail, now: () => NOW });
    expect(result).toEqual({ bell: true, email: 'skipped' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown supplier', { supplier: null }],
    ['a supplier with no owner account', { supplier: { id: 'sup-1' } }],
    ['an owner who no longer exists', { owner: null }],
  ])('does nothing, quietly, for %s', async (_label, setup) => {
    const sendMail = jest.fn();
    const result = await notifySupplierOfEnquiry(enquiry, {
      db: makeDb(setup),
      sendMail,
      now: () => NOW,
    });
    expect(result).toEqual({ bell: false, email: 'skipped' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('never throws: a failing email or bell is reported and the other still happens', async () => {
    const db = makeDb();
    const failingMail = jest.fn(async () => {
      throw new Error('Postmark is down');
    });
    await expect(
      notifySupplierOfEnquiry(enquiry, { db, sendMail: failingMail, now: () => NOW })
    ).resolves.toEqual({ bell: true, email: 'failed' });

    mockNotificationCreate.mockRejectedValueOnce(new Error('database busy'));
    const sendMail = jest.fn(async () => ({}));
    await expect(
      notifySupplierOfEnquiry(enquiry, {
        db: makeDb(),
        sendMail,
        now: () => new Date(NOW.getTime() + 3600 * 1000),
      })
    ).resolves.toEqual({ bell: false, email: 'sent' });

    await expect(
      notifySupplierOfEnquiry(enquiry, {
        db: {
          findOne: jest.fn(async () => {
            throw new Error('db down');
          }),
        },
      })
    ).resolves.toEqual({ bell: false, email: 'skipped' });
  });
});

describe('helpers', () => {
  it('plainText undoes the stored escaping, collapses whitespace and limits the length', () => {
    expect(plainText('A &amp; B\n\n  C', 50)).toBe('A & B C');
    expect(plainText('x'.repeat(500), 200)).toHaveLength(200);
    expect(plainText(null, 10)).toBe('');
  });

  it('emailIsDue accepts a missing or unreadable last-sent time', () => {
    expect(emailIsDue({}, NOW.getTime())).toBe(true);
    expect(emailIsDue({ enquiryEmailLastSentAt: 'nonsense' }, NOW.getTime())).toBe(true);
    expect(emailIsDue({ enquiryEmailLastSentAt: NOW.toISOString() }, NOW.getTime())).toBe(false);
  });
});

describe('the routes tell the supplier', () => {
  const mockInsertOne = jest.fn(async (_collection, doc) => doc);
  const mockNotify = jest.fn(async () => ({}));

  function appWith(routerPath, mountPath) {
    jest.resetModules();
    jest.doMock('../../db-unified', () => ({
      insertOne: (...args) => mockInsertOne(...args),
      read: jest.fn(async () => []),
      find: jest.fn(async () => []),
    }));
    jest.doMock('../../services/supplierEnquiryNotifier', () => ({
      notifySupplierOfEnquiry: (...args) => mockNotify(...args),
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_r, _s, next) => next() }));
    jest.doMock('../../middleware/rateLimits', () => ({
      writeLimiter: (_r, _s, next) => next(),
    }));
    jest.doMock('../../middleware/auth', () => ({ getUserFromCookie: async () => null }));
    const app = express();
    app.use(express.json());
    app.use(mountPath, require(routerPath));
    return app;
  }

  beforeEach(() => {
    mockInsertOne.mockClear();
    mockNotify.mockClear();
  });

  it('a quote request tells every supplier it names, with the customer as sender', async () => {
    const res = await request(appWith('../../routes/quote-requests', '/api/quote-requests'))
      .post('/api/quote-requests')
      .send({
        name: 'Alice Smith',
        email: 'alice@example.com',
        eventType: 'Wedding',
        notes: 'Photos for 120 guests',
        suppliers: [
          { supplierId: 'sup-1', supplierName: 'One' },
          { supplierId: 'sup-2', supplierName: 'Two' },
        ],
      });
    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify.mock.calls.map(call => call[0].supplierId)).toEqual(['sup-1', 'sup-2']);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({
      kind: 'quote',
      senderName: 'Alice Smith',
      message: 'Wedding: Photos for 120 guests',
    });
  });

  it('a quote request that is refused tells nobody', async () => {
    const res = await request(appWith('../../routes/quote-requests', '/api/quote-requests'))
      .post('/api/quote-requests')
      .send({
        name: 'A',
        email: 'not-an-email',
        eventType: 'Wedding',
        suppliers: [{ supplierId: 's' }],
      });
    expect(res.status).toBe(400);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('only the first ten suppliers named are told', async () => {
    const suppliers = Array.from({ length: 25 }, (_v, i) => ({
      supplierId: `s${i}`,
      supplierName: `S${i}`,
    }));
    await request(appWith('../../routes/quote-requests', '/api/quote-requests'))
      .post('/api/quote-requests')
      .send({ name: 'Alice Smith', email: 'alice@example.com', eventType: 'Wedding', suppliers });
    expect(mockNotify).toHaveBeenCalledTimes(10);
  });
});

describe('the contact form tells the supplier', () => {
  const mockNotify = jest.fn(async () => ({}));

  function contactApp({ saved = true } = {}) {
    jest.resetModules();
    jest.doMock('../../services/supplierEnquiryNotifier', () => ({
      notifySupplierOfEnquiry: (...args) => mockNotify(...args),
    }));
    jest.doMock('../../services/notifyAdmins.service', () => ({ notifyAdmins: jest.fn() }));
    const contact = require('../../routes/contact');
    contact.initializeDependencies({
      dbUnified: {
        read: jest.fn(async () => [{ id: 'sup-1', name: 'Bloom & Co' }]),
        insertOne: jest.fn(async (_collection, doc) => (saved ? doc : null)),
      },
      writeLimiter: (_req, _res, next) => next(),
      verifyAltcha: async () => ({ success: true }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api', contact);
    return app;
  }

  const body = {
    name: 'Alice Smith',
    email: 'alice@example.com',
    message: 'Are you free on 12 June?',
    supplierId: 'sup-1',
  };

  beforeEach(() => mockNotify.mockClear());

  it('tells the supplier once the enquiry is saved', async () => {
    const res = await request(contactApp()).post('/api/contact-supplier').send(body);
    expect(res.status).toBe(200);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({
      supplierId: 'sup-1',
      kind: 'contact',
      senderName: 'Alice Smith',
    });
  });

  it('tells nobody when the enquiry could not be saved', async () => {
    const res = await request(contactApp({ saved: false }))
      .post('/api/contact-supplier')
      .send(body);
    expect(res.status).toBe(500);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('tells nobody about an unknown supplier', async () => {
    const res = await request(contactApp())
      .post('/api/contact-supplier')
      .send({ ...body, supplierId: 'nope' });
    expect(res.status).toBe(404);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
