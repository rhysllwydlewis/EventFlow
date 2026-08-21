'use strict';

const {
  evaluateCadence,
  DAILY_INTERVAL_MS,
  WEEKLY_INTERVAL_MS,
  MONTHLY_INTERVAL_MS,
  DAILY_SENDS_BEFORE_WEEKLY,
  WEEKLY_SENDS_BEFORE_MONTHLY,
} = require('../../services/actionPromptService');

describe('supplier action-prompt cadence policy', () => {
  const now = new Date('2026-08-21T09:00:00.000Z');

  it('uses one 24-hour reminder, one 7-day follow-up, then 28-day reminders', () => {
    expect(DAILY_SENDS_BEFORE_WEEKLY).toBe(1);
    expect(WEEKLY_SENDS_BEFORE_MONTHLY).toBe(1);
    expect(DAILY_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(WEEKLY_INTERVAL_MS).toBe(7 * DAILY_INTERVAL_MS);
    expect(MONTHLY_INTERVAL_MS).toBe(28 * DAILY_INTERVAL_MS);

    let result = evaluateCadence(undefined, now);
    expect(result.shouldSend).toBe(false);
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + DAILY_INTERVAL_MS).toISOString()
    );

    const firstSend = new Date(result.nextState.nextSendAt);
    result = evaluateCadence(result.nextState, firstSend);
    expect(result.shouldSend).toBe(true);
    expect(result.nextState.cadence).toBe('weekly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(firstSend.getTime() + WEEKLY_INTERVAL_MS).toISOString()
    );

    const weeklySend = new Date(result.nextState.nextSendAt);
    result = evaluateCadence(result.nextState, weeklySend);
    expect(result.shouldSend).toBe(true);
    expect(result.nextState.cadence).toBe('monthly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(weeklySend.getTime() + MONTHLY_INTERVAL_MS).toISOString()
    );

    const monthlySend = new Date(result.nextState.nextSendAt);
    result = evaluateCadence(result.nextState, monthlySend);
    expect(result.shouldSend).toBe(true);
    expect(result.nextState.cadence).toBe('monthly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(monthlySend.getTime() + MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('does not resend tomorrow to a supplier emailed today under the old daily policy', () => {
    const state = {
      cadence: 'daily',
      sendCountDaily: 1,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: now.toISOString(),
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

  it('moves old weekly states onto the 28-day wait', () => {
    const state = {
      cadence: 'weekly',
      sendCountDaily: 7,
      sendCountWeekly: 1,
      sendCountMonthly: 0,
      lastSentAt: now.toISOString(),
      nextSendAt: new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 30 * DAILY_INTERVAL_MS).toISOString(),
    };

    const inAWeek = new Date(now.getTime() + WEEKLY_INTERVAL_MS);
    const result = evaluateCadence(state, inAWeek);

    expect(result.shouldSend).toBe(false);
    expect(result.nextState.cadence).toBe('monthly');
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('normalises old 30-day monthly schedules to 28 days', () => {
    const state = {
      cadence: 'monthly',
      sendCountDaily: 7,
      sendCountWeekly: 4,
      sendCountMonthly: 2,
      lastSentAt: now.toISOString(),
      nextSendAt: new Date(now.getTime() + 30 * DAILY_INTERVAL_MS).toISOString(),
      firstOutstandingAt: new Date(now.getTime() - 200 * DAILY_INTERVAL_MS).toISOString(),
    };

    const at28Days = new Date(now.getTime() + MONTHLY_INTERVAL_MS);
    const result = evaluateCadence(state, at28Days);

    expect(result.shouldSend).toBe(true);
    expect(result.nextState.nextSendAt).toBe(
      new Date(at28Days.getTime() + MONTHLY_INTERVAL_MS).toISOString()
    );
  });

  it('forces a first send without scheduling another email tomorrow', () => {
    const result = evaluateCadence(undefined, now, { force: true });

    expect(result.shouldSend).toBe(true);
    expect(result.nextState.cadence).toBe('weekly');
    expect(result.nextState.sendCountDaily).toBe(1);
    expect(result.nextState.nextSendAt).toBe(
      new Date(now.getTime() + WEEKLY_INTERVAL_MS).toISOString()
    );
  });
});
