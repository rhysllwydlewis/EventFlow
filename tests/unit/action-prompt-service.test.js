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
  computeFullReport,
  evaluateCadence,
  getSupplierActionItems,
  INITIAL_DELAY_MS,
  SECOND_SEND_DELAY_MS,
  MONTHLY_DELAY_MS,
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
    photosGallery: [{ url: '/img/1.jpg' }], // has photos by default
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

  it('returns missingPackages action with severity red', () => {
    const actions = computeActions(makeSupplier(), [], makeSettings(), makeUser());
    const pkg = actions.find(a => a.key === 'missingPackages');
    expect(pkg).toBeDefined();
    expect(pkg.severity).toBe('red');
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

  it('incompleteProfile action has severity amber', () => {
    const incompleteSupplier = makeSupplier({ description_short: '' });
    const actions = computeActions(incompleteSupplier, [makePackage()], makeSettings(), makeUser());
    const prof = actions.find(a => a.key === 'incompleteProfile');
    expect(prof.severity).toBe('amber');
  });

  it('does not return incompleteProfile when all required fields present', () => {
    const actions = computeActions(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(false);
  });

  it('returns both actions when supplier has 0 packages and incomplete profile', () => {
    const incompleteSupplier = makeSupplier({ description_short: '' });
    const actions = computeActions(incompleteSupplier, [], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'missingPackages')).toBe(true);
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(true);
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

// ── computeFullReport ────────────────────────────────────────────────────────

describe('computeFullReport', () => {
  it('returns outstanding missingPackages and completed profileComplete + hasPhotos', () => {
    const report = computeFullReport(makeSupplier(), [], makeSettings(), makeUser());
    expect(report.outstanding.some(a => a.key === 'missingPackages')).toBe(true);
    expect(report.completed.some(a => a.key === 'profileComplete')).toBe(true);
    expect(report.completed.some(a => a.key === 'hasPhotos')).toBe(true);
  });

  it('ragStatus is red when missingPackages outstanding', () => {
    const report = computeFullReport(makeSupplier(), [], makeSettings(), makeUser());
    expect(report.ragStatus).toBe('red');
  });

  it('ragStatus is amber when only amber items outstanding', () => {
    const supplier = makeSupplier({ description_short: '' });
    const report = computeFullReport(supplier, [makePackage()], makeSettings(), makeUser());
    expect(report.ragStatus).toBe('amber');
  });

  it('ragStatus is green when nothing outstanding', () => {
    const report = computeFullReport(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(report.ragStatus).toBe('green');
  });

  it('completionPercent is 0 when all outstanding', () => {
    // No packages, incomplete profile, no photos
    const supplier = makeSupplier({ description_short: '', photosGallery: [] });
    const report = computeFullReport(supplier, [], makeSettings(), makeUser());
    expect(report.completionPercent).toBe(0);
  });

  it('completionPercent is 100 when everything done', () => {
    const report = computeFullReport(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(report.completionPercent).toBe(100);
  });

  it('completionPercent is proportional', () => {
    // 2 outstanding (missingPackages + missingPhotos), 1 completed (profileComplete)
    const supplier = makeSupplier({ photosGallery: [] });
    const report = computeFullReport(supplier, [], makeSettings(), makeUser());
    expect(report.completionPercent).toBe(33); // 1/3
  });
});

// ── evaluateCadence ──────────────────────────────────────────────────────────

describe('evaluateCadence', () => {
  const now = new Date('2024-01-01T09:00:00Z');

  it('does NOT send on first call (no state) — schedules for tomorrow', () => {
    const { shouldSend, nextState } = evaluateCadence(undefined, now);
    expect(shouldSend).toBe(false);
    expect(nextState.sendCount).toBe(0);
    expect(nextState.firstOutstandingAt).toBe(now.toISOString());
    const expectedNext = new Date(now.getTime() + INITIAL_DELAY_MS).toISOString();
    expect(nextState.nextSendAt).toBe(expectedNext);
  });

  it('does not send before nextSendAt', () => {
    const state = {
      sendCount: 0,
      nextSendAt: new Date(now.getTime() + INITIAL_DELAY_MS).toISOString(),
      firstOutstandingAt: now.toISOString(),
    };
    const laterDate = new Date(now.getTime() + INITIAL_DELAY_MS / 2);
    const { shouldSend } = evaluateCadence(state, laterDate);
    expect(shouldSend).toBe(false);
  });

  it('sends when nextSendAt is in the past', () => {
    const state = {
      sendCount: 0,
      lastSentAt: null,
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - INITIAL_DELAY_MS).toISOString(),
    };
    const { shouldSend } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
  });

  it('after 1st send: sendCount becomes 1, next send at firstOutstandingAt + 7 days', () => {
    const firstOutstandingAt = new Date('2024-01-01T09:00:00Z');
    const oneDayLater = new Date(firstOutstandingAt.getTime() + INITIAL_DELAY_MS);
    const state = {
      sendCount: 0,
      lastSentAt: null,
      nextSendAt: firstOutstandingAt.toISOString(),
      firstOutstandingAt: firstOutstandingAt.toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, oneDayLater);
    expect(shouldSend).toBe(true);
    expect(nextState.sendCount).toBe(1);
    expect(nextState.cadence).toBe('weekly');
    // Next send should be firstOutstandingAt + 7 days
    const expected = new Date(firstOutstandingAt.getTime() + SECOND_SEND_DELAY_MS).toISOString();
    expect(nextState.nextSendAt).toBe(expected);
  });

  it('after 2nd send: sendCount becomes 2, next send monthly from lastSentAt', () => {
    const firstOutstandingAt = new Date('2024-01-01T09:00:00Z');
    const oneWeekLater = new Date(firstOutstandingAt.getTime() + SECOND_SEND_DELAY_MS);
    const state = {
      sendCount: 1,
      lastSentAt: new Date(firstOutstandingAt.getTime() + INITIAL_DELAY_MS).toISOString(),
      nextSendAt: oneWeekLater.toISOString(),
      firstOutstandingAt: firstOutstandingAt.toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, oneWeekLater);
    expect(shouldSend).toBe(true);
    expect(nextState.sendCount).toBe(2);
    expect(nextState.cadence).toBe('monthly');
    const expected = new Date(oneWeekLater.getTime() + MONTHLY_DELAY_MS).toISOString();
    expect(nextState.nextSendAt).toBe(expected);
  });

  it('stays monthly indefinitely after 2+ sends', () => {
    const state = {
      sendCount: 5,
      cadence: 'monthly',
      lastSentAt: new Date(now.getTime() - MONTHLY_DELAY_MS - 1000).toISOString(),
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('monthly');
    expect(nextState.sendCount).toBe(6);
  });

  it('firstOutstandingAt is preserved through sends', () => {
    const firstOutstandingAt = '2024-01-01T09:00:00.000Z';
    const state = {
      sendCount: 0,
      nextSendAt: new Date(now.getTime() - 1).toISOString(),
      firstOutstandingAt,
    };
    const { nextState } = evaluateCadence(state, now);
    expect(nextState.firstOutstandingAt).toBe(firstOutstandingAt);
  });
});

// ── getSupplierActionItems ───────────────────────────────────────────────────

describe('getSupplierActionItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupDb({ settings, users, suppliers, packages }) {
    dbUnified.read.mockImplementation(collection => {
      if (collection === 'settings') return Promise.resolve(settings);
      if (collection === 'users') return Promise.resolve(users);
      if (collection === 'suppliers') return Promise.resolve(suppliers);
      if (collection === 'packages') return Promise.resolve(packages);
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

  it('returns empty array when email automation is not yet configured (explicit opt-in required)', async () => {
    setupDb({
      settings: {},
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
    expect(items[0].report.outstanding.some(a => a.key === 'missingPackages')).toBe(true);
  });

  it('includes all relevant actions in one report item', async () => {
    const incompleteSupplier = makeSupplier({ description_short: '', photosGallery: [] });
    setupDb({
      settings: makeSettings(),
      users: [makeUser()],
      suppliers: [incompleteSupplier],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
    expect(items[0].report.outstanding.length).toBeGreaterThan(1);
  });

  it('report includes ragStatus', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser()],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items[0].report.ragStatus).toBe('red'); // missing packages = red
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
