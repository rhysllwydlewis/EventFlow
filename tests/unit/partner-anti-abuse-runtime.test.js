'use strict';

function loadRuntime({ assessment } = {}) {
  jest.resetModules();

  const mockRequest = {
    id: 'pcr_1',
    partnerId: 'prt_1',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const mockPayment = {
    id: 'pay_1',
    userId: 'usr_supplier_1',
    stripePaymentId: 'pi_1',
    status: 'succeeded',
  };
  const mockOriginalUpdateOne = jest.fn(async (_collection, _query, update) => update);
  const mockDb = {
    find: jest.fn(async collection =>
      collection === 'partner_referrals'
        ? [
            { partnerId: 'prt_1', supplierUserId: 'usr_supplier_1' },
            { partnerId: 'prt_1', supplierUserId: 'usr_supplier_2' },
          ]
        : []
    ),
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'partner_cashout_requests' && query.id === 'pcr_1') return mockRequest;
      if (collection === 'payments' && query.id === 'pay_1') return mockPayment;
      return null;
    }),
    updateOne: mockOriginalUpdateOne,
  };
  const mockPartnerService = {
    awardReferralSignupBonus: jest.fn(async supplierUserId => ({ supplierUserId })),
    awardPackageBonus: jest.fn(),
    awardFirstReviewBonus: jest.fn(),
    awardSubscriptionBonus: jest.fn(),
    getBalance: jest.fn(async partnerId => ({ partnerId, availableBalance: 100 })),
  };
  const mockAssessment = assessment || {
    id: 'assessment_1',
    partnerId: 'prt_1',
    requestId: 'pcr_1',
    score: 20,
    riskLevel: 'low',
    requiresManualReview: true,
    blockApproval: false,
    signals: [{ code: 'FIRST_CASHOUT' }],
    assessedAt: '2026-01-02T00:00:00.000Z',
  };
  const mockAntiAbuse = {
    installRewardGuards: jest.fn(service => service),
    assessCashout: jest.fn(async () => mockAssessment),
    persistAssessment: jest.fn(async value => value),
  };
  const mockClawback = { clawBackForPaymentRecord: jest.fn(async () => ({ id: 'ptx_cb' })) };
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

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
    mockOriginalUpdateOne,
  };
}

describe('partner anti-abuse runtime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('installs reward guards once and reconciles signup rewards before balance reads', async () => {
    const { runtime, mockPartnerService, mockAntiAbuse } = loadRuntime();
    runtime.install();
    runtime.install();
    const balance = await mockPartnerService.getBalance('prt_1');
    expect(mockAntiAbuse.installRewardGuards).toHaveBeenCalledTimes(1);
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledTimes(2);
    expect(balance).toEqual({ partnerId: 'prt_1', availableBalance: 100 });
  });

  test('requires a meaningful internal note before approving a first cashout', async () => {
    const { runtime, mockDb } = loadRuntime();
    runtime.install();
    await expect(
      mockDb.updateOne('partner_cashout_requests', { id: 'pcr_1' }, { $set: { status: 'approved' } })
    ).rejects.toMatchObject({
      code: 'PARTNER_CASHOUT_REVIEW_NOTE_REQUIRED',
      statusCode: 409,
    });
  });

  test('adds fraud fields and approval evidence after review', async () => {
    const { runtime, mockDb, mockOriginalUpdateOne } = loadRuntime();
    runtime.install();
    await mockDb.updateOne(
      'partner_cashout_requests',
      { id: 'pcr_1' },
      {
        $set: {
          status: 'approved',
          adminInternalNotes: 'Checked supplier identity, packages and Stripe payment.',
        },
      }
    );
    expect(mockOriginalUpdateOne).toHaveBeenLastCalledWith(
      'partner_cashout_requests',
      { id: 'pcr_1' },
      {
        $set: expect.objectContaining({
          status: 'approved',
          fraudRiskScore: 20,
          fraudReviewRequired: true,
          fraudReviewedAt: expect.any(String),
        }),
      }
    );
  });

  test('fails closed when high-risk approval is attempted', async () => {
    const highRisk = {
      id: 'assessment_high',
      partnerId: 'prt_1',
      requestId: 'pcr_1',
      score: 85,
      riskLevel: 'high',
      requiresManualReview: true,
      blockApproval: true,
      signals: [{ code: 'POSSIBLE_SELF_REFERRAL' }],
      assessedAt: '2026-01-02T00:00:00.000Z',
    };
    const { runtime, mockDb, mockOriginalUpdateOne } = loadRuntime({ assessment: highRisk });
    runtime.install();
    await expect(
      mockDb.updateOne(
        'partner_cashout_requests',
        { id: 'pcr_1' },
        {
          $set: {
            status: 'approved',
            adminInternalNotes: 'Reviewed thoroughly but identity overlap remains unresolved.',
          },
        }
      )
    ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_HIGH_RISK', statusCode: 409 });
    expect(
      mockOriginalUpdateOne.mock.calls.some(([, , update]) => update?.$set?.status === 'approved')
    ).toBe(false);
  });

  test.each(['refunded', 'disputed', 'chargeback'])(
    'claws back a subscription reward when a payment becomes %s',
    async status => {
      const { runtime, mockDb, mockClawback } = loadRuntime();
      runtime.install();
      await mockDb.updateOne('payments', { id: 'pay_1' }, { $set: { status } });
      expect(mockClawback.clawBackForPaymentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pay_1', status }),
        status
      );
    }
  );

  test('does not assess unrelated database updates', async () => {
    const { runtime, mockDb, mockAntiAbuse, mockOriginalUpdateOne } = loadRuntime();
    runtime.install();
    await mockDb.updateOne('users', { id: 'usr_1' }, { $set: { name: 'Updated' } });
    expect(mockAntiAbuse.assessCashout).not.toHaveBeenCalled();
    expect(mockOriginalUpdateOne).toHaveBeenCalledWith(
      'users',
      { id: 'usr_1' },
      { $set: { name: 'Updated' } }
    );
  });
});