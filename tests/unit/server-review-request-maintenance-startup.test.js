'use strict';

const mockInitialise = jest.fn();

jest.mock('../../utils/reviewRequestOperations', () => ({
  initialiseReviewRequestMaintenance: mockInitialise,
}));

const logger = require('../../utils/logger');

describe('server.js — startReviewRequestMaintenanceScheduler()', () => {
  let app;

  beforeAll(() => {
    app = require('../../server');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts the scheduler and logs success when scheduling succeeds', () => {
    mockInitialise.mockReturnValue({
      scheduled: true,
      cronExpr: '15 * * * *',
      nextRun: new Date(),
    });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    app.startReviewRequestMaintenanceScheduler();

    expect(mockInitialise).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Review request maintenance scheduled')
    );

    infoSpy.mockRestore();
  });

  it('logs a warning instead of throwing when the scheduler fails to start', () => {
    mockInitialise.mockImplementation(() => {
      throw new Error('node-schedule unavailable');
    });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    expect(() => app.startReviewRequestMaintenanceScheduler()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Review request maintenance scheduler failed to initialize'),
      'node-schedule unavailable'
    );

    warnSpy.mockRestore();
  });

  it('logs "No" when maintenance is disabled rather than crashing on a null result', () => {
    mockInitialise.mockReturnValue({ scheduled: false, cronExpr: null, nextRun: null });
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    expect(() => app.startReviewRequestMaintenanceScheduler()).not.toThrow();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Review request maintenance scheduled: No')
    );

    infoSpy.mockRestore();
  });
});
