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
  findOne: jest.fn(
    async (collection, query) =>
      (collections[collection] || []).find(item => matches(item, query)) || null
  ),
  find: jest.fn(async (collection, query) =>
    (collections[collection] || []).filter(item => matches(item, query))
  ),
  insertOne: jest.fn(async (collection, item) => {
    collections[collection] = collections[collection] || [];
    collections[collection].push(item);
    return item;
  }),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  }),
  _test: { isDuplicateKey: jest.fn(error => error?.code === 11000) },
};

jest.mock('../../services/partnerCashoutStrictStore', () => mockStrictStore);
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_test` }));
jest.mock('../../services/partnerService', () => ({
  CREDIT_TYPES: {
    REDEEM: 'REDEEM',
    ADJUSTMENT: 'ADJUSTMENT',
    CASHOUT_HOLD: 'CASHOUT_HOLD',
    CASHOUT_RELEASE: 'CASHOUT_RELEASE',
  },
}));

const service = require('../../services/partnerCashoutOperationsService');

function seedPartner(overrides = {}) {
  collections.users.push({
    id: 'user_1',
    email: 'partner@example.com',
    company: 'Example Events Ltd',
    verified: true,
    ...overrides.user,
  });
  collections.partners.push({
    id: 'partner_1',
    userId: 'user_1',
    status: 'active',
    ...overrides.partner,
  });
}

function cashout(overrides = {}) {
  return {
    id: 'cashout_1',
    partnerId: 'partner_1',
    partnerUserId: 'user_1',
    denominationGbp: 50,
    pointsPerGbpSnapshot: 100,
    pointsHeld: 5000,
    status: 'submitted',
    holdTxnId: 'hold_1',
    finalRedeemTxnId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedValidHold(request = cashout()) {
  collections.partner_credit_transactions.push({
    id: request.holdTxnId,
    partnerId: request.partnerId,
    type: 'CASHOUT_HOLD',
    amount: -Math.abs(request.pointsHeld),
    externalRef: request.id,
    createdAt: request.createdAt,
  });
}

function seedRedeem(request = cashout(), overrides = {}) {
  const redeem = {
    id: 'redeem_1',
    partnerId: request.partnerId,
    type: 'REDEEM',
    amount: -Math.abs(request.pointsHeld),
    externalRef: request.id,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  collections.partner_credit_transactions.push(redeem);
  return redeem;
}

function seedRelease(request = cashout(), overrides = {}) {
  const release = {
    id: 'release_1',
    partnerId: request.partnerId,
    type: 'CASHOUT_RELEASE',
    amount: Math.abs(request.pointsHeld),
    externalRef: request.holdTxnId,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  collections.partner_credit_transactions.push(release);
  return release;
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

test('emergency cashout pause blocks a new submission before points are held', async () => {
  seedPartner();
  collections.partner_programme_controls.push({
    id: service.CONTROL_ID,
    cashoutsPaused: true,
    programmePaused: false,
    reason: 'Manual reconciliation in progress',
  });

  await expect(
    service.submissionDecision({ partnerId: 'partner_1', denominationGbp: 50 })
  ).resolves.toMatchObject({
    allowed: false,
    reason: 'PARTNER_CASHOUTS_PAUSED',
  });
});

test('cashout controls fail closed when authoritative storage is unavailable', async () => {
  mockStrictStore.ensureAuthoritative.mockRejectedValueOnce(
    Object.assign(new Error('storage unavailable'), { code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' })
  );
  await expect(service.ensureAuthoritativeStorage()).rejects.toMatchObject({
    code: 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE',
  });
});

test('first cashout is capped at £100 by default and flagged for manual review', async () => {
  seedPartner();
  const blocked = await service.evaluateLimits({ partnerId: 'partner_1', denominationGbp: 105 });
  expect(blocked.allowed).toBe(false);
  expect(blocked.violations.map(item => item.code)).toContain('PARTNER_CASHOUT_FIRST_LIMIT');

  const allowed = await service.evaluateLimits({ partnerId: 'partner_1', denominationGbp: 100 });
  expect(allowed.allowed).toBe(true);
  expect(allowed.requiresManualReview).toBe(true);
  expect(allowed.reviewReasons).toContain('FIRST_CASHOUT');
  expect(allowed.reviewReasons).toContain('HIGH_VALUE_CASHOUT');
});

test('open cashout and rolling limits include submitted requests so parallel requests cannot bypass exposure controls', async () => {
  seedPartner();
  collections.partner_cashout_requests.push(
    cashout({ id: 'existing', denominationGbp: 100, pointsHeld: 10000, status: 'submitted' })
  );

  const decision = await service.evaluateLimits({ partnerId: 'partner_1', denominationGbp: 50 });
  expect(decision.allowed).toBe(false);
  expect(decision.violations.map(item => item.code)).toContain(
    'PARTNER_CASHOUT_OPEN_REQUEST_LIMIT'
  );
  expect(decision.metrics.openRequestCount).toBe(1);
  expect(decision.metrics.rolling24hGbp).toBe(100);
});

test('rolling payout exposure uses the latest money-moving stage rather than an old submission date', async () => {
  seedPartner();
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  collections.partner_cashout_requests.push(
    cashout({
      id: 'delivered_recently',
      denominationGbp: 480,
      pointsHeld: 48000,
      status: 'delivered',
      createdAt: '2026-06-01T12:00:00.000Z',
      deliveredAt: '2026-07-28T11:00:00.000Z',
    })
  );

  const decision = await service.evaluateLimits({
    partnerId: 'partner_1',
    denominationGbp: 25,
    now,
  });
  expect(decision.metrics.rolling24hGbp).toBe(480);
  expect(decision.violations.map(item => item.code)).toContain('PARTNER_CASHOUT_24H_LIMIT');
});

test('cashout approval requires an explicit current identity review by default', async () => {
  seedPartner();
  await expect(service.identityDecision('partner_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED',
  });

  await service.setIdentityReview({
    partnerId: 'partner_1',
    status: 'verified',
    reason: 'Identity and current partner account records have been manually reviewed.',
    adminUserId: 'admin_1',
  });

  await expect(service.identityDecision('partner_1')).resolves.toMatchObject({ eligible: true });
  expect(collections.partners[0]).toMatchObject({
    cashoutIdentityStatus: 'verified',
    cashoutIdentityReviewedBy: 'admin_1',
    cashoutIdentityEmailSnapshot: 'partner@example.com',
  });
});

test('an administrator cannot verify cashout identity for an unverified partner email account', async () => {
  seedPartner({ user: { verified: false } });
  await expect(
    service.setIdentityReview({
      partnerId: 'partner_1',
      status: 'verified',
      reason: 'Identity records were checked but the email account is not verified yet.',
      adminUserId: 'admin_1',
    })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_IDENTITY_ACCOUNT_NOT_VERIFIED' });
});

test('identity review becomes invalid if the reviewed email changes', async () => {
  seedPartner({
    partner: {
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: new Date().toISOString(),
      cashoutIdentityEmailSnapshot: 'partner@example.com',
      cashoutIdentityCompanySnapshot: 'Example Events Ltd',
    },
  });
  collections.users[0].email = 'changed@example.com';

  await expect(service.identityDecision('partner_1')).resolves.toMatchObject({
    eligible: false,
    reason: 'PARTNER_CASHOUT_IDENTITY_CHANGED',
  });
});

test('reconciliation accepts one exact active hold before approval', async () => {
  seedPartner();
  const request = cashout();
  seedValidHold(request);

  await expect(service.reconcileRequest(request)).resolves.toMatchObject({
    ok: true,
    recoveryState: 'none',
    metrics: { holdCount: 1, releaseCount: 0, redeemCount: 0, expectedPoints: 5000 },
  });
});

test('reconciliation fails closed if a normal active request has already released its hold', async () => {
  seedPartner();
  const request = cashout();
  seedValidHold(request);
  seedRelease(request);

  const result = await service.reconcileRequest(request);
  expect(result.ok).toBe(false);
  expect(result.issues.map(item => item.code)).toContain('CASHOUT_HOLD_ALREADY_RELEASED');
});

test('delivery reconciliation permits recovery when the permanent redeem persisted before request status', async () => {
  seedPartner();
  const request = cashout({ status: 'processing' });
  seedValidHold(request);
  seedRedeem(request);

  await expect(
    service.reconcileRequest(request, { targetStatus: 'delivered' })
  ).resolves.toMatchObject({
    ok: true,
    recoveryState: 'redeem_persisted',
    metrics: { redeemCount: 1, releaseCount: 0 },
  });
});

test('delivery reconciliation permits recovery when redeem and hold release both persisted before request status', async () => {
  seedPartner();
  const request = cashout({ status: 'processing' });
  seedValidHold(request);
  seedRedeem(request);
  seedRelease(request);

  await expect(
    service.reconcileRequest(request, { targetStatus: 'delivered' })
  ).resolves.toMatchObject({
    ok: true,
    recoveryState: 'redeem_and_release_persisted',
    metrics: { redeemCount: 1, releaseCount: 1 },
  });
});

test('delivery recovery still blocks a released hold that has no matching redeem', async () => {
  seedPartner();
  const request = cashout({ status: 'processing' });
  seedValidHold(request);
  seedRelease(request);

  const result = await service.reconcileRequest(request, { targetStatus: 'delivered' });
  expect(result.ok).toBe(false);
  expect(result.issues.map(item => item.code)).toContain('CASHOUT_RELEASE_WITHOUT_REDEEM');
});

test('delivered reconciliation requires exactly one matching debit and hold release', async () => {
  seedPartner();
  const request = cashout({ status: 'delivered', finalRedeemTxnId: 'redeem_1' });
  seedValidHold(request);
  seedRedeem(request);
  seedRelease(request);

  await expect(service.reconcileRequest(request)).resolves.toMatchObject({
    ok: true,
    metrics: { holdCount: 1, releaseCount: 1, redeemCount: 1 },
  });
});

test('delivered reconciliation detects a redemption that was later reversed', async () => {
  seedPartner();
  const request = cashout({ status: 'delivered', finalRedeemTxnId: 'redeem_1' });
  seedValidHold(request);
  const redeem = seedRedeem(request);
  seedRelease(request);
  collections.partner_credit_transactions.push({
    id: 'reversal_1',
    partnerId: request.partnerId,
    type: 'ADJUSTMENT',
    subtype: 'CASHOUT_REDEEM_REVERSAL',
    amount: 5000,
    externalRef: redeem.id,
  });

  const result = await service.reconcileRequest(request);
  expect(result.ok).toBe(false);
  expect(result.issues.map(item => item.code)).toContain('CASHOUT_DELIVERED_REDEEM_REVERSED');
});

test('rejected interrupted redemption is valid only when one matching reversal restores it', async () => {
  seedPartner();
  const request = cashout({ status: 'rejected' });
  seedValidHold(request);
  const redeem = seedRedeem(request);
  seedRelease(request);

  let result = await service.reconcileRequest(request);
  expect(result.ok).toBe(false);
  expect(result.issues.map(item => item.code)).toContain(
    'CASHOUT_REJECTED_REDEEM_REVERSAL_INVALID'
  );

  collections.partner_credit_transactions.push({
    id: 'reversal_1',
    partnerId: request.partnerId,
    type: 'ADJUSTMENT',
    subtype: 'CASHOUT_REDEEM_REVERSAL',
    amount: 5000,
    externalRef: redeem.id,
  });
  result = await service.reconcileRequest(request);
  expect(result.ok).toBe(true);
  expect(result.metrics.redeemReversalCount).toBe(1);
});

test('approval decision combines pause, identity, limits and ledger reconciliation', async () => {
  seedPartner({
    partner: {
      cashoutIdentityStatus: 'verified',
      cashoutIdentityVerifiedAt: new Date().toISOString(),
      cashoutIdentityEmailSnapshot: 'partner@example.com',
      cashoutIdentityCompanySnapshot: 'Example Events Ltd',
    },
  });
  const request = cashout();
  collections.partner_cashout_requests.push(request);
  seedValidHold(request);

  await expect(service.approvalDecision(request)).resolves.toMatchObject({
    allowed: true,
    requiresManualReview: true,
    reconciliation: { ok: true, targetStatus: 'approved' },
  });
});

test('programme control changes require a reason and persist an emergency pause', async () => {
  await expect(
    service.setControls({ cashoutsPaused: true, reason: 'short', adminUserId: 'admin_1' })
  ).rejects.toMatchObject({ code: 'PARTNER_CASHOUT_CONTROL_REASON_REQUIRED' });

  const controls = await service.setControls({
    cashoutsPaused: true,
    reason: 'Suspicious cashout activity is being manually reconciled.',
    adminUserId: 'admin_1',
  });
  expect(controls).toMatchObject({ cashoutsPaused: true, updatedBy: 'admin_1' });
  expect(collections.partner_programme_controls).toHaveLength(1);
});

test('programme control first-write duplicate is recovered as an authoritative update', async () => {
  mockStrictStore.insertOne.mockImplementationOnce(async (_collection, item) => {
    collections.partner_programme_controls.push({ ...item, reason: 'competing writer' });
    throw Object.assign(new Error('duplicate key'), { code: 11000 });
  });

  const controls = await service.setControls({
    cashoutsPaused: true,
    reason: 'Manual fraud investigation requires a temporary payout pause.',
    adminUserId: 'admin_1',
  });
  expect(controls.cashoutsPaused).toBe(true);
  expect(collections.partner_programme_controls[0].reason).toBe(
    'Manual fraud investigation requires a temporary payout pause.'
  );
});

test('operations events are durable records rather than log-only messages', async () => {
  const event = await service.recordOpsEvent({
    action: 'cashout_status_transition',
    phase: 'requested',
    requestId: 'cashout_1',
    partnerId: 'partner_1',
    adminUserId: 'admin_1',
    reason: 'Reviewed request and supporting records.',
  });
  expect(event.id).toBe('pco_test');
  expect(collections.partner_cashout_ops_events).toHaveLength(1);
});
