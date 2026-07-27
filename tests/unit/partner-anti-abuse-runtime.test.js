'use strict';

function loadRuntime({ existingTransactions = [], rewardFailure = null } = {}) {
  jest.resetModules();

  const mockDb = {
    find: jest.fn(async collection => {
      if (collection === 'partner_referrals') {
        return [
          { partnerId: 'prt_1', supplierUserId: 'usr_supplier_1' },
          { partnerId: 'prt_1', supplierUserId: 'usr_supplier_2' },
        ];
      }
      if (collection === 'partner_credit_transactions') return existingTransactions;
      return [];
    }),
  };
  const awardSignup = jest.fn(async supplierUserId => {
    if (rewardFailure) throw rewardFailure;
    return { supplierUserId, type: 'REFERRAL_SIGNUP_BONUS' };
  });
  const mockPartnerService = {
    CREDIT_TYPES: {
      REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
      PACKAGE_BONUS: 'PACKAGE_BONUS',
      FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
    },
    awardReferralSignupBonus: awardSignup,
    awardPackageBonus: jest.fn(async () => null),
    awardFirstReviewBonus: jest.fn(async () => null),
    awardSubscriptionBonus: jest.fn(),
    getBalance: jest.fn(async partnerId => ({ partnerId, availableBalance: 100 })),
  };
  const mockAntiAbuse = {
    installRewardGuards: jest.fn(service => service),
  };
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  jest.doMock('../../db-unified', () => mockDb);
  jest.doMock('../../services/partnerService', () => mockPartnerService);
  jest.doMock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
  jest.doMock('../../utils/logger', () => mockLogger);

  const runtime = require('../../services/partnerAntiAbuseRuntime');
  return {
    runtime,
    mockDb,
    mockPartnerService,
    mockAntiAbuse,
    mockLogger,
  };
}

describe('partner anti-abuse reward runtime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('installs reward guards once and reconciles safe deferred rewards before balance reads', async () => {
    const { runtime, mockPartnerService, mockAntiAbuse } = loadRuntime();
    runtime.install();
    runtime.install();

    const balance = await mockPartnerService.getBalance('prt_1');

    expect(mockAntiAbuse.installRewardGuards).toHaveBeenCalledTimes(1);
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardPackageBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardFirstReviewBonus).toHaveBeenCalledTimes(2);
    expect(balance).toEqual({ partnerId: 'prt_1', availableBalance: 100 });
  });

  test('does not retry milestone rewards already present in the ledger', async () => {
    const { runtime, mockPartnerService } = loadRuntime({
      existingTransactions: [
        {
          partnerId: 'prt_1',
          supplierUserId: 'usr_supplier_1',
          type: 'REFERRAL_SIGNUP_BONUS',
          amount: 5,
        },
        {
          partnerId: 'prt_1',
          supplierUserId: 'usr_supplier_1',
          type: 'PACKAGE_BONUS',
          amount: 10,
        },
      ],
    });
    runtime.install();

    await mockPartnerService.getBalance('prt_1');

    expect(mockPartnerService.awardReferralSignupBonus).not.toHaveBeenCalledWith('usr_supplier_1');
    expect(mockPartnerService.awardPackageBonus).not.toHaveBeenCalledWith('usr_supplier_1');
    expect(mockPartnerService.awardFirstReviewBonus).toHaveBeenCalledWith('usr_supplier_1');
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledWith('usr_supplier_2');
  });

  test('logs a failed deferred reward without breaking balance reads', async () => {
    const failure = new Error('temporary reward failure');
    const { runtime, mockPartnerService, mockLogger } = loadRuntime({ rewardFailure: failure });
    runtime.install();

    await expect(mockPartnerService.getBalance('prt_1')).resolves.toEqual({
      partnerId: 'prt_1',
      availableBalance: 100,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[PARTNER-ANTI-ABUSE] Deferred reward reconciliation failed',
      expect.objectContaining({
        partnerId: 'prt_1',
        supplierUserId: 'usr_supplier_1',
        rewardType: 'REFERRAL_SIGNUP_BONUS',
        error: 'temporary reward failure',
      })
    );
  });
});
