'use strict';

const mockInstall = jest.fn();
const mockCreateIndex = jest.fn(async () => 'index_name');
const mockCollection = jest.fn(() => ({ createIndex: mockCreateIndex }));
const mockDatabase = { collection: mockCollection };

jest.mock('../../services/partnerAntiAbuseRuntime', () => ({ install: mockInstall }));
jest.mock('../../config/database', () => ({
  mongoDb: { getDb: jest.fn(() => mockDatabase) },
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

test('the server-loaded database utility activates partner anti-abuse guards at module load', () => {
  jest.isolateModules(() => {
    require('../../utils/database');
  });
  expect(mockInstall).toHaveBeenCalledTimes(1);
});

test('the production index routine installs partner reward and cashout integrity indexes', async () => {
  const { addDatabaseIndexes } = require('../../utils/database');

  await addDatabaseIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_credit_transactions');
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { supplierUserId: 1, type: 1, partnerId: 1 },
    expect.objectContaining({
      unique: true,
      partialFilterExpression: expect.objectContaining({
        supplierUserId: { $type: 'string' },
        type: {
          $in: [
            'PACKAGE_BONUS',
            'SUBSCRIPTION_BONUS',
            'REFERRAL_SIGNUP_BONUS',
            'FIRST_REVIEW_BONUS',
          ],
        },
      }),
    })
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { partnerId: 1, idempotencyKey: 1 },
    expect.objectContaining({ unique: true })
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { requestId: 1 },
    expect.objectContaining({ unique: true })
  );
});
