'use strict';

const mockCreateIndex = jest.fn(async () => 'index_name');
const mockCollection = jest.fn(() => ({ createIndex: mockCreateIndex }));
const mockDb = { collection: mockCollection };
const mockGetDb = jest.fn(async () => mockDb);

jest.mock('../../db', () => ({ getDb: mockGetDb }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const service = require('../../services/partnerRewardIntegrityIndexService');

beforeEach(() => {
  jest.clearAllMocks();
  service._test.resetForTests();
});

test('creates a unique integrity event index and the reward evidence lookup indexes', async () => {
  await service.ensureIndexes();

  expect(mockCollection).toHaveBeenCalledWith('partner_reward_integrity_events');
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { id: 1 },
    { name: 'uniq_partner_reward_integrity_event', unique: true }
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { partnerId: 1, supplierUserId: 1, createdAt: -1 },
    { name: 'partner_reward_exposure_lookup' }
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { partnerId: 1, campaign: 1, createdAt: -1 },
    { name: 'partner_reward_campaign_velocity' }
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { supplierId: 1, ipAddress: 1, createdAt: -1 },
    { name: 'partner_reward_review_network' }
  );
  expect(mockCreateIndex).toHaveBeenCalledWith(
    { 'partnerRewardPaymentEvidence.paymentInstrumentHash': 1, status: 1 },
    expect.objectContaining({ name: 'partner_reward_payment_instrument' })
  );
});

test('coalesces concurrent index initialization into one database operation', async () => {
  await Promise.all([service.ensureIndexes(), service.ensureIndexes(), service.ensureIndexes()]);
  expect(mockGetDb).toHaveBeenCalledTimes(1);
  expect(mockCollection).toHaveBeenCalledTimes(6);
});
