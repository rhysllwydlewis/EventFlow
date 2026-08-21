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
  DAILY_INTERVAL_MS,
  WEEKLY_INTERVAL_MS,
  FIRST_MONTHLY_INTERVAL_MS,
  MONTHLY_INTERVAL_MS,
  DAILY_SENDS_BEFORE_WEEKLY,
  WEEKLY_SENDS_BEFORE_MONTHLY,
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
    basePostcode: 'SW1A 1AA',
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

  // Postcode drives real search/discovery matching (supplierLocation.service.js),
  // not just profile cosmetics, so a supplier with a location but no postcode
  // should keep getting nudged same as a missing name or description.
  it('returns incompleteProfile when location is set but postcode is missing', () => {
    const incompleteSupplier = makeSupplier({ basePostcode: undefined });
    const actions = computeActions(incompleteSupplier, [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(true);
  });

  it('accepts venuePostcode as satisfying the postcode requirement', () => {
    const supplier = makeSupplier({ basePostcode: undefined, venuePostcode: 'CF10 1AA' });
    const actions = computeActions(supplier, [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(false);
  });

  it('does not accept a bare `postcode` field, since no supplier-facing form ever writes one', () => {
    const supplier = makeSupplier({ basePostcode: undefined, postcode: 'CF10 1AA' });
    const actions = computeActions(supplier, [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'incompleteProfile')).toBe(true);
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

  it('returns missingPhotos action when supplier has no photos', () => {
    const noPhotosSupplier = makeSupplier({ photosGallery: [] });
    const actions = computeActions(noPhotosSupplier, [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'missingPhotos')).toBe(true);
  });

  it('missingPhotos action has severity amber', () => {
    const noPhotosSupplier = makeSupplier({ photosGallery: [] });
    const actions = computeActions(noPhotosSupplier, [makePackage()], makeSettings(), makeUser());
    const photo = actions.find(a => a.key === 'missingPhotos');
    expect(photo.severity).toBe('amber');
  });

  it('does not return missingPhotos when supplier has photos only under the legacy images alias', () => {
    const legacyPhotosSupplier = makeSupplier({
      photosGallery: [],
      images: ['legacy-a.jpg', 'legacy-b.jpg'],
    });
    const actions = computeActions(
      legacyPhotosSupplier,
      [makePackage()],
      makeSettings(),
      makeUser()
    );
    expect(actions.some(a => a.key === 'missingPhotos')).toBe(false);
  });

  it('does not return missingPhotos when supplier has photos', () => {
    const actions = computeActions(makeSupplier(), [makePackage()], makeSettings(), makeUser());
    expect(actions.some(a => a.key === 'missingPhotos')).toBe(false);
  });

  it('respects global missingPhotos disable', () => {
    const settings = makeSettings({
      promptTypes: { missingPackages: true, incompleteProfile: true, missingPhotos: false },
    });
    const noPhotosSupplier = makeSupplier({ photosGallery: [] });
    const actions = computeActions(noPhotosSupplier, [makePackage()], settings, makeUser());
    expect(actions.some(a => a.key === 'missingPhotos')).toBe(false);
  });

  it('respects user missingPhotos opt-out', () => {
    const user = makeUser({
      emailPrefs: {
        actionPrompts: {
          enabled: true,
          missingPackages: true,
          incompleteProfile: true,
          missingPhotos: false,
        },
      },
    });
    const noPhotosSupplier = makeSupplier({ photosGallery: [] });
    const actions = computeActions(noPhotosSupplier, [makePackage()], makeSettings(), user);
    expect(actions.some(a => a.key === 'missingPhotos')).toBe(false);
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

  it('uses exactly one daily-stage send and one weekly-stage send', () => {
    expect(DAILY_SENDS_BEFORE_WEEKLY).toBe(1);
    expect(WEEKLY_SENDS_BEFORE_MONTHLY).toBe(1);
  });

  it('does NOT send on first call (no state) — schedules the first reminder for 24 hours later', () => {
    const { shouldSend, nextState } = evaluateCadence(undefined, now);
    expect(shouldSend).toBe(false);
    expect(nextState.cadence).toBe('daily');
    expect(nextState.sendCountDaily).toBe(0);
    expect(nextState.sendCountWeekly).toBe(0);
    expect(nextState.sendCountMonthly).toBe(0);
    expect(nextState.firstOutstandingAt).toBe(now.toISOString());
    const expectedNext = new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString();
    expect(nextState.nextSendAt).toBe(expectedNext);
  });

  it('does not send before nextSendAt', () => {
    const state = {
      cadence: 'daily',
      sendCountDaily: 0,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: null,
      nextSendAt: new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: now.toISOString(),
    };
    const laterDate = new Date(now.getTime() + DAILY_INTERVAL_MS / 2);
    const { shouldSend } = evaluateCadence(state, laterDate);
    expect(shouldSend).toBe(false);
  });

  it('sends the first reminder when nextSendAt is due, then moves straight to weekly', () => {
    const state = {
      cadence: 'daily',
      sendCountDaily: 0,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: null,
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - DAILY_INTERVAL_MS).toISOString(),
    };
    const { shouldSend, nextState } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('weekly');
    expect(nextState.sendCountDaily).toBe(1);
    expect(nextState.nextSendAt).toBe(new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString());
  });

  it('sends one weekly follow-up, then moves to monthly with a 30-day wait', () => {
    const state = {
      cadence: 'weekly',
      sendCountDaily: 1,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: new Date(now.getTime() - WEEKLY_INTERVAL_MS).toISOString(),
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 8 * DAILY_INTERVAL_MS).toISOString(),
    };

    const { shouldSend, nextState } = evaluateCadence(state, now);
    expect(shouldSend).toBe(true);
    expect(nextState.cadence).toBe('monthly');
    expect(nextState.sendCountWeekly).toBe(1);
    expect(nextState.sendCountMonthly).toBe(0);
    expect(nextState.nextSendAt).toBe(
      new Date(now.getTime() + FIRST_MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('waits 30 days before the first monthly-stage reminder', () => {
    const lastSentAt = now.toISOString();
    const state = {
      cadence: 'monthly',
      sendCountDaily: 1,
      sendCountWeekly: 1,
      sendCountMonthly: 0,
      lastSentAt,
      nextSendAt: new Date(now.getTime() + FIRST_MONTHLY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 10 * DAILY_INTERVAL_MS).toISOString(),
    };

    const at28Days = new Date(now.getTime() + MONTHLY_INTERVAL_MS);
    const result = evaluateCadence(state, at28Days);
    expect(result.shouldSend).toBe(false);
    expect(result.nextState.cadence).toBe('monthly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + FIRST_MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('stays monthly indefinitely at 28-day intervals after the first monthly-stage send', () => {
    let state = {
      cadence: 'monthly',
      sendCountDaily: 1,
      sendCountWeekly: 1,
      sendCountMonthly: 1,
      lastSentAt: new Date(now.getTime() - MONTHLY_INTERVAL_MS - 1000).toISOString(),
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 180 * DAILY_INTERVAL_MS).toISOString(),
    };

    for (let i = 0; i < 3; i++) {
      const sendTime = new Date(new Date(state.nextSendAt).getTime() + 1);
      const result = evaluateCadence(state, sendTime);
      expect(result.shouldSend).toBe(true);
      state = result.nextState;
      expect(state.cadence).toBe('monthly');
      expect(state.sendCountMonthly).toBe(i + 2); // starts at 1
      const expectedNext = new Date(sendTime.getTime() + MONTHLY_INTERVAL_MS).toISOString();
      expect(state.nextSendAt).toBe(expectedNext);
    }
  });

  it('throttles an old daily-stage state after one send instead of sending again tomorrow', () => {
    const lastSentAt = now.toISOString();
    const state = {
      cadence: 'daily',
      sendCountDaily: 1,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt,
      // Old policy would have scheduled another email tomorrow.
      nextSendAt: new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - DAILY_INTERVAL_MS).toISOString(),
    };

    const tomorrow = new Date(now.getTime() + DAILY_INTERVAL_MS);
    const result = evaluateCadence(state, tomorrow);
    expect(result.shouldSend).toBe(false);
    expect(result.nextState.cadence).toBe('weekly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString()
    );
  });

  it('throttles an old weekly-stage state after one weekly send into the 30-day wait', () => {
    const lastSentAt = now.toISOString();
    const state = {
      cadence: 'weekly',
      sendCountDaily: 7,
      sendCountWeekly: 1,
      sendCountMonthly: 0,
      lastSentAt,
      // Old policy would have scheduled another weekly email.
      nextSendAt: new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 30 * DAILY_INTERVAL_MS).toISOString(),
    };

    const inAWeek = new Date(now.getTime() + WEEKLY_INTERVAL_MS);
    const result = evaluateCadence(state, inAWeek);
    expect(result.shouldSend).toBe(false);
    expect(result.nextState.cadence).toBe('monthly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + FIRST_MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('uses a 28-day recurring interval for existing monthly states that have already sent monthly', () => {
    const lastSentAt = now.toISOString();
    const state = {
      cadence: 'monthly',
      sendCountDaily: 7,
      sendCountWeekly: 4,
      sendCountMonthly: 2,
      lastSentAt,
      // Old policy stored 30 days; new policy should use 28 after monthly sends begin.
      nextSendAt: new Date(now.getTime() + FIRST_MONTHLY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 200 * DAILY_INTERVAL_MS).toISOString(),
    };

    const before28Days = new Date(now.getTime() + MONTHLY_INTERVAL_MS - 1000);
    expect(evaluateCadence(state, before28Days).shouldSend).toBe(false);

    const at28Days = new Date(now.getTime() + MONTHLY_INTERVAL_MS);
    const result = evaluateCadence(state, at28Days);
    expect(result.shouldSend).toBe(true);
    expect(result.nextState.nextSendAt).toBe(
      new Date(at28Days.getTime() + MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('firstOutstandingAt is preserved through sends', () => {
    const firstOutstandingAt = '2024-01-01T09:00:00.000Z';
    const state = {
      cadence: 'daily',
      sendCountDaily: 0,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      nextSendAt: new Date(now.getTime() - 1).toISOString(),
      firstOutstandingAt,
    };
    const { nextState } = evaluateCadence(state, now);
    expect(nextState.firstOutstandingAt).toBe(firstOutstandingAt);
  });

  it('handles legacy state (sendCount without cadence) gracefully', () => {
    // Legacy state from PR #900 — no cadence/sendCountDaily fields
    const legacyState = {
      sendCount: 1,
      lastSentAt: new Date(now.getTime() - DAILY_INTERVAL_MS - 1000).toISOString(),
      nextSendAt: new Date(now.getTime() - 1000).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 2 * DAILY_INTERVAL_MS).toISOString(),
    };
    const result = evaluateCadence(legacyState, now);
    expect(typeof result.shouldSend).toBe('boolean');
    expect(result.nextState).toBeDefined();
  });

  describe('force option (admin "Send Now")', () => {
    it('sends immediately on first detection and schedules the next automatic email a week later', () => {
      const { shouldSend, nextState } = evaluateCadence(undefined, now, { force: true });
      expect(shouldSend).toBe(true);
      expect(nextState.cadence).toBe('weekly');
      expect(nextState.sendCountDaily).toBe(1);
      expect(nextState.sendCountWeekly).toBe(0);
      expect(nextState.lastSentAt).toBe(now.toISOString());
      const expectedNext = new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString();
      expect(nextState.nextSendAt).toBe(expectedNext);
    });

    it('sends immediately when force=true even though nextSendAt is far in the future', () => {
      const state = {
        cadence: 'daily',
        sendCountDaily: 0,
        sendCountWeekly: 0,
        sendCountMonthly: 0,
        lastSentAt: null,
        nextSendAt: new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString(),
        firstOutstandingAt: now.toISOString(),
      };
      const { shouldSend, nextState } = evaluateCadence(state, now, { force: true });
      expect(shouldSend).toBe(true);
      expect(nextState.cadence).toBe('weekly');
      expect(nextState.sendCountDaily).toBe(1);
      expect(nextState.nextSendAt).toBe(new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString());
    });

    it('without force, still defers on first detection and respects nextSendAt', () => {
      const { shouldSend } = evaluateCadence(undefined, now);
      expect(shouldSend).toBe(false);
    });
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

  it('skips suppliers with neither verified nor emailVerified set', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ verified: false, emailVerified: false })],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(0);
  });

  it('still sends to legacy accounts that only have emailVerified set (pre-consolidation records)', async () => {
    setupDb({
      settings: makeSettings(),
      users: [makeUser({ verified: false, emailVerified: true })],
      suppliers: [makeSupplier()],
      packages: [],
    });
    const items = await getSupplierActionItems();
    expect(items).toHaveLength(1);
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
