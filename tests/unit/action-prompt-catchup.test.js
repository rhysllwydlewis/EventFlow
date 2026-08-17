'use strict';

/**
 * services/actionPromptScheduler.js runCatchUpIfMissed() — recovers a
 * genuinely missed daily run (e.g. a deploy landing near 9am) without
 * risking a duplicate send: evaluateCadence()'s per-supplier `nextSendAt`
 * already prevents re-emailing anyone the regular tick already reached
 * today, so it's safe to trigger unconditionally whenever the last
 * recorded run looks stale.
 */

const mockGetSupplierActionItems = jest.fn(async () => []);

jest.mock('../../services/actionPromptService', () => ({
  getSupplierActionItems: (...args) => mockGetSupplierActionItems(...args),
  evaluateCadence: jest.fn(() => ({ shouldSend: false, nextState: {} })),
  updateCadenceState: jest.fn(async () => true),
}));

jest.mock('../../utils/postmark', () => ({
  sendMail: jest.fn(async () => ({})),
  FROM_NOREPLY: 'noreply@example.com',
}));

jest.mock('../../utils/sentry', () => ({ captureException: jest.fn() }));

const mockRead = jest.fn();
jest.mock('../../db-unified', () => ({
  read: (...args) => mockRead(...args),
  writeAndVerify: jest.fn(async (_collection, data) => ({ success: true, data })),
}));

const sentry = require('../../utils/sentry');
const { runCatchUpIfMissed } = require('../../services/actionPromptScheduler');

describe('actionPromptScheduler.runCatchUpIfMissed', () => {
  beforeEach(() => {
    mockGetSupplierActionItems.mockClear();
    sentry.captureException.mockClear();
  });

  it('runs when there is no recorded lastRun at all', async () => {
    mockRead.mockResolvedValue({});

    await runCatchUpIfMissed();

    expect(mockGetSupplierActionItems).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryTrigger: 'missed-run-catchup' })
    );
  });

  it('runs when the last run is older than 24 hours', async () => {
    mockRead.mockResolvedValue({
      emailAutomation: {
        actionPrompts: {
          lastRun: { finishedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
        },
      },
    });

    await runCatchUpIfMissed();

    expect(mockGetSupplierActionItems).toHaveBeenCalled();
  });

  it('does nothing when a run already happened within the last 24 hours', async () => {
    mockRead.mockResolvedValue({
      emailAutomation: {
        actionPrompts: {
          lastRun: { finishedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
        },
      },
    });

    await runCatchUpIfMissed();

    expect(mockGetSupplierActionItems).not.toHaveBeenCalled();
  });

  it('reports to Sentry rather than throwing when the staleness check fails', async () => {
    mockRead.mockRejectedValue(new Error('settings unavailable'));

    await expect(runCatchUpIfMissed()).resolves.toBeUndefined();

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { scheduledJob: 'action-prompts' } })
    );
    expect(mockGetSupplierActionItems).not.toHaveBeenCalled();
  });
});
