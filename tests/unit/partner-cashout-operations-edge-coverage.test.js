'use strict';

const collections = {
  partners: [],
  users: [],
  partner_cashout_requests: [],
  partner_credit_transactions: [],
  partner_programme_controls: [],
  partner_cashout_ops_events: [],
};

function matches(item, query) {
  return Object.entries(query || {}).every(([key, value]) => item[key] === value);
}

const mockStrictStore = {
  ensureAuthoritative: jest.fn(async () => ({ backend: 'local', authoritative: false })),
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  _test: { isDuplicateKey: jest.fn(error => error?.code === 11000) },
};

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_edge` }));
jest.mock('../../services/partnerService', () => ({
  CREDIT_TYPES: {
    REDEEM: 'REDEEM',
    ADJUSTMENT: 'ADJUSTMENT',
    CASHOUT_HOLD: 'CASHOUT_HOLD',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
  },
}));

const service = require('../../services/partnerCashoutOperationsService');

function seedPartner({ partner = {}, user = {} } = {}) {
  collections.users.push({
    id: 'user_1',
    email: 'partner@example.com',
    company: 'Example Events Ltd',
    verified: true,
    ...user,
  });
  collections.partners.push({
    id: 'partner_1',
    userId: 'user_1',
    status: 'active',
    ...partner,
  });
}

function cashout(overrides = {}) {
  return {
    id: 'cashout_1',
    partnerId: 'partner_1',
    denominationGbp: 50,
    pointsPerGbpSnapshot: 100,
    pointsHeld: 5000,
    status: 'submitted',
    holdTxnId: 'hold_1',
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    id: 'hold_1',
    partnerId: 'partner_1',
    type: 'CASHOUT_HOLD',
    amount: -5000,
    externalRef: 'cashout_1',
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockStrictStore.ensureAuthoritative.mockResolvedValue({ backend: 'local', authoritative: false });
  mockStrictStore.findOne.mockImplementation(
    async (collection, query) =>
      (collections[collection] || []).find(item => matches(item, query)) || null
  );
  mockStrictStore.find.mockImplementation(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
  );
  mockStrictStore.insertOne.mockImplementation(async (collection, item) => {
    collections[collection] = collections[collection] || [];
    collections[collection].push(item);
    return item;
  });
  mockStrictStore.updateOne.mockImplementation(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  });
  mockStrictStore._test.isDuplicateKey.mockImplementation(error => error?.code === 11000);
  for (const name of [
    'PARTNER_CASHOUT_MAX_SINGLE_GBP',
    'PARTNER_CASHOUT_FIRST_MAX_GBP',
    'PARTNER_CASHOUT_24H_MAX_GBP',
    'PARTNER_CASHOUT_30D_MAX_GBP',
    'PARTNER_CASHOUT_MAX_OPEN_REQUESTS',
    'PARTNER_CASHOUT_HIGH_VALUE_REVIEW_GBP',
    'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED',
    'PARTNER_CASHOUT_IDENTITY_REVIEW_MAX_AGE_DAYS',
  ]) {
    delete process.env[name];
  }
});

test('environment parsers handle invalid, clamped, true and false values', () => {
  process.env.TEST_INTEGER = 'invalid';
  expect(service._test.integerEnv('TEST_INTEGER', 7, 2, 10)).toBe(7);
  process.env.TEST_INTEGER = '-9';
  expect(service._test.integerEnv('TEST_INTEGER', 7, 2, 10)).toBe(2);
  process.env.TEST_INTEGER = '99';
  expect(service._test.integerEnv('TEST_INTEGER', 7, 2, 10)).toBe(10);

  delete process.env.TEST_BOOLEAN;
  expect(service._test.booleanEnv('TEST_BOOLEAN', true)).toBe(true);
  process.env.TEST_BOOLEAN = 'YES';
  expect(service._test.booleanEnv('TEST_BOOLEAN', false)).toBe(true);
  process.env.TEST_BOOLEAN = 'off';
  expect(service._test.booleanEnv('TEST_BOOLEAN', true)).toBe(false);
  process.env.TEST_BOOLEAN = 'unknown';
  expect(service._test.booleanEnv('TEST_BOOLEAN', false)).toBe(false);
  delete process.env.TEST_INTEGER;
  delete process.env.TEST_BOOLEAN;
});

test('pause decisions distinguish the master payout pause, cashout pause and active state', () => {
  expect(service.pauseDecision({ programmePaused: true })).toMatchObject({
    blocked: true,
    code: 'PARTNER_PROGRAMME_PAUSED',
  });
  expect(service.pauseDecision({ cashoutsPaused: true })).toMatchObject({
    blocked: true,
    code: 'PARTNER_CASHOUTS_PAUSED',
  });
  expect(service.pauseDecision({})).toEqual({ blocked: false });
});

test('control writes reject missing settings and fail closed when persistence cannot be verified', async () => {
  await expect(
    service.setControls({ reason: 'A sufficiently detailed operational reason.' })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_CONTROL_INVALID' });

  mockStrictStore.insertOne.mockResolvedValueOnce(null);
  await expect(
    service.setControls({
      cashoutsPaused: true,
      reason: 'A sufficiently detailed operational reason.',
      adminUserId: 'admin_1',
    })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_CONTROL_WRITE_FAILED' });
});

test('a non-duplicate first-write failure is not hidden as a race', async () => {
  mockStrictStore.insertOne.mockRejectedValueOnce(new Error('write failed'));
  await expect(
    service.setControls({
      programmePaused: true,
      reason: 'A sufficiently detailed operational reason.',
      adminUserId: 'admin_1',
    })
  ).rejects.toThrow('write failed');
});

test('limit evaluation reports invalid and single-request amounts and ignores the current request', async () => {
  seedPartner();
  await expect(
    service.evaluateLimits({ partnerId: 'partner_1', denominationGbp: 'not-a-number' })
  ).resolves.toMatchObject({
    allowed: false,
    violations: [expect.objectContaining({ code: 'PARTNER_CASHOUT_AMOUNT_INVALID' })],
  });

  process.env.PARTNER_CASHOUT_MAX_SINGLE_GBP = '200';
  process.env.PARTNER_CASHOUT_FIRST_MAX_GBP = '200';
  const single = await service.evaluateLimits({ partnerId: 'partner_1', denominationGbp: 250 });
  expect(single.violations.map(item => item.code)).toContain('PARTNER_CASHOUT_SINGLE_LIMIT');

  collections.partner_cashout_requests.push(cashout({ id: 'current', status: 'submitted' }));
  const excluded = await service.evaluateLimits({
    partnerId: 'partner_1',
    denominationGbp: 50,
    requestId: 'current',
  });
  expect(excluded.metrics.openRequestCount).toBe(0);
});

test('rolling 30-day exposure rejects a request even when the 24-hour window has elapsed', async () => {
  seedPartner();
  process.env.PARTNER_CASHOUT_FIRST_MAX_GBP = '500';
  process.env.PARTNER_CASHOUT_24H_MAX_GBP = '1000';
  process.env.PARTNER_CASHOUT_30D_MAX_GBP = '500';
  collections.partner_cashout_requests.push(
    cashout({
      id: 'prior',
      status: 'delivered',
      denominationGbp: 480,
      deliveredAt: '2026-07-20T10:00:00.000Z',
    })
  );
  const decision = await service.evaluateLimits({
    partnerId: 'partner_1',
    denominationGbp: 30,
    now: Date.parse('2026-08-01T10:00:00.000Z'),
  });
  expect(decision.metrics.rolling24hGbp).toBe(0);
  expect(decision.violations.map(item => item.code)).toContain('PARTNER_CASHOUT_30D_LIMIT');
});

test.each([
  [null, null, 'PARTNER_CASHOUT_IDENTITY_MISSING'],
  [{ status: 'inactive' }, {}, 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE'],
  [{ status: 'active' }, { verified: false }, 'PARTNER_CASHOUT_EMAIL_UNVERIFIED'],
  [
    { status: 'active', cashoutIdentityStatus: 'rejected' },
    {},
    'PARTNER_CASHOUT_IDENTITY_REJECTED',
  ],
])('identity decision returns the expected hard failure', async (partner, user, reason) => {
  if (partner) seedPartner({ partner, user });
  await expect(service.identityDecision('partner_1')).resolves.toMatchObject({
    eligible: false,
    reason,
  });
});

test('identity checks can be disabled, expire old reviews and detect company drift', async () => {
  seedPartner({
    partner: {
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: '2020-01-01T00:00:00.000Z',
      cashoutIdentityCompanySnapshot: 'Reviewed Company',
    },
    user: { company: 'Current Company' },
  });
  process.env.PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED = 'false';
  await expect(service.identityDecision('partner_1')).resolves.toMatchObject({ eligible: true });

  process.env.PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED = 'true';
  await expect(service.identityDecision('partner_1', Date.parse('2026-08-01T00:00:00.000Z'))).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_EXPIRED',
  });

  collections.partners[0].cashoutIdentityVerifiedAt = '2026-08-01T00:00:00.000Z';
  await expect(service.identityDecision('partner_1', Date.parse('2026-08-02T00:00:00.000Z'))).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_CHANGED',
  });
});

test('identity review validation rejects invalid status, short notes, missing partners and failed writes', async () => {
  await expect(
    service.setIdentityReview({ partnerId: 'partner_1', status: 'unknown', reason: 'x'.repeat(30) })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_IDENTITY_STATUS_INVALID' });
  await expect(
    service.setIdentityReview({ partnerId: 'partner_1', status: 'pending', reason: 'short' })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_IDENTITY_NOTE_REQUIRED' });
  await expect(
    service.setIdentityReview({ partnerId: 'missing', status: 'pending', reason: 'x'.repeat(30) })
  ).rejects.toMatchObject({ code: 'PARTNER_NOT_FOUND' });

  seedPartner();
  mockStrictStore.updateOne.mockResolvedValueOnce(false);
  await expect(
    service.setIdentityReview({
      partnerId: 'partner_1',
      status: 'rejected',
      reason: 'Identity evidence did not match the partner account.',
      adminUserId: 'admin_1',
    })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_IDENTITY_WRITE_FAILED' });
});

test('reconciliation rejects invalid request identity, snapshot mismatch and missing hold', async () => {
  await expect(service.reconcileRequest(null)).resolves.toMatchObject({
    ok: false,
    critical: true,
    issues: [expect.objectContaining({ code: 'CASHOUT_REQUEST_IDENTITY_INVALID' })],
  });

  const result = await service.reconcileRequest(
    cashout({ pointsHeld: 4000, holdTxnId: 'missing' })
  );
  expect(result.issues.map(item => item.code)).toEqual(
    expect.arrayContaining(['CASHOUT_POINTS_SNAPSHOT_MISMATCH', 'CASHOUT_HOLD_INTEGRITY_FAILED'])
  );
});

test('reconciliation detects duplicate and mismatched ledger mutations', async () => {
  const request = cashout({ status: 'delivered', finalRedeemTxnId: 'expected_redeem' });
  collections.partner_credit_transactions.push(
    transaction({ amount: -4000 }),
    transaction({ id: 'hold_2' }),
    transaction({ id: 'redeem_1', type: 'REDEEM', amount: -4000 }),
    transaction({ id: 'redeem_2', type: 'REDEEM', amount: -5000 }),
    transaction({ id: 'release_1', type: 'CASHOUT_RELEASE', amount: 4000, externalRef: 'hold_1' }),
    transaction({ id: 'release_2', type: 'CASHOUT_RELEASE', amount: 5000, externalRef: 'hold_1' })
  );

  const result = await service.reconcileRequest(request);
  const codes = result.issues.map(item => item.code);
  expect(codes).toEqual(
    expect.arrayContaining([
      'CASHOUT_HOLD_INTEGRITY_FAILED',
      'CASHOUT_REDEEM_DUPLICATED',
      'CASHOUT_RELEASE_DUPLICATED',
      'CASHOUT_DELIVERED_REDEEM_INVALID',
      'CASHOUT_DELIVERED_RELEASE_INVALID',
    ])
  );
});

test('an operations event must persist', async () => {
  mockStrictStore.insertOne.mockResolvedValueOnce(null);
  await expect(
    service.recordOpsEvent({ action: 'test', phase: 'completed', details: 'not-an-object' })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_AUDIT_WRITE_FAILED' });
});

test('submission decisions block inactive and identity-rejected partners and surface limit failures', async () => {
  seedPartner({ partner: { status: 'inactive' } });
  await expect(
    service.submissionDecision({ partnerId: 'partner_1', denominationGbp: 50 })
  ).resolves.toMatchObject({ allowed: false, reason: 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE' });

  collections.partners[0].status = 'active';
  collections.partners[0].cashoutIdentityStatus = 'rejected';
  await expect(
    service.submissionDecision({ partnerId: 'partner_1', denominationGbp: 50 })
  ).resolves.toMatchObject({ allowed: false, reason: 'PARTNER_CASHOUT_IDENTITY_REJECTED' });

  collections.partners[0].cashoutIdentityStatus = 'pending';
  await expect(
    service.submissionDecision({ partnerId: 'partner_1', denominationGbp: 9999 })
  ).resolves.toMatchObject({ allowed: false, reason: 'PARTNER_CASHOUT_SINGLE_LIMIT' });
});

test('approval decisions short-circuit pause, identity, limit and reconciliation failures', async () => {
  seedPartner();
  const request = cashout();

  collections.partner_programme_controls.push({
    id: service.CONTROL_ID,
    programmePaused: true,
  });
  await expect(service.approvalDecision(request)).resolves.toMatchObject({
    allowed: false,
    reason: 'PARTNER_PROGRAMME_PAUSED',
  });

  collections.partner_programme_controls.length = 0;
  await expect(service.approvalDecision(request)).resolves.toMatchObject({
    allowed: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED',
  });

  Object.assign(collections.partners[0], {
    cashoutIdentityStatus: 'verified',
    cashoutIdentityVerifiedAt: new Date().toISOString(),
    cashoutIdentityEmailSnapshot: 'partner@example.com',
    cashoutIdentityCompanySnapshot: 'Example Events Ltd',
  });
  process.env.PARTNER_CASHOUT_MAX_SINGLE_GBP = '100';
  process.env.PARTNER_CASHOUT_FIRST_MAX_GBP = '100';
  const excessive = cashout({ denominationGbp: 200 });
  await expect(service.approvalDecision(excessive)).resolves.toMatchObject({
    allowed: false,
    reason: 'PARTNER_CASHOUT_SINGLE_LIMIT',
  });

  delete process.env.PARTNER_CASHOUT_MAX_SINGLE_GBP;
  delete process.env.PARTNER_CASHOUT_FIRST_MAX_GBP;
  await expect(service.approvalDecision(request)).resolves.toMatchObject({
    allowed: false,
    reason: 'PARTNER_CASHOUT_RECONCILIATION_FAILED',
  });
});
