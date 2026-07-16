'use strict';

const fs = require('fs');
const path = require('path');
const {
  expireStaleRequests,
  scheduleMaintenance,
} = require('../../services/reviewRequestMaintenance.service');

function createDb(rows) {
  const reviewRequests = rows.map(row => ({ ...row }));
  return {
    reviewRequests,
    find: jest.fn(async (_collection, filter) =>
      reviewRequests.filter(
        row =>
          filter.status.$in.includes(row.status) &&
          typeof row.expiresAt === 'string' &&
          row.expiresAt <= filter.expiresAt.$lte
      )
    ),
    updateOne: jest.fn(async (_collection, query, update) => {
      const row = reviewRequests.find(
        item =>
          item.id === query.id &&
          item.status === query.status &&
          item.expiresAt === query.expiresAt
      );
      if (!row) {
        return false;
      }
      Object.assign(row, update.$set);
      return true;
    }),
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('review request maintenance', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
  const originalCron = process.env.REVIEW_REQUEST_MAINTENANCE_CRON;

  afterEach(() => {
    restoreEnv('NODE_ENV', originalNodeEnv);
    restoreEnv('REVIEW_REQUEST_MAINTENANCE_ENABLED', originalEnabled);
    restoreEnv('REVIEW_REQUEST_MAINTENANCE_CRON', originalCron);
  });

  test('expires only stale active requests and releases their active ids', async () => {
    const now = new Date('2026-07-16T12:00:00.000Z');
    const db = createDb([
      {
        id: 'rreq_active_stale',
        status: 'sent',
        expiresAt: '2026-07-16T11:59:59.000Z',
      },
      {
        id: 'rreq_active_future',
        status: 'opened',
        expiresAt: '2026-07-16T12:00:01.000Z',
      },
      {
        id: 'completed-request',
        status: 'completed',
        expiresAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    const log = { info: jest.fn(), error: jest.fn() };

    const result = await expireStaleRequests({ db, now, log });

    expect(result).toEqual({ checked: 1, expired: 1, skipped: false });
    expect(db.find).toHaveBeenCalledWith('reviewRequests', {
      status: { $in: ['pending', 'sent', 'opened'] },
      expiresAt: { $lte: now.toISOString() },
    });
    expect(db.reviewRequests[0]).toEqual(
      expect.objectContaining({
        status: 'expired',
        expiredAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
    );
    expect(db.reviewRequests[0].id).toMatch(/^rreq_/);
    expect(db.reviewRequests[0].id).not.toBe('rreq_active_stale');
    expect(db.reviewRequests[1].status).toBe('opened');
    expect(db.reviewRequests[2].status).toBe('completed');
  });

  test('does not count a request changed by another process', async () => {
    const db = createDb([
      {
        id: 'rreq_active_race',
        status: 'sent',
        expiresAt: '2026-07-16T11:00:00.000Z',
      },
    ]);
    db.updateOne.mockResolvedValue(false);

    const result = await expireStaleRequests({
      db,
      now: new Date('2026-07-16T12:00:00.000Z'),
      log: { info: jest.fn(), error: jest.fn() },
    });

    expect(result).toEqual({ checked: 1, expired: 0, skipped: false });
  });

  test('schedules hourly maintenance by default in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
    process.env.REVIEW_REQUEST_MAINTENANCE_CRON = '15 * * * *';
    const nextRun = new Date('2026-07-16T13:15:00.000Z');
    const scheduleModule = {
      scheduleJob: jest.fn().mockReturnValue({ nextInvocation: () => nextRun }),
    };

    const result = scheduleMaintenance({
      db: createDb([]),
      log: { info: jest.fn(), error: jest.fn() },
      scheduleModule,
    });

    expect(scheduleModule.scheduleJob).toHaveBeenCalledWith('15 * * * *', expect.any(Function));
    expect(result).toEqual({ scheduled: true, cronExpr: '15 * * * *', nextRun });
  });

  test('is disabled by default outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.REVIEW_REQUEST_MAINTENANCE_ENABLED;
    const scheduleModule = { scheduleJob: jest.fn() };

    const result = scheduleMaintenance({
      db: createDb([]),
      log: { info: jest.fn(), error: jest.fn() },
      scheduleModule,
    });

    expect(result).toEqual({ scheduled: false, cronExpr: null, nextRun: null });
    expect(scheduleModule.scheduleJob).not.toHaveBeenCalled();
  });

  test('server startup and database indexes include maintenance wiring', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    const database = fs.readFileSync(path.join(__dirname, '../../db-unified.js'), 'utf8');

    expect(server).toContain("require('./services/reviewRequestMaintenance.service')");
    expect(server).toContain('scheduleMaintenance()');
    expect(database).toContain("createIndex({ status: 1, expiresAt: 1 })");
  });
});
