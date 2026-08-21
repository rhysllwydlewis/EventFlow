'use strict';

const { evaluateCadence } = require('../../services/actionPromptService');

describe('action-prompt diagnostics cadence compatibility', () => {
  it('still reports a genuinely due first reminder as sendable', () => {
    const now = new Date('2026-08-21T09:00:00.000Z');
    const pastDate = new Date(now.getTime() - 1000).toISOString();
    const state = {
      cadence: 'daily',
      sendCountDaily: 0,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: null,
      nextSendAt: pastDate,
      firstOutstandingAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    };

    expect(evaluateCadence(state, now).shouldSend).toBe(true);
  });
});
