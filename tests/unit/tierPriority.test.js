'use strict';

const {
  TIER_TO_PRIORITY,
  PRIORITY_RANK,
  tierDisplayLabel,
  resolveSupplierTierFromRecord,
  deriveTicketPriority,
} = require('../../utils/tierPriority');

describe('TIER_TO_PRIORITY mapping', () => {
  it('maps pro_plus to urgent', () => {
    expect(TIER_TO_PRIORITY.pro_plus).toBe('urgent');
  });

  it('maps pro to high', () => {
    expect(TIER_TO_PRIORITY.pro).toBe('high');
  });

  it('maps free to medium', () => {
    expect(TIER_TO_PRIORITY.free).toBe('medium');
  });
});

describe('PRIORITY_RANK ordering', () => {
  it('urgent has the highest rank', () => {
    expect(PRIORITY_RANK.urgent).toBeGreaterThan(PRIORITY_RANK.high);
  });

  it('high ranks above medium', () => {
    expect(PRIORITY_RANK.high).toBeGreaterThan(PRIORITY_RANK.medium);
  });

  it('medium ranks above low', () => {
    expect(PRIORITY_RANK.medium).toBeGreaterThan(PRIORITY_RANK.low);
  });
});

describe('tierDisplayLabel', () => {
  it('returns "Pro Plus" for pro_plus', () => {
    expect(tierDisplayLabel('pro_plus')).toBe('Pro Plus');
  });

  it('returns "Pro" for pro', () => {
    expect(tierDisplayLabel('pro')).toBe('Pro');
  });

  it('returns "Starter" for free', () => {
    expect(tierDisplayLabel('free')).toBe('Starter');
  });

  it('defaults to "Starter" for unknown tiers', () => {
    expect(tierDisplayLabel('enterprise')).toBe('Starter');
    expect(tierDisplayLabel(undefined)).toBe('Starter');
  });
});

describe('resolveSupplierTierFromRecord', () => {
  it('returns "free" when supplier is null', () => {
    expect(resolveSupplierTierFromRecord(null)).toBe('free');
  });

  it('returns "free" when supplier has no subscription', () => {
    expect(resolveSupplierTierFromRecord({})).toBe('free');
  });

  it('returns "pro_plus" for an active pro_plus subscription', () => {
    const supplier = {
      subscription: { tier: 'pro_plus', status: 'active' },
    };
    expect(resolveSupplierTierFromRecord(supplier)).toBe('pro_plus');
  });

  it('returns "pro" for an active pro subscription', () => {
    const supplier = {
      subscription: { tier: 'pro', status: 'active' },
    };
    expect(resolveSupplierTierFromRecord(supplier)).toBe('pro');
  });

  it('returns "pro_plus" for a trial pro_plus subscription', () => {
    const supplier = {
      subscription: { tier: 'pro_plus', status: 'trial' },
    };
    expect(resolveSupplierTierFromRecord(supplier)).toBe('pro_plus');
  });

  it('returns "free" for an expired/cancelled subscription', () => {
    const supplier = {
      subscription: { tier: 'pro', status: 'cancelled' },
    };
    expect(resolveSupplierTierFromRecord(supplier)).toBe('free');
  });

  it('falls back to subscriptionTier field when subscription object is absent', () => {
    expect(resolveSupplierTierFromRecord({ subscriptionTier: 'pro_plus' })).toBe('pro_plus');
    expect(resolveSupplierTierFromRecord({ subscriptionTier: 'pro' })).toBe('pro');
  });

  it('falls back to isPro boolean when no subscription object or field', () => {
    expect(resolveSupplierTierFromRecord({ isPro: true })).toBe('pro');
  });

  it('returns "free" when isPro is false and no subscription', () => {
    expect(resolveSupplierTierFromRecord({ isPro: false })).toBe('free');
  });
});

describe('deriveTicketPriority', () => {
  function makeDb(suppliers = []) {
    return { read: jest.fn().mockResolvedValue(suppliers) };
  }

  it('returns medium priority for customers (no paid tier)', async () => {
    const db = makeDb();
    const result = await deriveTicketPriority('customer', 'user-1', db);

    expect(result.priority).toBe('medium');
    expect(result.accountTier).toBe('free');
    expect(result.prioritySource).toBe('auto');
    // Customers should not need to query suppliers
    expect(db.read).not.toHaveBeenCalled();
  });

  it('returns urgent priority for a pro_plus supplier', async () => {
    const db = makeDb([
      {
        userId: 'sup-1',
        subscription: { tier: 'pro_plus', status: 'active' },
      },
    ]);
    const result = await deriveTicketPriority('supplier', 'sup-1', db);

    expect(result.priority).toBe('urgent');
    expect(result.accountTier).toBe('pro_plus');
    expect(result.prioritySource).toBe('auto');
  });

  it('returns high priority for a pro supplier', async () => {
    const db = makeDb([
      {
        userId: 'sup-2',
        subscription: { tier: 'pro', status: 'active' },
      },
    ]);
    const result = await deriveTicketPriority('supplier', 'sup-2', db);

    expect(result.priority).toBe('high');
    expect(result.accountTier).toBe('pro');
    expect(result.prioritySource).toBe('auto');
  });

  it('returns medium priority for a free supplier', async () => {
    const db = makeDb([
      {
        userId: 'sup-3',
        subscription: { tier: 'free', status: 'active' },
      },
    ]);
    const result = await deriveTicketPriority('supplier', 'sup-3', db);

    expect(result.priority).toBe('medium');
    expect(result.accountTier).toBe('free');
    expect(result.prioritySource).toBe('auto');
  });

  it('returns medium priority when supplier record is not found', async () => {
    const db = makeDb([]); // empty suppliers list
    const result = await deriveTicketPriority('supplier', 'unknown-user', db);

    expect(result.priority).toBe('medium');
    expect(result.accountTier).toBe('free');
    expect(result.prioritySource).toBe('auto');
  });

  it('returns medium priority when supplier has an expired subscription', async () => {
    const db = makeDb([
      {
        userId: 'sup-4',
        subscription: { tier: 'pro_plus', status: 'cancelled' },
      },
    ]);
    const result = await deriveTicketPriority('supplier', 'sup-4', db);

    expect(result.priority).toBe('medium');
    expect(result.accountTier).toBe('free');
    expect(result.prioritySource).toBe('auto');
  });

  it('falls back to medium priority if the db.read call throws', async () => {
    const db = { read: jest.fn().mockRejectedValue(new Error('DB error')) };
    const result = await deriveTicketPriority('supplier', 'sup-5', db);

    expect(result.priority).toBe('medium');
    expect(result.accountTier).toBe('free');
    expect(result.prioritySource).toBe('auto');
  });

  it('finds supplier by ownerId as a fallback field', async () => {
    const db = makeDb([
      {
        ownerId: 'sup-6',
        subscription: { tier: 'pro', status: 'trial' },
      },
    ]);
    const result = await deriveTicketPriority('supplier', 'sup-6', db);

    expect(result.priority).toBe('high');
    expect(result.accountTier).toBe('pro');
  });
});
