'use strict';

/**
 * Admin safety fixes: exports must not leak credentials or private message text, the marketing
 * list must skip people who opted out, CSV cells are formula-safe, exports are audit-logged, the
 * user edit response carries no secrets, and the cashout page asks for its CSRF token at a real URL.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue({}),
  auditMiddleware: () => (req, res, next) => next(),
  AUDIT_ACTIONS: { DATA_EXPORT: 'data_export' },
}));
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
  uid: jest.fn(prefix => `${prefix}_1`),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');
const { auditLog } = require('../../middleware/audit');
const {
  stripSecretFields,
  stripMessageBody,
  withoutPrivateText,
} = require('../../utils/adminExportSanitizer');

const ROOT = path.join(__dirname, '../..');

const collections = {
  users: [
    {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.test',
      role: 'customer',
      passwordHash: '$2a$10$hash',
      verificationToken: 'verify_live',
      resetToken: 'reset_live',
      versionHistory: [{ previousState: { verificationToken: 'verify_old' } }],
      marketingOptIn: true,
    },
  ],
  suppliers: [{ id: 's1', name: 'Venue' }],
  packages: [],
  plans: [{ id: 'p1', guestToken: 'guest_live', title: 'Plan' }],
  notes: [{ id: 'n1', userId: 'u1', text: 'my private note' }],
  events: [],
  threads: [{ id: 't1', subject: 'Enquiry', lastMessage: { content: 'thread preview text' } }],
  messages: [{ id: 'm1', threadId: 't1', fromUserId: 'u1', text: 'private words', body: 'more' }],
};

describe('adminExportSanitizer', () => {
  it('removes credential fields and edit history, keeps ordinary fields', () => {
    const clean = stripSecretFields(collections.users[0]);
    expect(clean).toEqual({
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.test',
      role: 'customer',
      marketingOptIn: true,
    });
  });

  it('cleans every record when used directly with Array.map (index is not treated as depth)', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      passwordHash: `h${i}`,
      nested: { token: 't' },
    }));
    const cleaned = rows.map(stripSecretFields);
    expect(JSON.stringify(cleaned)).not.toMatch(/passwordHash|token/);
  });

  it('removes 2FA secrets and backup codes', () => {
    expect(
      stripSecretFields({
        id: 'u1',
        twoFactorEnabled: true,
        twoFactorSecret: 's',
        twoFactorBackupCodes: ['h'],
      })
    ).toEqual({ id: 'u1', twoFactorEnabled: true });
  });

  it('removes credentials nested inside objects and arrays without touching the input', () => {
    const plan = {
      id: 'p1',
      guests: [{ name: 'Ann', rsvpToken: 'tok' }],
      owner: { apiKey: 'k', id: 'u1' },
    };
    const clean = stripSecretFields(plan);
    expect(clean).toEqual({ id: 'p1', guests: [{ name: 'Ann' }], owner: { id: 'u1' } });
    expect(plan.guests[0].rsvpToken).toBe('tok');
  });

  it('withoutPrivateText drops the named private fields as well as credentials', () => {
    const clean = withoutPrivateText(['text'])({
      id: 'n1',
      userId: 'u1',
      text: 'private',
      authToken: 't',
    });
    expect(clean).toEqual({ id: 'n1', userId: 'u1' });
  });

  it('keeps only metadata on messages', () => {
    expect(stripMessageBody(collections.messages[0])).toEqual({
      id: 'm1',
      threadId: 't1',
      fromUserId: 'u1',
    });
  });
});

describe('GET /export/all', () => {
  const adminRouter = require('../../routes/admin');
  const app = express();
  app.use('/api/admin', adminRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.read.mockImplementation(async name => collections[name] || []);
  });

  it('cleans every record, not just the first few', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `u${i}`,
      email: `u${i}@example.test`,
      passwordHash: `hash_${i}`,
      verificationToken: `tok_${i}`,
    }));
    dbUnified.read.mockImplementation(async name => (name === 'users' ? many : []));
    const res = await request(app).get('/api/admin/export/all');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/passwordHash|hash_|verificationToken|tok_/);
    expect(JSON.parse(res.text).users).toHaveLength(25);
  });

  it('contains no hashes, tokens or message text, and is audit-logged', async () => {
    const res = await request(app).get('/api/admin/export/all');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/passwordHash|verify_live|reset_live|verify_old|guest_live/);
    expect(res.text).not.toMatch(/private words|more|my private note|thread preview text/);
    const body = JSON.parse(res.text);
    expect(body.users[0].email).toBe('ada@example.test');
    expect(body.threads[0]).toEqual({ id: 't1', subject: 'Enquiry' });
    expect(body.notes[0]).toEqual({ id: 'n1', userId: 'u1' });
    expect(body.messages[0]).toEqual({ id: 'm1', threadId: 't1', fromUserId: 'u1' });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        action: 'data_export',
        targetId: 'export-all',
      })
    );
  });
});

describe('user management routes', () => {
  const userRouter = require('../../routes/admin-user-management');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', userRouter);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marketing export skips unsubscribed (either store), suspended and non-opted-in people and neutralises formulas', async () => {
    const marketingUsers = [
      { id: '1', name: 'Keep', email: 'keep@example.test', role: 'customer', marketingOptIn: true },
      {
        id: '2',
        name: 'Gone',
        email: 'gone@example.test',
        marketingOptIn: true,
        emailUnsubscribed: true,
      },
      { id: '3', name: 'Held', email: 'held@example.test', marketingOptIn: true, suspended: true },
      { id: '4', name: 'No', email: 'no@example.test', marketingOptIn: false },
      { id: '5', name: '=HYPERLINK("http://x")', email: 'evil@example.test', marketingOptIn: true },
      { id: '6', name: 'Letter', email: 'letter@example.test', marketingOptIn: true },
    ];
    dbUnified.read.mockImplementation(async name =>
      name === 'newsletterSubscribers'
        ? [{ email: 'Letter@Example.test', status: 'unsubscribed' }]
        : marketingUsers
    );
    const res = await request(app).get('/api/admin/marketing-export');
    expect(res.status).toBe(200);
    expect(res.text).toContain('keep@example.test');
    expect(res.text).toContain('evil@example.test');
    expect(res.text).not.toMatch(/gone@|held@|no@|letter@/);
    expect(res.text).toContain(`"'=HYPERLINK`);
    expect(res.text).not.toContain('"=HYPERLINK');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_export', targetId: 'marketing-export' })
    );
  });

  it('users export neutralises formulas and is audit-logged', async () => {
    dbUnified.read.mockResolvedValue([
      { id: '1', name: '+cmd', email: '@a@example.test', role: 'customer' },
    ]);
    const res = await request(app).get('/api/admin/users-export');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'+cmd"`);
    expect(res.text).toContain(`"'@a@example.test"`);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_export', targetId: 'users-export' })
    );
  });

  it('PUT /users/:id returns no secrets', async () => {
    dbUnified.findOne.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.test',
      passwordHash: '$2a$10$hash',
      verificationToken: 'verify_live',
      verificationTokenExpiresAt: '2030-01-01',
    });
    const res = await request(app).put('/api/admin/users/u1').send({ name: 'Ada L' });
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/passwordHash|verify_live|verificationToken/);
    expect(res.body.user.name).toBe('Ada L');
    // The stored edit history must not keep the token either.
    const stored = dbUnified.updateOne.mock.calls[0][2].$set.versionHistory;
    expect(JSON.stringify(stored)).not.toMatch(/passwordHash|verify_live/);
  });
});

describe('cashout requests page', () => {
  it('fetches its CSRF token from the endpoint that exists', () => {
    const script = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/admin-cashout-requests-init.js'),
      'utf8'
    );
    expect(script).toContain("fetch('/api/v1/csrf-token'");
    expect(script).not.toContain('/auth/csrf-token');
    const system = fs.readFileSync(path.join(ROOT, 'routes/system.js'), 'utf8');
    expect(system).toContain("router.get('/csrf-token'");
  });

  it('fetches the token once, refuses to send an empty one, and retries once on a CSRF refusal', () => {
    const script = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/admin-cashout-requests-init.js'),
      'utf8'
    );
    expect(script).toMatch(/if \(cachedCsrfToken && !forceRefresh\)/);
    expect(script).toMatch(/if \(!cachedCsrfToken\) \{\s*throw new Error/);
    expect(script).toMatch(/res\.status === 403 && data\.errorType === 'CSRFError'/);
    expect(script).toMatch(/getCsrfToken\(true\)/);
  });

  it('loads the script with a version tag so cached copies are replaced', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/admin-cashout-requests.html'), 'utf8');
    expect(html).toMatch(/admin-cashout-requests-init\.js\?v=/);
  });
});
