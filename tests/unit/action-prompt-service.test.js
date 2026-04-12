/**
 * Unit tests for services/actionPromptService
 * Tests action detection, preference filtering, cadence escalation, and verified-only constraint.
 */
'use strict';

// Mock db-unified before requiring the service
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  updateOne: jest.fn().mockResolvedValue(true),
}));

const dbUnified = require('../../db-unified');
const {
  computeActions,
  evaluateCadence,
  getSupplierActionItems,
  DAILY_TO_WEEKLY_THRESHOLD,
  WEEKLY_TO_MONTHLY_THRESHOLD,
  CADENCE_GAP_MS,
} = require('../../services/actionPromptService');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'supplier@test.com',
    firstName: 'Test',
    role: 'supplier',
    verified: true,
    notify: true,
    ...overrides,
  };
}

function makeSupplier(overrides = {}) {
  return {
    id: 's1',
    ownerUserId: 'u1',
    name: 'Test Supplier',
    description_short: 'A great supplier',
    location: 'London',
    email: 'supplier@test.com',
    ...overrides,
  };
}

function makePackage(overrides = {}) {
  return { id: 'p1', supplierId: 's1', name: 'Package 1', ...overrides };
}

function makeSettings(overrides = {}) {
  return {
    emailAutomation: {
      actionPrompts: {
        enabled: true,
        promptTypes: { missingPackages: true, incompleteProfile: true },
        ...overrides,
      },
    },
  };
}

// ── computeActions ───────────────────────────────────────────────────────────

describe('computeActions', () => {
  it('returns missingPackages action when supplier has 0 packages', () => {
    const actions = computeActions(makeSupplier(), [], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'missingPackages')).toBe(true);
  });

  it('does not return missingPackages when supplier has packages', () => {
    const actions = computeActions(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'missingPackages')).toBe(false);
  });

  it('returns incompleteProfile when required fields are missing', () => {
    const incompleteSupplier = makeSupplier({ description_short: '' });
    const actions = computeActions(incompleteSupplier, [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(true);
  });

  it('does not return incompleteProfile when all required fields present', () => {
    const actions = computeActions(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(false);
  });

  it('returns both actions when supplier has 0 packages and incomplete profile', () => {
    const incompleteSupplier = makeSupplier({ description_short: '' });
    const actions = computeActions(incompleteSupplier, [], makeSettings(), makeUser());
    expect(actions.length).toBe(2);
  });

  it('returns empty array when all is good', () => {
    const actions = computeActions(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(actions.length).toBe(0);
  });

  it('respects global missingPackages disable', () => {
    const settings = makeSettings({
      promptTypes: { missingPackages: false, incompleteProfile: true },
    });
    const actions = computeActions(makeSupplier(), [], settings, makeUser());
    expect(actions.some(a => a.key === 'missingPackages')).toBe(false);
  });

  it('respects global incompleteProfile disable', () => {
    const settings = makeSettings({
      promptTypes: { missingPackages: true, incompleteProfile: false },
    });
    const supplier = makeSupplier({ description_short: '' });
    const actions = computeActions(supplier, [makePackage()], settings, makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(false);
  });

  it('treats missing user pref fields as enabled (default ON)', () => {
    const userNoPref = makeUser({ emailPrefs: undefined });
    const actions = computeActions(makeSupplier(), [], makeSettings(), userNoPref);
    expect(actions.some(a => a.key === 'missingPackages')).toBe(true);
  });

  it('respects user missingPackages opt-out', () => {
    const user = makeUser({
      emailPrefs: {
        actionPrompts: { enabled: true, missingPackages: false, incompleteProfile: true },
      },
    });
    const actions = computeActions(makeSupplier(), [], makeSettings(), user);
    expect(actions.some(a => a.key === 'missingPackages')).toBe(false);
  });

  it('respects user incompleteProfile opt-out', () => {
    const user = makeUser({
      emailPrefs: {
        actionPrompts: { enabled: true, missingPackages: true, incompleteProfile: false },
      },
    });
    const supplier = makeSupplier({ description_short: '' });
    const actions = computeActions(supplier, [makePackage()], makeSettings(), user);
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(false);
  });
});

// ── evaluateCadence ──────────────────────────────────────────────────────────

describe('evaluateCadence', () => {
  const now = new Date('2024-01-01T09:00:00Z');

  it('sends on first call (no state)', () => {
    const { shouldSend, nextState } = evaluateCadence(undefined, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('daily');
    expect(nextState.dailySendsCount).toBe(1);
  });

  it('does not send before nextSendAt', () => {
    const state = {
      cadence: 'daily',
      dailySendsCount: 1,
      weeklySendsCount: 0,
      lastSentAt: now.toISOString(),
      nextSendAt: new Date(now.getTime() + CADENCE_GAP_MS.daily).toISOString(),
    };
    const laterDate = new Date(now.getTime() + CADENCE_GAP_MS.daily / 2); // still half-day away
    const { shouldSend } = evaluateCadence(state, laterDate);
    expect(shouldSend).toBe(false);
  });

  it('sends when nextSendAt is in the past', () => {
    const state = {
      cadence: 'daily',
      dailySendsCount: 3,
      weeklySendsCount: 0,
      lastSentAt: new Date(now.getTime() - CADENCE_GAP_MS.daily - 1000).toISOString(),
      nextSendAt: new Date(now.getTime() - 1000).toISOString(), // 1 second in the past
    };
    const { shouldSend } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
  });

  it(`escalates from daily to weekly after ${DAILY_TO_WEEKLY_THRESHOLD} daily sends`, () => {
    const state = {
      cadence: 'daily',
      dailySendsCount: DAILY_TO_WEEKLY_THRESHOLD - 1,
      weeklySendsCount: 0,
      nextSendAt: new Date(now.getTime() - 1).toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('weekly');
  });

  it(`escalates from weekly to monthly after ${WEEKLY_TO_MONTHLY_THRESHOLD} weekly sends`, () => {
    const state = {
      cadence: 'weekly',
      dailySendsCount: DAILY_TO_WEEKLY_THRESHOLD,
      weeklySendsCount: WEEKLY_TO_MONTHLY_THRESHOLD - 1,
      nextSendAt: new Date(now.getTime() - 1).toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('monthly');
  });

  it('stays monthly indefinitely', () => {
    const state = {
      cadence: 'monthly',
      dailySendsCount: 10,
      weeklySendsCount: 10,
      nextSendAt: new Date(now.getTime() - 1).toISOString(),
    };
    const { nextState } = evaluateCadence(state, now);
    expect(nextState.cadence).toBe('monthly');
  });

  it('sets nextSendAt based on the new cadence gap', () => {
    const { nextState } = evaluateCadence(undefined, now);
    const expected = new Date(now.getTime() + CADENCE_GAP_MS.daily).toISOString();
    expect(nextState.nextSendAt).toBe(expected);
  });
});

// ── getSupplierActionItems ───────────────────────────────────────────────────

describe('getSupplierActionItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupDb({ settings, users, suppliers, packages }) {
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'settings') {
        return Promise.resolve(settings);
      }
      if (collection === 'users') {
        return Promise.resolve(users);
      }
      if (collection === 'suppliers') {
        return Promise.resolve(suppliers);
      }
      if (collection === 'packages') {
        return Promise.resolve(packages);
      }
      return Promise.resolve([]);
    });
  }

  it('returns empty array when email automation is disabled globally', async () => {
    setupDb({
      settings: { emailAutomation: { actionPrompts: { enabled: false } } },
      users: [makeUser()],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('skips non-supplier users', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ role: 'customer' })],
      suppliers: [],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('skips unverified suppliers', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ verified: false })],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('skips suppliers who have opted out at master level', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ emailPrefs: { actionPrompts: { enabled: false } } })],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('skips suppliers with no outstanding actions', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser()],
      suppliers: [makeSupplier()],
      packages: [makePackage()],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('returns item for verified supplier with missing packages', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser()],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
    expect(items[0].actions.some(a => a.key === 'missingPackages')).toBe(true);
  });

  it('includes all relevant actions in one item', async () => {
    const incompleteSupplier = makeSupplier({ description_short: '' });
    setupDb({
      settings: makeSettings(),
      users: [makeUser()],
      suppliers: [incompleteSupplier],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
    expect(items[0].actions.length).toBeGreaterThan(1);
  });

  it('treats missing emailPrefs as enabled (default ON)', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ emailPrefs: undefined })],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
  });

  it('only sends to verified suppliers', async () => {
    setupDb({
      settings: makeSettings(),
      users: [
        makeUser({ id: 'u1', verified: true }),
        makeUser({ id: 'u2', verified: false, email: 'unverified@test.com' }),
      ],
      suppliers: [
        makeSupplier({ id: 's1', ownerUserId: 'u1' }),
        makeSupplier({ id: 's2', ownerUserId: 'u2' }),
      ],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
    expect(items[0].user.id).toBe('u1');
  });
});
