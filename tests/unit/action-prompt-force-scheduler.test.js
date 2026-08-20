'use strict';

/**
 * Exercises the real runActionPrompts() "force" code paths end-to-end
 * (rather than asserting on source text), so the cooldown-timestamp
 * persistence and the force flag actually reaching evaluateCadence are
 * covered by real execution.
 *
 * force lets the admin "Send Now" action bypass a supplier's cadence
 * timing — including the 24h delay on their very first reminder — which
 * previously made Send Now silently do nothing on a fresh install (every
 * supplier's first detection defers by design; see actionPromptService.js).
 */

const mockEvaluateCadence = jest.fn();
const mockUpdateCadenceState = jest.fn(async () => true);
const mockGetSupplierActionItems = jest.fn();

jest.mock('../../services/actionPromptService', () => ({
  getSupplierActionItems: (...args) => mockGetSupplierActionItems(...args),
  evaluateCadence: (...args) => mockEvaluateCadence(...args),
  updateCadenceState: (...args) => mockUpdateCadenceState(...args),
}));

const mockSendMail = jest.fn(async () => ({}));
jest.mock('../../utils/postmark', () => ({
  sendMail: (...args) => mockSendMail(...args),
  FROM_NOREPLY: 'noreply@example.com',
}));

let mockStoredSettings = {};
jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'settings' ? mockStoredSettings : {})),
  writeAndVerify: jest.fn(async (collection, data) => {
    if (collection === 'settings') {
      mockStoredSettings = data;
    }
    return { success: true, data };
  }),
}));

const { runActionPrompts } = require('../../services/actionPromptScheduler');

const testUser = {
  id: 'supplier-user-1',
  email: 'supplier@example.com',
  actionPromptState: undefined,
};
const testReport = {
  outstanding: [
    {
      key: 'missingPackages',
      severity: 'red',
      title: 'Create your first package',
      description: 'desc',
      ctaUrl: 'https://example.com',
    },
  ],
  completed: [],
  ragStatus: 'red',
  completionPercent: 0,
};

function futureIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

describe('runActionPrompts — force mode (admin "Send Now")', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSettings = {};
    mockGetSupplierActionItems.mockResolvedValue([
      { user: testUser, supplier: {}, report: testReport },
    ]);
    mockEvaluateCadence.mockReturnValue({
      shouldSend: true,
      nextState: {
        cadence: 'daily',
        sendCountDaily: 1,
        sendCountWeekly: 0,
        sendCountMonthly: 0,
        lastSentAt: new Date().toISOString(),
        nextSendAt: futureIso(24 * 60 * 60 * 1000),
        firstOutstandingAt: new Date().toISOString(),
      },
    });
  });

  it('passes force:true through to evaluateCadence for a forced manual run', async () => {
    await runActionPrompts({ dryRun: false, force: true, trigger: 'manual' });

    expect(mockEvaluateCadence).toHaveBeenCalledWith(testUser.actionPromptState, expect.any(Date), {
      force: true,
    });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it('defaults force to false so scheduled runs are unaffected', async () => {
    await runActionPrompts({ dryRun: false, trigger: 'scheduler' });

    expect(mockEvaluateCadence).toHaveBeenCalledWith(testUser.actionPromptState, expect.any(Date), {
      force: false,
    });
  });

  it('persists lastForceRunAt and a force:true history entry after a forced non-dry run', async () => {
    await runActionPrompts({ dryRun: false, force: true, trigger: 'manual' });

    expect(mockStoredSettings.emailAutomation.actionPrompts.lastForceRunAt).toBe(
      mockStoredSettings.emailAutomation.actionPrompts.lastRun.finishedAt
    );
    expect(mockStoredSettings.emailAutomation.actionPrompts.runHistory[0].force).toBe(true);
  });

  it('does not set lastForceRunAt for a non-forced run', async () => {
    await runActionPrompts({ dryRun: false, force: false, trigger: 'scheduler' });

    expect(mockStoredSettings.emailAutomation.actionPrompts.lastForceRunAt).toBeUndefined();
    expect(mockStoredSettings.emailAutomation.actionPrompts.runHistory[0].force).toBe(false);
  });

  it('does not send mail or persist anything for a forced dry run', async () => {
    await runActionPrompts({ dryRun: true, force: true, trigger: 'manual' });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockStoredSettings.emailAutomation).toBeUndefined();
  });
});
