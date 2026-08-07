'use strict';

/**
 * Regression test: Dry Run must be able to preview action-prompt emails
 * even while the master "Enable Action-Prompt Emails" switch is off.
 *
 * getSupplierActionItems() bails out early when the global flag is
 * disabled — see services/actionPromptService.js. Before this fix,
 * runActionPrompts() always called it with only { telemetryTrigger }, so a
 * dry run against a disabled automation always reported "scanned 0,
 * would-send 0", defeating its purpose as a safe preview tool. It now
 * passes { ignoreGlobalEnabled: dryRun } so dry runs bypass that gate (a
 * dry run never calls the mail provider, so this can't cause a real send).
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

jest.mock('../../db-unified', () => ({
  read: jest.fn(async () => ({})),
  writeAndVerify: jest.fn(async (_collection, data) => ({ success: true, data })),
}));

const { runActionPrompts } = require('../../services/actionPromptScheduler');

describe('runActionPrompts — dry run bypasses the global-enabled gate', () => {
  beforeEach(() => {
    mockGetSupplierActionItems.mockClear();
  });

  it('passes ignoreGlobalEnabled: true when dryRun is true', async () => {
    await runActionPrompts({ dryRun: true, trigger: 'manual' });

    expect(mockGetSupplierActionItems).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryTrigger: 'manual', ignoreGlobalEnabled: true })
    );
  });

  it('passes ignoreGlobalEnabled: false for a real (non-dry) run', async () => {
    await runActionPrompts({ dryRun: false, trigger: 'scheduler' });

    expect(mockGetSupplierActionItems).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryTrigger: 'scheduler', ignoreGlobalEnabled: false })
    );
  });
});
