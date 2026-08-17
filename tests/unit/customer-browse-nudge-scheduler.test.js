'use strict';

/**
 * services/customerBrowseNudgeScheduler.js
 *
 * Regression coverage for: customers who saved a supplier but never
 * enquired had no re-engagement path at all — savedItems and quoteRequests
 * were never cross-referenced.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../utils/postmark', () => ({
  sendMarketingEmail: jest.fn(),
}));
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({
    cancel: jest.fn(),
    nextInvocation: jest.fn(() => new Date('2026-01-01T10:15:00.000Z')),
  })),
}));

const schedule = require('node-schedule');
const dbUnified = require('../../db-unified');
const postmark = require('../../utils/postmark');
const scheduler = require('../../services/customerBrowseNudgeScheduler');
const { isEligibleForNudge, resolveNudgeSuppliers, runBrowseNudges } = scheduler;

function buildCustomer(overrides = {}) {
  return { id: 'cust_1', email: 'cust@example.com', role: 'customer', ...overrides };
}

describe('isEligibleForNudge', () => {
  const now = Date.now();

  it('is eligible for a customer with no prior nudge state', () => {
    expect(isEligibleForNudge(buildCustomer(), now)).toBe(true);
  });

  it('is not eligible for suppliers', () => {
    expect(isEligibleForNudge(buildCustomer({ role: 'supplier' }), now)).toBe(false);
  });

  it('is not eligible for a globally-suppressed address', () => {
    expect(isEligibleForNudge(buildCustomer({ emailUnsubscribed: true }), now)).toBe(false);
  });

  it('is not eligible when opted out specifically', () => {
    expect(isEligibleForNudge(buildCustomer({ browseNudgeOptOut: true }), now)).toBe(false);
  });

  it('is not eligible within 30 days of the last nudge', () => {
    const user = buildCustomer({
      browseNudgeState: { lastSentAt: new Date(now - 10 * ONE_DAY_MS).toISOString() },
    });
    expect(isEligibleForNudge(user, now)).toBe(false);
  });

  it('is eligible again after 30 days', () => {
    const user = buildCustomer({
      browseNudgeState: { lastSentAt: new Date(now - 31 * ONE_DAY_MS).toISOString() },
    });
    expect(isEligibleForNudge(user, now)).toBe(true);
  });

  it('is not eligible once the lifetime cap of 4 is reached', () => {
    const user = buildCustomer({
      browseNudgeState: {
        remindersSent: [1, 2, 3, 4].map(n => new Date(now - n * 60 * ONE_DAY_MS).toISOString()),
      },
    });
    expect(isEligibleForNudge(user, now)).toBe(false);
  });
});

describe('resolveNudgeSuppliers', () => {
  const now = Date.now();

  it('resolves a supplier saved directly within the lookback window', () => {
    const savedItems = [
      {
        userId: 'cust_1',
        itemType: 'supplier',
        itemId: 'sup_1',
        savedAt: new Date(now - 5 * ONE_DAY_MS).toISOString(),
      },
    ];
    const suppliers = [{ id: 'sup_1', name: 'Acme Catering' }];

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems,
      suppliers,
      packages: [],
      enquiredSupplierIds: new Set(),
      now,
    });

    expect(result).toEqual([{ id: 'sup_1', name: 'Acme Catering' }]);
  });

  it('resolves the supplier behind a saved package', () => {
    const savedItems = [
      {
        userId: 'cust_1',
        itemType: 'package',
        itemId: 'pkg_1',
        savedAt: new Date(now - 5 * ONE_DAY_MS).toISOString(),
      },
    ];
    const packages = [{ id: 'pkg_1', supplierId: 'sup_1' }];
    const suppliers = [{ id: 'sup_1', name: 'Acme Catering' }];

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems,
      suppliers,
      packages,
      enquiredSupplierIds: new Set(),
      now,
    });

    expect(result.map(s => s.id)).toEqual(['sup_1']);
  });

  it('excludes a save outside the 3-14 day lookback window', () => {
    const tooRecent = [
      {
        userId: 'cust_1',
        itemType: 'supplier',
        itemId: 'sup_1',
        savedAt: new Date(now - 1 * ONE_DAY_MS).toISOString(),
      },
    ];
    const tooOld = [
      {
        userId: 'cust_1',
        itemType: 'supplier',
        itemId: 'sup_2',
        savedAt: new Date(now - 30 * ONE_DAY_MS).toISOString(),
      },
    ];
    const suppliers = [
      { id: 'sup_1', name: 'Too Recent' },
      { id: 'sup_2', name: 'Too Old' },
    ];

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems: [...tooRecent, ...tooOld],
      suppliers,
      packages: [],
      enquiredSupplierIds: new Set(),
      now,
    });

    expect(result).toEqual([]);
  });

  it('excludes a supplier the customer already enquired about', () => {
    const savedItems = [
      {
        userId: 'cust_1',
        itemType: 'supplier',
        itemId: 'sup_1',
        savedAt: new Date(now - 5 * ONE_DAY_MS).toISOString(),
      },
    ];
    const suppliers = [{ id: 'sup_1', name: 'Acme Catering' }];

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems,
      suppliers,
      packages: [],
      enquiredSupplierIds: new Set(['sup_1']),
      now,
    });

    expect(result).toEqual([]);
  });

  it('excludes a supplier that no longer exists or was removed', () => {
    const savedItems = [
      {
        userId: 'cust_1',
        itemType: 'supplier',
        itemId: 'sup_deleted',
        savedAt: new Date(now - 5 * ONE_DAY_MS).toISOString(),
      },
    ];

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems,
      suppliers: [{ id: 'sup_deleted', name: 'Gone', deleted: true }],
      packages: [],
      enquiredSupplierIds: new Set(),
      now,
    });

    expect(result).toEqual([]);
  });

  it('caps at 3 suppliers, most recently saved first', () => {
    const savedItems = ['sup_a', 'sup_b', 'sup_c', 'sup_d'].map((id, idx) => ({
      userId: 'cust_1',
      itemType: 'supplier',
      itemId: id,
      savedAt: new Date(now - (5 + idx) * ONE_DAY_MS).toISOString(),
    }));
    const suppliers = ['sup_a', 'sup_b', 'sup_c', 'sup_d'].map(id => ({ id, name: id }));

    const result = resolveNudgeSuppliers({
      userId: 'cust_1',
      savedItems,
      suppliers,
      packages: [],
      enquiredSupplierIds: new Set(),
      now,
    });

    expect(result.map(s => s.id)).toEqual(['sup_a', 'sup_b', 'sup_c']);
  });
});

describe('runBrowseNudges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postmark.sendMarketingEmail.mockResolvedValue({});
    dbUnified.updateOne.mockResolvedValue(true);
  });

  it('sends a nudge to an eligible customer with a saved unconverted supplier', async () => {
    const savedAt = new Date(Date.now() - 5 * ONE_DAY_MS).toISOString();
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return [buildCustomer()];
      }
      if (collection === 'savedItems') {
        return [{ userId: 'cust_1', itemType: 'supplier', itemId: 'sup_1', savedAt }];
      }
      if (collection === 'suppliers') {
        return [{ id: 'sup_1', name: 'Acme Catering' }];
      }
      if (collection === 'packages') {
        return [];
      }
      if (collection === 'quoteRequests') {
        return [];
      }
      return [];
    });

    const result = await runBrowseNudges();

    expect(result).toEqual({ scanned: 1, eligible: 1, sent: 1, errors: 0 });
    expect(postmark.sendMarketingEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cust_1' }),
      expect.any(String),
      expect.stringContaining('Acme Catering'),
      expect.objectContaining({ tags: ['browse_nudge'] })
    );
  });

  it('skips a customer with no eligible saved suppliers', async () => {
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return [buildCustomer()];
      }
      return [];
    });

    const result = await runBrowseNudges();

    expect(result).toEqual({ scanned: 1, eligible: 0, sent: 0, errors: 0 });
    expect(postmark.sendMarketingEmail).not.toHaveBeenCalled();
  });

  it('excludes a supplier the customer already enquired about as a guest under the same email', async () => {
    // routes/quote-requests.js allows an unauthenticated quote request
    // (userId null, email always set) — a customer who enquired as a guest
    // and later saved the same supplier under an account with that email
    // must still be excluded, not just userId-matched enquiries.
    const savedAt = new Date(Date.now() - 5 * ONE_DAY_MS).toISOString();
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return [buildCustomer({ email: 'Cust@Example.com' })];
      }
      if (collection === 'savedItems') {
        return [{ userId: 'cust_1', itemType: 'supplier', itemId: 'sup_1', savedAt }];
      }
      if (collection === 'suppliers') {
        return [{ id: 'sup_1', name: 'Acme Catering' }];
      }
      if (collection === 'quoteRequests') {
        return [{ userId: null, email: 'cust@example.com', suppliers: [{ supplierId: 'sup_1' }] }];
      }
      return [];
    });

    const result = await runBrowseNudges();

    expect(result).toEqual({ scanned: 1, eligible: 0, sent: 0, errors: 0 });
    expect(postmark.sendMarketingEmail).not.toHaveBeenCalled();
  });

  it('escapes a user-supplied display name before splicing it into the raw HTML body', async () => {
    const savedAt = new Date(Date.now() - 5 * ONE_DAY_MS).toISOString();
    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return [buildCustomer({ name: '<img src=x onerror=alert(1)>' })];
      }
      if (collection === 'savedItems') {
        return [{ userId: 'cust_1', itemType: 'supplier', itemId: 'sup_1', savedAt }];
      }
      if (collection === 'suppliers') {
        return [{ id: 'sup_1', name: 'Acme Catering' }];
      }
      if (collection === 'quoteRequests') {
        return [];
      }
      return [];
    });

    await runBrowseNudges();

    const [, , message] = postmark.sendMarketingEmail.mock.calls[0];
    expect(message).not.toContain('<img');
    expect(message).toContain('&lt;img');
  });
});

describe('start()/stop()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.BROWSE_NUDGE_ENABLED;

  afterEach(() => {
    jest.clearAllMocks();
    scheduler.stop();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnabled === undefined) {
      delete process.env.BROWSE_NUDGE_ENABLED;
    } else {
      process.env.BROWSE_NUDGE_ENABLED = originalEnabled;
    }
  });

  it('is disabled by default outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.BROWSE_NUDGE_ENABLED;

    const result = scheduler.start();

    expect(schedule.scheduleJob).not.toHaveBeenCalled();
    expect(result).toEqual({ scheduled: false, nextRun: null });
  });

  it('schedules a daily job when explicitly enabled', () => {
    process.env.BROWSE_NUDGE_ENABLED = 'true';

    const result = scheduler.start();

    expect(schedule.scheduleJob).toHaveBeenCalledWith(
      { rule: '15 10 * * *', tz: 'Etc/UTC' },
      expect.any(Function)
    );
    expect(result).toEqual({ scheduled: true, nextRun: new Date('2026-01-01T10:15:00.000Z') });
  });

  it('stop() cancels the scheduled job', () => {
    process.env.BROWSE_NUDGE_ENABLED = 'true';
    scheduler.start();
    const job = schedule.scheduleJob.mock.results[0].value;

    scheduler.stop();

    expect(job.cancel).toHaveBeenCalledTimes(1);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
