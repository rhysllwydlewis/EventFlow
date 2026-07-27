'use strict';

const mockInstall = jest.fn();

jest.mock('../../services/partnerAntiAbuseRuntime', () => ({ install: mockInstall }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

test('the server-loaded database utility activates partner anti-abuse guards at module load', () => {
  jest.isolateModules(() => {
    require('../../utils/database');
  });
  expect(mockInstall).toHaveBeenCalledTimes(1);
});