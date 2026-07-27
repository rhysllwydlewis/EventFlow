'use strict';

function loadRuntime({ assessment } = {}) {
  jest.resetModules();

  const mockRequest = {
    id: 'pcr_1',
    partnerId: 'prt_1',
    createdAt: '2026-01-01T00:00:00.000Z',
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
    findOne: jest.fn(async collection =>
      collection === 'partner_cashout_requests' ? mockRequest : null
    ),
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
    mockOriginalUpdateOne,
    mockRequest,
  };
}

describe('partner anti-abuse runtime', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('installs reward guards once and reconciles verified signup rewards before balance reads', async () => {
    const { runtime, mockPartnerService, mockAntiAbuse } = loadRuntime();

    runtime.install();
    runtime.install();
    const balance = await mockPartnerService.getBalance('prt_1');

    expect(mockAntiAbuse.installRewardGuards).toHaveBeenCalledTimes(1);
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledTimes(2);
    expect(mockPartnerService.awardReferralSignupBonus).toHaveBeenCalledWith('usr_supplier_1');
    expect(balance).toEqual({ partnerId: 'prt_1', availableBalance: 100 });
  });

  test('adds fraud fields to a low-risk approval before persisting it', async () => {
    const { runtime, mockDb, mockOriginalUpdateOne, mockAntiAbuse } = loadRuntime();
    runtime.install();

    await mockDb.updateOne(
      'partner_cashout_requests',
      { id: 'pcr_1' },
      { $set: { status: 'approved', approvedAt: '2026-01-03T00:00:00.000Z' } }
    );

    expect(mockAntiAbuse.assessCashout).toHaveBeenCalledWith({
      partnerId: 'prt_1',
      requestId: 'pcr_1',
      requestedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mockAntiAbuse.persistAssessment).toHaveBeenCalled();
    expect(mockOriginalUpdateOne).toHaveBeenLastCalledWith(
      'partner_cashout_requests',
      { id: 'pcr_1' },
      {
        $set: expect.objectContaining({
          status: 'approved',
          fraudRiskScore: 20,
          fraudRiskLevel: 'low',
          fraudReviewRequired: true,
        }),
      }
    );
  });

  test('fails closed and records the assessment when a high-risk approval is attempted', async () => {
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
        { $set: { status: 'approved' } }
      )
    ).rejects.toMatchObject({
      code: 'PARTNER_CASHOUT_HIGH_RISK',
      statusCode: 409,
      assessment: highRisk,
    });

    expect(mockOriginalUpdateOne).toHaveBeenCalledWith(
      'partner_cashout_requests',
      { id: 'pcr_1' },
      {
        $set: expect.objectContaining({
          fraudRiskScore: 85,
          fraudRiskLevel: 'high',
        }),
      }
    );
    expect(
      mockOriginalUpdateOne.mock.calls.some(([, , update]) => update?.$set?.status === 'approved')
    ).toBe(false);
  });

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

  test('passes through approval updates when the request no longer exists', async () => {
    const { runtime, mockDb, mockAntiAbuse, mockOriginalUpdateOne } = loadRuntime();
    mockDb.findOne.mockResolvedValueOnce(null);
    runtime.install();

    await mockDb.updateOne(
      'partner_cashout_requests',
      { id: 'missing' },
      { $set: { status: 'approved' } }
    );

    expect(mockAntiAbuse.assessCashout).not.toHaveBeenCalled();
    expect(mockOriginalUpdateOne).toHaveBeenCalledWith(
      'partner_cashout_requests',
      { id: 'missing' },
      { $set: { status: 'approved' } }
    );
  });
});
