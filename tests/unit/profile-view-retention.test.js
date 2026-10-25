'use strict';

/**
 * Profile-view retention: the period covers the longest dashboard window with a margin, new
 * profile views are stamped with an expiry (other events are not), and older events are stamped
 * by a batched, idempotent, non-fatal backfill.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

/**
 * A small in-memory db-unified covering what the backfill calls: findWithOptions (with $exists,
 * $gt, $in, sort and limit), updateMany, findOne, upsertOne, insertOne and the stubs the module
 * load needs. Rows may carry `_id` (MongoDB) or only `id` (local store).
 */
jest.mock('../../db-unified', () => {
  let rows = {};
  let failUpdates = false;
  const calls = { updateMany: [], findWithOptions: [] };

  function matchesOne(row, key, condition) {
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      return Object.entries(condition).every(([op, operand]) => {
        if (op === '$exists') {
          return (value !== undefined) === Boolean(operand);
        }
        if (op === '$gt') {
          return value > operand;
        }
        if (op === '$in') {
          return operand.includes(value);
        }
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return value === condition;
  }
  const matches = (row, filter) =>
    Object.entries(filter || {}).every(([key, cond]) => matchesOne(row, key, cond));

  return {
    __reset(seed = {}) {
      rows = {};
      Object.entries(seed).forEach(([name, list]) => {
        rows[name] = list.map(row => ({ ...row }));
      });
      failUpdates = false;
      calls.updateMany = [];
      calls.findWithOptions = [];
    },
    __rows: name => rows[name] || [],
    __calls: calls,
    __failUpdates(value) {
      failUpdates = value;
    },
    findOne: jest.fn(
      async (name, filter) => (rows[name] || []).find(r => matches(r, filter)) || null
    ),
    findWithOptions: jest.fn(async (name, filter, options = {}) => {
      calls.findWithOptions.push({ filter, options });
      const { limit = 50, sort = {} } = options;
      const [[field, dir] = []] = Object.entries(sort);
      let list = (rows[name] || []).filter(r => matches(r, filter));
      if (field) {
        list = [...list].sort((a, b) =>
          a[field] < b[field] ? -dir : a[field] > b[field] ? dir : 0
        );
      }
      return list.slice(0, limit).map(r => ({ ...r }));
    }),
    updateMany: jest.fn(async (name, filter, update) => {
      calls.updateMany.push({ filter, update });
      if (failUpdates) {
        return 0;
      }
      let modified = 0;
      (rows[name] || []).forEach(row => {
        if (matches(row, filter)) {
          Object.assign(row, update.$set);
          modified += 1;
        }
      });
      return modified;
    }),
    upsertOne: jest.fn(async (name, filter, fields) => {
      rows[name] = rows[name] || [];
      const existing = rows[name].find(r => matches(r, filter));
      if (existing) {
        Object.assign(existing, fields);
      } else {
        rows[name].push({ ...filter, ...fields });
      }
      return true;
    }),
    insertOne: jest.fn(async (name, doc) => {
      rows[name] = rows[name] || [];
      rows[name].push({ ...doc });
      return doc;
    }),
  };
});

const dbUnified = require('../../db-unified');
const logger = require('../../utils/logger');
const retention = require('../../utils/profileViewRetention');
const supplierAnalytics = require('../../utils/supplierAnalytics');
const { MAX_REQUEST_DAYS } = require('../../utils/analyticsWindow');
const { PLAN_FEATURES } = require('../../models/Subscription');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-25T12:00:00.000Z');

/**
 * A stored profile-view event as written before the expiry existed.
 *
 * @param {number} n - Row number
 * @param {Object} [extra] - Fields to add or override
 * @returns {Object} Event row
 */
function oldEvent(n, extra = {}) {
  const timestamp = new Date(NOW - n * DAY_MS).toISOString();
  return {
    _id: n,
    id: `event_${n}`,
    type: 'profile_view',
    supplierId: 'sup-1',
    timestamp,
    date: timestamp.slice(0, 10),
    ...extra,
  };
}

/**
 * The same event as the local store holds it: no _id, only the string id.
 *
 * @param {number} n - Row number
 * @returns {Object} Event row
 */
function localEvent(n) {
  const row = oldEvent(n);
  delete row._id;
  return row;
}

beforeEach(() => {
  dbUnified.__reset({ events: [] });
  jest.clearAllMocks();
});

describe('the retention period', () => {
  it('covers the longest analytics window any plan or route can serve, with a margin', () => {
    const longestPlanWindow = Math.max(
      ...Object.values(PLAN_FEATURES).map(plan => plan.features.analyticsWindowDays)
    );
    expect(longestPlanWindow).toBe(365);
    // A window of N days reaches back N-1 whole UTC days from today, so its oldest event is under
    // N days and 24 hours old; the previous-period comparison is only for windows of 90 days or
    // fewer (MAX_REQUEST_DAYS), twice which is still inside the longest window.
    expect(retention.PROFILE_VIEW_RETENTION_DAYS).toBeGreaterThanOrEqual(
      longestPlanWindow + 1 + 30
    );
    expect(MAX_REQUEST_DAYS * 2).toBeLessThan(retention.PROFILE_VIEW_RETENTION_DAYS);
    // The value public/privacy.html states.
    expect(retention.PROFILE_VIEW_RETENTION_DAYS).toBe(400);
  });

  it('privacy.html states the same number of days', () => {
    const html = require('fs').readFileSync(
      require('path').join(__dirname, '../../public/privacy.html'),
      'utf8'
    );
    expect(html).toContain(`${retention.PROFILE_VIEW_RETENTION_DAYS} days`);
  });

  it('profileViewExpiry adds the retention period to the time given', () => {
    expect(retention.profileViewExpiry(NOW).getTime()).toBe(NOW + 400 * DAY_MS);
  });
});

describe('trackEvent', () => {
  it('gives a profile view an expiresAt Date and leaves other event types without one', async () => {
    await supplierAnalytics.trackProfileView('sup-1', null, null, false, 'a:key');
    await supplierAnalytics.trackEnquirySent('sup-1', 'usr_1');
    await supplierAnalytics.trackMessageReply('sup-1', 'usr_1');

    const [view, ...others] = dbUnified.__rows('events');
    expect(view.type).toBe('profile_view');
    expect(view.expiresAt).toBeInstanceOf(Date);
    expect(view.expiresAt.getTime() - Date.parse(view.timestamp)).toBe(400 * DAY_MS);
    expect(others).toHaveLength(2);
    others.forEach(event => expect(event).not.toHaveProperty('expiresAt'));
  });

  it('does not store a preview view at all', async () => {
    await supplierAnalytics.trackProfileView('sup-1', 'usr_1', null, true, 'a:key');
    expect(dbUnified.__rows('events')).toHaveLength(0);
  });
});

describe('expiryForStoredEvent', () => {
  it('is never earlier than timestamp + retention, and the same for a whole UTC day', () => {
    const early = retention.expiryForStoredEvent({ timestamp: '2026-03-01T00:00:01.000Z' }, NOW);
    const late = retention.expiryForStoredEvent({ timestamp: '2026-03-01T23:59:59.000Z' }, NOW);
    expect(early.getTime()).toBe(late.getTime());
    expect(late.getTime()).toBeGreaterThanOrEqual(
      Date.parse('2026-03-01T23:59:59.000Z') + 400 * DAY_MS
    );
    expect(late.getTime()).toBeLessThanOrEqual(
      Date.parse('2026-03-01T23:59:59.000Z') + 401 * DAY_MS
    );
  });

  it('treats an unreadable timestamp as written now, so the row still ends', () => {
    const expiry = retention.expiryForStoredEvent({ timestamp: 'not a date' }, NOW);
    expect(expiry.getTime()).toBeGreaterThan(NOW + 399 * DAY_MS);
    expect(expiry.getTime()).toBeLessThanOrEqual(NOW + 401 * DAY_MS);
  });
});

describe('stampMissingExpiry', () => {
  it('stamps only profile views that have no expiry, in batches, and leaves everything else alone', async () => {
    const stamped = new Date(NOW + 5 * DAY_MS);
    dbUnified.__reset({
      events: [
        ...[1, 2, 3, 4, 5].map(n => oldEvent(n)),
        oldEvent(6, { expiresAt: stamped }),
        oldEvent(7, { type: 'enquiry_sent' }),
      ],
    });

    const totals = await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });

    expect(totals).toEqual({ scanned: 5, stamped: 5, batches: 3, stalled: false });
    const byId = Object.fromEntries(dbUnified.__rows('events').map(e => [e.id, e]));
    [1, 2, 3, 4, 5].forEach(n => {
      const event = byId[`event_${n}`];
      expect(event.expiresAt).toBeInstanceOf(Date);
      expect(event.expiresAt.getTime()).toBeGreaterThanOrEqual(
        Date.parse(event.timestamp) + 400 * DAY_MS
      );
    });
    // An already-stamped row keeps its own date; another event type is untouched.
    expect(byId.event_6.expiresAt).toBe(stamped);
    expect(byId.event_7).not.toHaveProperty('expiresAt');
  });

  it('walks the collection in _id order, so no batch re-reads rows it has passed', async () => {
    dbUnified.__reset({ events: [1, 2, 3, 4, 5].map(n => oldEvent(n)) });
    await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });

    const reads = dbUnified.__calls.findWithOptions.map(call => call.filter._id);
    expect(reads[0]).toBeUndefined();
    expect(reads[1]).toEqual({ $gt: 2 });
    expect(reads[2]).toEqual({ $gt: 4 });
    dbUnified.__calls.findWithOptions.forEach(call => {
      expect(call.options).toMatchObject({ limit: 2, sort: { _id: 1 }, throwOnError: true });
    });
  });

  it('updates once per UTC day in a batch, and only rows that still lack an expiry', async () => {
    dbUnified.__reset({
      events: [
        oldEvent(1, { timestamp: '2026-03-01T01:00:00.000Z' }),
        oldEvent(2, { timestamp: '2026-03-01T22:00:00.000Z' }),
        oldEvent(3, { timestamp: '2026-03-02T09:00:00.000Z' }),
      ],
    });
    await retention.stampMissingExpiry({ batchSize: 10, pauseMs: 0, nowMs: NOW });

    expect(dbUnified.__calls.updateMany).toHaveLength(2);
    dbUnified.__calls.updateMany.forEach(call => {
      expect(call.filter).toMatchObject({ type: 'profile_view', expiresAt: { $exists: false } });
      expect(Object.keys(call.update)).toEqual(['$set']);
    });
  });

  it('works on the local store, where rows have only an id', async () => {
    dbUnified.__reset({
      events: [1, 2, 3].map(localEvent),
    });
    const totals = await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });

    expect(totals.stamped).toBe(3);
    dbUnified.__rows('events').forEach(event => expect(event.expiresAt).toBeInstanceOf(Date));
  });

  it('is idempotent: a second run changes nothing', async () => {
    dbUnified.__reset({ events: [1, 2, 3].map(n => oldEvent(n)) });
    await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });
    const after = JSON.stringify(dbUnified.__rows('events'));

    const second = await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });

    expect(second).toEqual({ scanned: 0, stamped: 0, batches: 0, stalled: false });
    expect(JSON.stringify(dbUnified.__rows('events'))).toBe(after);
  });

  it('stops instead of looping when a batch cannot be written (local store, update failing)', async () => {
    dbUnified.__reset({
      events: [1, 2, 3].map(localEvent),
    });
    dbUnified.__failUpdates(true);

    const totals = await retention.stampMissingExpiry({ batchSize: 2, pauseMs: 0, nowMs: NOW });

    expect(totals.stalled).toBe(true);
    expect(totals.stamped).toBe(0);
    expect(totals.batches).toBe(1);
  });

  it('respects maxBatches', async () => {
    dbUnified.__reset({ events: [1, 2, 3, 4, 5].map(n => oldEvent(n)) });
    const totals = await retention.stampMissingExpiry({
      batchSize: 2,
      pauseMs: 0,
      maxBatches: 1,
      nowMs: NOW,
    });
    expect(totals.batches).toBe(1);
    expect(totals.stamped).toBe(2);
  });
});

describe('runProfileViewExpiryBackfill', () => {
  const options = { batchSize: 2, pauseMs: 0, nowMs: NOW };

  it('stamps older events, records completion and logs it', async () => {
    dbUnified.__reset({ events: [1, 2, 3].map(n => oldEvent(n)) });

    const result = await retention.runProfileViewExpiryBackfill({ ...options, env: {} });

    expect(result.ran).toBe(true);
    expect(result.totals.stamped).toBe(3);
    const marker = dbUnified.__rows(retention.MARKER_COLLECTION);
    expect(marker).toHaveLength(1);
    expect(marker[0]).toMatchObject({ id: retention.MARKER_ID, stamped: 3 });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Profile-view retention: done')
    );
  });

  it('does nothing again within a week of finishing, and runs again after that', async () => {
    dbUnified.__reset({ events: [oldEvent(1)] });
    await retention.runProfileViewExpiryBackfill({ ...options, env: {} });
    dbUnified.__rows('events').push(oldEvent(2, { _id: 99 }));

    const soon = await retention.runProfileViewExpiryBackfill({
      ...options,
      env: {},
      nowMs: NOW + 6 * DAY_MS,
    });
    expect(soon).toEqual({ ran: false, reason: 'recently-completed' });
    expect(dbUnified.__rows('events')[1]).not.toHaveProperty('expiresAt');

    const later = await retention.runProfileViewExpiryBackfill({
      ...options,
      env: {},
      nowMs: NOW + 8 * DAY_MS,
    });
    expect(later.ran).toBe(true);
    expect(dbUnified.__rows('events')[1].expiresAt).toBeInstanceOf(Date);
  });

  it('PROFILE_VIEW_RETENTION_BACKFILL=off does not touch the database; =force ignores the record', async () => {
    dbUnified.__reset({ events: [oldEvent(1)] });
    const off = await retention.runProfileViewExpiryBackfill({
      ...options,
      env: { PROFILE_VIEW_RETENTION_BACKFILL: 'off' },
    });
    expect(off).toEqual({ ran: false, reason: 'disabled' });
    expect(dbUnified.findWithOptions).not.toHaveBeenCalled();
    expect(dbUnified.__rows('events')[0]).not.toHaveProperty('expiresAt');

    await retention.runProfileViewExpiryBackfill({ ...options, env: {} });
    dbUnified.__rows('events').push(oldEvent(2, { _id: 99 }));
    const forced = await retention.runProfileViewExpiryBackfill({
      ...options,
      env: { PROFILE_VIEW_RETENTION_BACKFILL: 'force' },
    });
    expect(forced.ran).toBe(true);
    expect(dbUnified.__rows('events')[1].expiresAt).toBeInstanceOf(Date);
  });

  it('never throws: a failing read is logged as a warning and no completion is recorded', async () => {
    dbUnified.findWithOptions.mockRejectedValueOnce(new Error('db down'));

    const result = await retention.runProfileViewExpiryBackfill({ ...options, env: {} });

    expect(result).toEqual({ ran: false, reason: 'error' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('backfill failed'), 'db down');
    expect(dbUnified.__rows(retention.MARKER_COLLECTION)).toHaveLength(0);
  });

  it('does not record completion when the run stalled, so the next start-up tries again', async () => {
    dbUnified.__reset({
      events: [localEvent(1)],
    });
    dbUnified.__failUpdates(true);

    const result = await retention.runProfileViewExpiryBackfill({ ...options, env: {} });

    expect(result.ran).toBe(true);
    expect(result.totals.stalled).toBe(true);
    expect(dbUnified.__rows(retention.MARKER_COLLECTION)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('stopped early'));
  });
});

describe('startProfileViewExpiryBackfill', () => {
  test('does nothing under the test suite, so no test ever starts a background scan', () => {
    const retention = require('../../utils/profileViewRetention');
    const spy = jest.spyOn(global, 'setImmediate');
    try {
      expect(process.env.NODE_ENV).toBe('test');
      expect(retention.startProfileViewExpiryBackfill()).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('server.js starts it with one plain call and no condition of its own', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(source).toContain(
      "require('./utils/profileViewRetention').startProfileViewExpiryBackfill();"
    );
  });
});
