'use strict';

function loadRuntime({ existingTransactions = [], rewardFailure = null, balance = null } = {}) {
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
    CREDIT_MATURITY_DAYS: 30,
    CREDIT_TYPES: {
      REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
      PACKAGE_BONUS: 'PACKAGE_BONUS',
      FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
      SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
    },
    awardReferralSignupBonus: awardSignup,
    awardPackageBonus: jest.fn(async () => null),
    awardFirstReviewBonus: jest.fn(async () => null),
    awardSubscriptionBonus: jest.fn(async () => null),
    getBalance: jest.fn(
      async partnerId =>
        balance || { partnerId, availableBalance: 100, maturingBalance: 0, transactions: [] }
    ),
  };
  const mockAntiAbuse = { installRewardGuards: jest.fn(service => service) };
  const mockRewardIntegrityRuntime = {
    install: jest.fn(),
    revalidatePartnerRewards: jest.fn(async () => ({ checked: 0, clawedBack: 0 })),
  };
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  jest.doMock('../../db-unified', () => mockDb);
  jest.doMock('../../services/partnerService', () => mockPartnerService);
  jest.doMock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
  jest.doMock('../../services/partnerRewardIntegrityRuntime', () => mockRewardIntegrityRuntime);
  jest.doMock('../../utils/logger', () => mockLogger);

  const runtime = require('../../services/partnerAntiAbuseRuntime');
  return {
    runtime,
    mockDb,
    mockPartnerService,
    mockAntiAbuse,
    mockRewardIntegrityRuntime,
    mockLogger,
  };
}

describe('partner anti-abuse reward runtime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('installs both reward guard layers and revalidates before deferred reward reconciliation', async () => {
    const { runtime, mockPartnerService, mockAntiAbuse, mockRewardIntegrityRuntime } =
      loadRuntime();
    runtime.install();
    runtime.install();
    const balance = await mockPartnerService.getBalance('prt_1');
    expect(mockAntiAbuse.installRewardGuards).toHaveBeenCalledTimes(1);
    expect(mockRewardIntegrityRuntime.install).toHaveBeenCalledTimes(1);
    expect(mockRewardIntegrityRuntime.revalidatePartnerRewards).toHaveBeenCalledWith('prt_1');
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardPackageBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardFirstReviewBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardSubscriptionBonus).toHaveBeenCalledTimes(2);
    expect(balance).toEqual({
      partnerId: 'prt_1',
      availableBalance: 100,
      maturingBalance: 0,
      transactions: [],
    });
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
        {
          partnerId: 'prt_1',
          supplierUserId: 'usr_supplier_1',
          type: 'SUBSCRIPTION_BONUS',
          amount: 100,
        },
      ],
    });
    runtime.install();
    await mockPartnerService.getBalance('prt_1');
    expect(mockPartnerService.awardReferralSignupBonus).not.toHaveBeenCalledWith('usr_supplier_1');
    expect(mockPartnerService.awardPackageBonus).not.toHaveBeenCalledWith('usr_supplier_1');
    expect(mockPartnerService.awardSubscriptionBonus).not.toHaveBeenCalledWith('usr_supplier_1');
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
      maturingBalance: 0,
      transactions: [],
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

  test('keeps a base-matured reward unavailable until its explicit risk maturity date', async () => {
    const futureMaturity = new Date(Date.now() + 7 * 86400000).toISOString();
    const createdAt = new Date(Date.now() - 40 * 86400000).toISOString();
    const { runtime, mockPartnerService } = loadRuntime({
      balance: {
        partnerId: 'prt_1',
        availableBalance: 115,
        maturingBalance: 0,
        transactions: [
          {
            id: 'ptx_reward',
            type: 'FIRST_REVIEW_BONUS',
            amount: 15,
            createdAt,
            maturesAt: futureMaturity,
          },
        ],
      },
    });
    runtime.install();
    await expect(mockPartnerService.getBalance('prt_1')).resolves.toMatchObject({
      availableBalance: 100,
      maturingBalance: 15,
    });
  });

  test('does not double-count a reward already inside the normal 30-day maturing balance', async () => {
    const futureMaturity = new Date(Date.now() + 40 * 86400000).toISOString();
    const createdAt = new Date(Date.now() - 10 * 86400000).toISOString();
    const { runtime, mockPartnerService } = loadRuntime({
      balance: {
        partnerId: 'prt_1',
        availableBalance: 100,
        maturingBalance: 15,
        transactions: [
          {
            id: 'ptx_reward',
            type: 'FIRST_REVIEW_BONUS',
            amount: 15,
            createdAt,
            maturesAt: futureMaturity,
          },
        ],
      },
    });
    runtime.install();
    await expect(mockPartnerService.getBalance('prt_1')).resolves.toMatchObject({
      availableBalance: 100,
      maturingBalance: 15,
    });
  });

  test('removes a voided pending reward without reducing unrelated available points', async () => {
    const createdAt = new Date(Date.now() - 10 * 86400000).toISOString();
    const { runtime, mockPartnerService } = loadRuntime({
      balance: {
        partnerId: 'prt_1',
        balance: 115,
        availableBalance: 100,
        maturingBalance: 15,
        totalEarned: 115,
        reviewBonusTotal: 15,
        transactions: [
          {
            id: 'ptx_reward',
            type: 'FIRST_REVIEW_BONUS',
            amount: 15,
            createdAt,
            reversedAt: new Date().toISOString(),
            reversalMode: 'void_pending',
          },
        ],
      },
    });
    runtime.install();

    await expect(mockPartnerService.getBalance('prt_1')).resolves.toMatchObject({
      balance: 100,
      availableBalance: 100,
      maturingBalance: 0,
      totalEarned: 100,
      reviewBonusTotal: 0,
      voidedPendingPoints: 15,
      clawedBackPoints: 0,
    });
  });

  test('reports a mature clawback without double-subtracting the financial debit', async () => {
    const createdAt = new Date(Date.now() - 40 * 86400000).toISOString();
    const { runtime, mockPartnerService } = loadRuntime({
      balance: {
        partnerId: 'prt_1',
        balance: 100,
        availableBalance: 100,
        maturingBalance: 0,
        totalEarned: 115,
        reviewBonusTotal: 15,
        transactions: [
          {
            id: 'ptx_reward',
            type: 'FIRST_REVIEW_BONUS',
            amount: 15,
            createdAt,
            reversedAt: new Date().toISOString(),
            reversalMode: 'debit_matured',
          },
          {
            id: 'ptx_debit',
            type: 'REDEEM',
            amount: -15,
            externalRef: 'reward-integrity:ptx_reward',
          },
        ],
      },
    });
    runtime.install();

    await expect(mockPartnerService.getBalance('prt_1')).resolves.toMatchObject({
      balance: 100,
      availableBalance: 100,
      totalEarned: 100,
      reviewBonusTotal: 0,
      clawedBackPoints: 15,
    });
  });
});
