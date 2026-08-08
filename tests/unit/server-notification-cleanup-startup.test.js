'use strict';

const mockStart = jest.fn();

jest.mock('../../services/notificationCleanupScheduler', () => ({
  start: mockStart,
}));

const logger = require('../../utils/logger');

describe('server.js — startNotificationCleanupScheduler()', () => {
  let app;

  beforeAll(() => {
    app = require('../../server');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts the scheduler and logs success when scheduling succeeds', () => {
    mockStart.mockReturnValue({ scheduled: true, nextRun: new Date() });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    app.startNotificationCleanupScheduler();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Notification cleanup scheduled'));

    infoSpy.mockRestore();
  });

  it('logs a warning instead of throwing when the scheduler fails to start', () => {
    mockStart.mockImplementation(() => {
      throw new Error('node-schedule unavailable');
    });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(() => app.startNotificationCleanupScheduler()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Notification cleanup scheduler failed to initialize'),
      'node-schedule unavailable'
    );

    warnSpy.mockRestore();
  });
});
