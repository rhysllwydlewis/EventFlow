'use strict';

const mockInstall = jest.fn();
const mockCashoutLockInstall = jest.fn();
const mockCashoutOpsInstall = jest.fn();
const mockCashoutAdminEnrichmentInstall = jest.fn();
const mockCashoutIndexEnsure = jest.fn(async () => true);
const mockCreateIndex = jest.fn(async () => 'index_name');
const mockCollection = jest.fn(() => ({ createIndex: mockCreateIndex }));
const mockDatabase = { collection: mockCollection };

jest.mock('../../db-unified', () => ({ updateOne: jest.fn(async () => ({ modified: 1 })) }));
jest.mock('../../services/partnerAntiAbuseRuntime', () => ({ install: mockInstall }));
jest.mock('../../services/partnerCashoutLockRuntime', () => ({ install: mockCashoutLockInstall }));
jest.mock('../../services/partnerCashoutOperationsRuntime', () => ({ install: mockCashoutOpsInstall }));
jest.mock('../../services/partnerCashoutAdminEnrichmentRuntime', () => ({
  install: mockCashoutAdminEnrichmentInstall,
}));
jest.mock('../../services/partnerCashoutOperationsIndexService', () => ({
  ensureIndexes: mockCashoutIndexEnsure,
}));
jest.mock('../../config/database', () => ({
  mongoDb: { getDb: jest.fn(() => mockDatabase) },
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

test('the route mounting path installs cashout policy before lock insertion so runtime order becomes lock then policy then legacy handler', () => {
  jest.isolateModules(() => {
    require('../../middleware/partnerReferralCampaignCapture');
  });
  expect(mockInstall).toHaveBeenCalledTimes(1);
  expect(mockCashoutOpsInstall).toHaveBeenCalledTimes(1);
  expect(mockCashoutLockInstall).toHaveBeenCalledTimes(1);
  expect(mockCashoutAdminEnrichmentInstall).toHaveBeenCalledTimes(1);
  expect(mockCashoutIndexEnsure).toHaveBeenCalledTimes(1);
  expect(mockCashoutOpsInstall.mock.invocationCallOrder[0]).toBeLessThan(
    mockCashoutLockInstall.mock.invocationCallOrder[0]
  );
  expect(mockCashoutLockInstall.mock.invocationCallOrder[0]).toBeLessThan(
    mockCashoutAdminEnrichmentInstall.mock.invocationCallOrder[0]
  );
});

test('the production index routine installs distinct named integrity indexes', async () => {
  const { addDatabaseIndexes } = require('../../utils/database');

  await addDatabaseIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_credit_transactions');
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { partnerId: 1, supplierUserId: 1, type: 1 },
    expect.objectContaining({
      name: 'uniq_partner_reward_milestone',
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
    { idempotencyKey: 1, partnerId: 1 },
    expect.objectContaining({ name: 'uniq_partner_cashout_idempotency', unique: true })
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { requestId: 1 },
    expect.objectContaining({ name: 'uniq_partner_fraud_request', unique: true })
  );
});
