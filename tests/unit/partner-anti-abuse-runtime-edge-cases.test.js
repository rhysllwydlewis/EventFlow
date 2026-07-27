'use strict';

function loadRuntime({ cashout = null, payment = null, assessment, rewardFailure, clawbackFailure } = {}) {
  jest.resetModules();

  const mockOriginalUpdateOne = jest.fn(async (_collection, _query, update) => update);
  const mockDb = {
    find: jest.fn(async collection =>
      collection === 'partner_referrals'
        ? [{ partnerId: 'prt_1', supplierUserId: 'usr_supplier_1' }]
        : []
    ),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'partner_cashout_requests' && query.id === cashout?.id) return cashout;
      if (collection === 'payments' && query.id === payment?.id) return payment;
      return null;
    }),
    updateOne: mockOriginalUpdateOne,
  };
  const awardReward = jest.fn(async supplierUserId => {
    if (rewardFailure) throw rewardFailure;
    return { supplierUserId };
  });
  const mockPartnerService = {
    CREDIT_TYPES: {
      REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
      PACKAGE_BONUS: 'PACKAGE_BONUS',
      FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
    },
    awardReferralSignupBonus: awardReward,
    awardPackageBonus: jest.fn(async () => null),
    awardFirstReviewBonus: jest.fn(async () => null),
    awardSubscriptionBonus: jest.fn(),
    getBalance: jest.fn(async partnerId => ({ partnerId, availableBalance: 50 })),
  };
  const mockAssessment = assessment || {
    id: 'assessment_1',
    partnerId: cashout?.partnerId || 'prt_1',
    requestId: cashout?.id || null,
    score: 0,
    riskLevel: 'low',
    requiresManualReview: false,
    blockApproval: false,
    signals: [],
    assessedAt: '2026-07-02T00:00:00.000Z',
  };
  const mockAntiAbuse = {
    installRewardGuards: jest.fn(service => service),
    assessCashout: jest.fn(async () => mockAssessment),
    persistAssessment: jest.fn(async value => value),
  };
  const mockClawback = {
    clawBackForPaymentRecord: jest.fn(async () => {
      if (clawbackFailure) throw clawbackFailure;
      return { id: 'ptx_clawback' };
    }),
  };
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  jest.doMock('../../db-unified', () => mockDb);
  jest.doMock('../../services/partnerService', () => mockPartnerService);
  jest.doMock('../../services/partnerAntiAbuseService', () => mockAntiAbuse);
  jest.doMock('../../services/partnerRewardClawbackService', () => mockClawback);
  jest.doMock('../../utils/logger', () => mockLogger);

  const runtime = require('../../services/partnerAntiAbuseRuntime');
  return {
    runtime,
    mockDb,
    mockPartnerService,
    mockAntiAbuse,
    mockClawback,
    mockLogger,
    mockOriginalUpdateOne,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('logs a failed deferred reward without breaking balance reads', async () => {
  const failure = new Error('temporary reward failure');
  const { runtime, mockPartnerService, mockLogger } = loadRuntime({ rewardFailure: failure });
  runtime.install();

  await expect(mockPartnerService.getBalance('prt_1')).resolves.toEqual({
    partnerId: 'prt_1',
    availableBalance: 50,
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

test('passes through an approval update when the cashout no longer exists', async () => {
  const { runtime, mockDb, mockAntiAbuse, mockOriginalUpdateOne } = loadRuntime();
  runtime.install();

  await expect(
    mockDb.updateOne('partner_cashout_requests', { id: 'missing' }, { $set: { status: 'approved' } })
  ).resolves.toEqual({ $set: { status: 'approved' } });
  expect(mockAntiAbuse.assessCashout).not.toHaveBeenCalled();
  expect(mockOriginalUpdateOne).toHaveBeenCalled();
});

test('supports direct update objects for low-risk cashout approval', async () => {
  const cashout = {
    id: 'pcr_1',
    partnerId: 'prt_1',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const { runtime, mockDb, mockOriginalUpdateOne } = loadRuntime({ cashout });
  runtime.install();

  await mockDb.updateOne('partner_cashout_requests', { id: 'pcr_1' }, { status: 'approved' });

  expect(mockOriginalUpdateOne).toHaveBeenLastCalledWith(
    'partner_cashout_requests',
    { id: 'pcr_1' },
    expect.objectContaining({
      status: 'approved',
      fraudRiskScore: 0,
      fraudReviewedAt: expect.any(String),
    })
  );
});

test('updates an adverse payment status without clawback when its payment record is missing', async () => {
  const { runtime, mockDb, mockClawback, mockOriginalUpdateOne } = loadRuntime();
  runtime.install();

  await mockDb.updateOne('payments', { id: 'missing' }, { $set: { status: 'refunded' } });

  expect(mockOriginalUpdateOne).toHaveBeenCalled();
  expect(mockClawback.clawBackForPaymentRecord).not.toHaveBeenCalled();
});

test('fails before clawback when an adverse payment status does not persist', async () => {
  const payment = {
    id: 'pay_1',
    userId: 'usr_supplier',
    stripePaymentId: 'pi_1',
    status: 'succeeded',
  };
  const { runtime, mockDb, mockClawback, mockOriginalUpdateOne } = loadRuntime({ payment });
  runtime.install();
  mockOriginalUpdateOne.mockResolvedValueOnce(null);

  await expect(
    mockDb.updateOne('payments', { id: 'pay_1' }, { $set: { status: 'refunded' } })
  ).rejects.toMatchObject({
    code: 'PARTNER_PAYMENT_STATUS_WRITE_FAILED',
  });
  expect(mockClawback.clawBackForPaymentRecord).not.toHaveBeenCalled();
});

test('fails the adverse payment update when automatic clawback fails', async () => {
  const payment = {
    id: 'pay_1',
    userId: 'usr_supplier',
    stripePaymentId: 'pi_1',
    status: 'succeeded',
  };
  const failure = new Error('clawback storage failed');
  const { runtime, mockDb, mockLogger } = loadRuntime({ payment, clawbackFailure: failure });
  runtime.install();

  await expect(
    mockDb.updateOne('payments', { id: 'pay_1' }, { $set: { status: 'chargeback' } })
  ).rejects.toThrow('clawback storage failed');
  expect(mockLogger.error).toHaveBeenCalledWith(
    '[PARTNER-ANTI-ABUSE] Automatic reward clawback failed',
    expect.objectContaining({
      paymentId: 'pay_1',
      status: 'chargeback',
      error: 'clawback storage failed',
    })
  );
});
