'use strict';

/**
 * Audit Log: dates include the whole "to" day, results come a page at a time with a total, the
 * filter lists cover every action, the export matches the filters, and cashout changes are
 * written to the log.
 */

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (req, res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (req, res, next) => next() }));
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  insertOne: jest.fn().mockResolvedValue({ id: 'x' }),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  uid: jest.fn(prefix => `${prefix}_1`),
}));
jest.mock('../../store', () => ({ uid: jest.fn(prefix => `${prefix}_1`) }));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../services/partnerAntiAbuseService', () => ({}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');
const audit = require('../../middleware/audit');
const { AUDIT_ACTIONS } = require('../../middleware/audit-actions');

const entry = (id, timestamp, extra = {}) => ({
  id,
  adminId: 'admin-1',
  adminEmail: 'admin@example.com',
  action: 'user_banned',
  targetType: 'user',
  targetId: `u-${id}`,
  timestamp,
  ...extra,
});

describe('auditDateBound', () => {
  it('turns a plain day into the start or the very end of that day', () => {
    expect(audit.auditDateBound('2026-10-28', 'start')).toBe('2026-10-28T00:00:00.000Z');
    expect(audit.auditDateBound('2026-10-28', 'end')).toBe('2026-10-28T23:59:59.999Z');
  });

  it('passes a full timestamp through and ignores nonsense', () => {
    expect(audit.auditDateBound('2026-10-28T10:00:00Z', 'end')).toBe('2026-10-28T10:00:00.000Z');
    expect(audit.auditDateBound('not a date', 'start')).toBeNull();
    expect(audit.auditDateBound('', 'end')).toBeNull();
  });
});

describe('filterAuditLogs', () => {
  const entries = [
    entry(1, '2026-10-27T09:00:00.000Z'),
    entry(2, '2026-10-28T00:00:00.000Z'),
    entry(3, '2026-10-28T18:30:00.000Z', {
      action: 'partner_credits_adjusted',
      targetType: 'partner',
    }),
    entry(4, '2026-10-29T00:00:00.000Z'),
    { ...entry(5, undefined), timestamp: undefined, createdAt: '2026-10-28T12:00:00.000Z' },
  ];

  it('includes everything that happened on the "to" day', () => {
    const ids = audit
      .filterAuditLogs(entries, { startDate: '2026-10-28', endDate: '2026-10-28' })
      .map(item => item.id);
    expect(ids).toEqual([3, 5, 2]);
  });

  it('sorts newest first, reading createdAt when an entry has no timestamp', () => {
    expect(audit.filterAuditLogs(entries, {}).map(item => item.id)).toEqual([4, 3, 5, 2, 1]);
  });

  it('filters by action and by a list of target types', () => {
    expect(audit.filterAuditLogs(entries, { action: 'partner_credits_adjusted' })).toHaveLength(1);
    expect(audit.filterAuditLogs(entries, { targetType: 'partner,user' })).toHaveLength(5);
    expect(audit.filterAuditLogs(entries, { targetType: 'partner' })).toHaveLength(1);
  });
});

describe('getAuditLogsPage', () => {
  const many = Array.from({ length: 250 }, (_, index) =>
    entry(index, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString())
  );

  beforeEach(() => dbUnified.read.mockResolvedValue(many));

  it('returns one page and the total that match', async () => {
    const first = await audit.getAuditLogsPage({ page: 1, limit: 100 });
    expect(first.logs).toHaveLength(100);
    expect(first.total).toBe(250);
    expect(first.logs[0].id).toBe(249);

    const last = await audit.getAuditLogsPage({ page: 3, limit: 100 });
    expect(last.logs).toHaveLength(50);
    expect(last.logs[49].id).toBe(0);
  });

  it('never returns more than 100 at once', async () => {
    const result = await audit.getAuditLogsPage({ limit: 5000 });
    expect(result.limit).toBe(100);
    expect(result.logs).toHaveLength(100);
  });

  it('reports a read failure instead of pretending there are no entries', async () => {
    dbUnified.read.mockRejectedValue(new Error('db down'));
    const result = await audit.getAuditLogsPage({});
    expect(result.failed).toBe(true);
  });

  it('keeps getAuditLogs working for its other callers', async () => {
    expect(await audit.getAuditLogs({ limit: 3 })).toHaveLength(3);
    expect(await audit.getAuditLogs({ limit: 3, offset: 249 })).toHaveLength(1);
  });
});

describe('getAuditFilterOptions', () => {
  it('lists every action the system can record plus any already stored', async () => {
    dbUnified.read.mockResolvedValue([
      entry(1, '2026-01-01T00:00:00Z', { action: 'AUDIT_LOG_EXPORT', targetType: 'audit_log' }),
      entry(2, '2026-01-01T00:00:00Z', {
        action: 'partner_credits_adjusted',
        targetType: 'partner',
      }),
    ]);
    const options = await audit.getAuditFilterOptions();
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(options.actions).toContain(action);
    }
    expect(options.actions).toContain('AUDIT_LOG_EXPORT');
    expect(options.targetTypes).toEqual(['audit_log', 'partner']);
    expect(options.actions).toEqual([...options.actions].sort());
  });
});

describe('audit routes', () => {
  const adminRouter = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);

  const stored = [
    entry(1, '2026-10-27T09:00:00.000Z'),
    entry(2, '2026-10-28T20:00:00.000Z', { targetId: '=cmd|calc' }),
    entry(3, '2026-10-29T09:00:00.000Z', {
      action: 'partner_status_changed',
      targetType: 'partner',
    }),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.insertOne.mockResolvedValue({ id: 'x' });
    dbUnified.read.mockResolvedValue(stored);
  });

  it('lists a page with the total, on both paths', async () => {
    for (const path of ['/api/admin/audit-logs', '/api/admin/audit']) {
      const res = await request(app).get(`${path}?limit=2&page=2`).expect(200);
      expect(res.body).toMatchObject({ count: 1, total: 3, page: 2, limit: 2 });
      expect(res.body.logs[0].id).toBe(1);
    }
  });

  it('includes the whole end day when filtering', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?startDate=2026-10-28&endDate=2026-10-28')
      .expect(200);
    expect(res.body.logs.map(log => log.id)).toEqual([2]);
  });

  it('says so when the entries cannot be read', async () => {
    dbUnified.read.mockRejectedValue(new Error('db down'));
    await request(app).get('/api/admin/audit-logs').expect(500);
  });

  it('serves the filter lists', async () => {
    const res = await request(app).get('/api/admin/audit-logs/filters').expect(200);
    expect(res.body.actions).toContain('partner_credits_adjusted');
    expect(res.body.targetTypes).toEqual(['partner', 'user']);
  });

  it('exports what the filters match, includes the end day, and is logged', async () => {
    const res = await request(app)
      .get('/api/admin/audit/export?format=json&startDate=2026-10-28&endDate=2026-10-28')
      .expect(200);
    expect(res.body.logs.map(log => log.id)).toEqual([2]);
    const logged = dbUnified.insertOne.mock.calls.find(call => call[0] === 'audit_logs')[1];
    expect(logged).toMatchObject({ action: 'AUDIT_LOG_EXPORT' });
    expect(logged.details).toMatchObject({ count: 1, startDate: '2026-10-28' });
  });

  it('exports only the chosen action and type', async () => {
    const res = await request(app)
      .get('/api/admin/audit/export?format=json&action=partner_status_changed&targetType=partner')
      .expect(200);
    expect(res.body.logs.map(log => log.id)).toEqual([3]);
  });

  it('stops a spreadsheet running a value that starts with =', async () => {
    const res = await request(app).get('/api/admin/audit/export?format=csv').expect(200);
    expect(res.text).toContain(`"'=cmd|calc"`);
    expect(res.text).not.toContain(`,"=cmd|calc"`);
  });
});

describe('cashout changes are audit-logged', () => {
  const cashoutRouter = require('../../routes/admin-cashout-requests');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cashout-requests', cashoutRouter);

  const base = {
    id: 'co-1',
    partnerId: 'p1',
    status: 'approved',
    pointsHeld: 1500,
    denominationGbp: 15,
    method: 'amazon',
    holdTxnId: 'h1',
  };

  const loggedEntries = () =>
    dbUnified.insertOne.mock.calls.filter(call => call[0] === 'audit_logs').map(call => call[1]);

  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.insertOne.mockResolvedValue({ id: 'x' });
    dbUnified.updateOne.mockResolvedValue({ id: 'co-1' });
    dbUnified.deleteOne.mockResolvedValue(true);
  });

  it('records a status change without the delivery evidence', async () => {
    dbUnified.read.mockResolvedValue([base]);
    await request(app)
      .patch('/api/admin/cashout-requests/co-1')
      .send({ status: 'processing', adminInternalNotes: 'checked' })
      .expect(200);

    const [log] = loggedEntries();
    expect(log).toMatchObject({
      adminId: 'admin-1',
      action: AUDIT_ACTIONS.CASHOUT_REQUEST_UPDATED,
      targetType: 'cashout_request',
      targetId: 'co-1',
    });
    expect(log.details).toMatchObject({
      partnerId: 'p1',
      statusFrom: 'approved',
      statusTo: 'processing',
      internalNotesChanged: true,
      responseMessageChanged: false,
    });
  });

  it('records nothing when the change is refused', async () => {
    dbUnified.read.mockResolvedValue([{ ...base, status: 'delivered' }]);
    await request(app)
      .patch('/api/admin/cashout-requests/co-1')
      .send({ status: 'rejected' })
      .expect(400);
    expect(loggedEntries()).toHaveLength(0);
  });

  it('records a deletion', async () => {
    dbUnified.read.mockResolvedValue([{ ...base, status: 'rejected' }]);
    await request(app).delete('/api/admin/cashout-requests/co-1').expect(200);
    const [log] = loggedEntries();
    expect(log).toMatchObject({
      action: AUDIT_ACTIONS.CASHOUT_REQUEST_DELETED,
      targetId: 'co-1',
    });
    expect(log.details).toMatchObject({ status: 'rejected', pointsHeld: 1500 });
  });
});

describe('audit and cashout pages', () => {
  const fs = require('fs');
  const path = require('path');
  const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

  it('the Audit Log screen offers every action from the server and pages through results', () => {
    const script = read('public/assets/js/pages/admin-audit-init.js');
    expect(script).toContain('/api/admin/audit-logs/filters');
    expect(script).toMatch(/params\.set\('page'/);
    expect(script).toContain('Showing ${first}–${last} of ${totalEntries} entries');
    // dates go to the server as plain days, not midnight timestamps
    expect(script).not.toContain('toISOString');
    expect(read('public/admin-audit.html')).toContain('admin-audit-init.js?v=18.5.12');
  });

  it('the export carries the same filters as the list', () => {
    const script = read('public/assets/js/pages/admin-audit-init.js');
    expect(script).toMatch(/const params = currentFilters\(\);\s*params\.set\('format', 'csv'\)/);
  });

  it('the Cashout Requests screen confirms approve, reject and delivered, and scrolls on phones', () => {
    const script = read('public/assets/js/pages/admin-cashout-requests-init.js');
    for (const status of ['approved', 'rejected', 'delivered']) {
      expect(script).toMatch(new RegExp(`${status}: \\{\\s*title:`));
    }
    expect(script).toContain('await confirmStatusChange(update.newStatus)');
    const html = read('public/admin-cashout-requests.html');
    expect(html).toMatch(/\.acr-table-wrap \{[^}]*overflow-x: auto/);
    expect(html).toMatch(/admin-cashout-requests-init\.js\?v=/);
  });
});
