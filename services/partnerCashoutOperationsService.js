'use strict';

const { uid } = require('../store');
const partnerService = require('./partnerService');
const strictStore = require('./partnerCashoutStrictStore');

const CONTROL_ID = 'partner_cashout_controls';
const OPEN_STATUSES = new Set(['submitted', 'approved', 'processing']);
const ROLLING_STATUSES = new Set(['submitted', 'approved', 'processing', 'delivered']);
const IDENTITY_STATUSES = new Set(['pending', 'verified', 'rejected']);

function integerEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function booleanEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

async function ensureAuthoritativeStorage() {
  return strictStore.ensureAuthoritative();
}

function getConfig() {
  const maxSingleCashoutGbp = integerEnv('PARTNER_CASHOUT_MAX_SINGLE_GBP', 500, 15, 5000);
  return {
    maxSingleCashoutGbp,
    firstCashoutMaxGbp: integerEnv(
      'PARTNER_CASHOUT_FIRST_MAX_GBP',
      Math.min(100, maxSingleCashoutGbp),
      15,
      maxSingleCashoutGbp
    ),
    rolling24hMaxGbp: integerEnv(
      'PARTNER_CASHOUT_24H_MAX_GBP',
      maxSingleCashoutGbp,
      15,
      20000
    ),
    rolling30dMaxGbp: integerEnv('PARTNER_CASHOUT_30D_MAX_GBP', 1000, 15, 100000),
    maxOpenRequests: integerEnv('PARTNER_CASHOUT_MAX_OPEN_REQUESTS', 1, 1, 20),
    highValueReviewGbp: integerEnv('PARTNER_CASHOUT_HIGH_VALUE_REVIEW_GBP', 100, 15, 5000),
    identityReviewRequired: booleanEnv('PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED', true),
    identityReviewMaxAgeDays: integerEnv('PARTNER_CASHOUT_IDENTITY_REVIEW_MAX_AGE_DAYS', 365, 1, 3650),
  };
}

function defaultControls() {
  return {
    id: CONTROL_ID,
    programmePaused: false,
    cashoutsPaused: false,
    reason: null,
    updatedBy: null,
    updatedAt: null,
  };
}

async function getControls() {
  const stored = await strictStore.findOne('partner_programme_controls', { id: CONTROL_ID });
  return stored ? { ...defaultControls(), ...stored } : defaultControls();
}

function pauseDecision(controls) {
  if (controls?.programmePaused === true) {
    return {
      blocked: true,
      code: 'PARTNER_PROGRAMME_PAUSED',
      message: 'The Partner Programme cashout pipeline is temporarily paused for operational review.',
    };
  }
  if (controls?.cashoutsPaused === true) {
    return {
      blocked: true,
      code: 'PARTNER_CASHOUTS_PAUSED',
      message: 'Partner cashouts are temporarily paused for operational review.',
    };
  }
  return { blocked: false };
}

async function setControls({ programmePaused, cashoutsPaused, reason, adminUserId }) {
  await ensureAuthoritativeStorage();
  if (typeof programmePaused !== 'boolean' && typeof cashoutsPaused !== 'boolean') {
    const error = new Error('At least one pause setting must be supplied.');
    error.code = 'PARTNER_CASHOUT_CONTROL_INVALID';
    throw error;
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 10) {
    const error = new Error('A reason of at least 10 characters is required for programme control changes.');
    error.code = 'PARTNER_CASHOUT_CONTROL_REASON_REQUIRED';
    throw error;
  }

  const current = await getControls();
  const now = new Date().toISOString();
  const next = {
    ...current,
    ...(typeof programmePaused === 'boolean' ? { programmePaused } : {}),
    ...(typeof cashoutsPaused === 'boolean' ? { cashoutsPaused } : {}),
    reason: cleanReason.slice(0, 1000),
    updatedBy: adminUserId || null,
    updatedAt: now,
  };

  const existing = await strictStore.findOne('partner_programme_controls', { id: CONTROL_ID });
  let persisted = false;
  if (existing) {
    persisted = await strictStore.updateOne(
      'partner_programme_controls',
      { id: CONTROL_ID },
      { $set: next }
    );
  } else {
    try {
      persisted = Boolean(await strictStore.insertOne('partner_programme_controls', next));
    } catch (error) {
      if (!strictStore._test.isDuplicateKey(error)) throw error;
      const raced = await strictStore.findOne('partner_programme_controls', { id: CONTROL_ID });
      if (raced) {
        persisted = await strictStore.updateOne(
          'partner_programme_controls',
          { id: CONTROL_ID },
          { $set: next }
        );
      }
    }
  }

  if (!persisted) {
    const verified = await strictStore.findOne('partner_programme_controls', { id: CONTROL_ID });
    persisted = Boolean(
      verified &&
        verified.programmePaused === next.programmePaused &&
        verified.cashoutsPaused === next.cashoutsPaused &&
        verified.reason === next.reason
    );
  }

  if (!persisted) {
    const error = new Error('Partner programme controls did not persist.');
    error.code = 'PARTNER_CASHOUT_CONTROL_WRITE_FAILED';
    throw error;
  }
  return next;
}

function cashoutDate(request) {
  const candidate =
    request?.deliveredAt || request?.processingAt || request?.approvedAt || request?.createdAt;
  const value = Date.parse(candidate);
  return Number.isFinite(value) ? value : null;
}

function cashoutAmount(request) {
  const value = Number(request?.denominationGbp);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function evaluateLimits({ partnerId, denominationGbp, requestId = null, now = Date.now() }) {
  await ensureAuthoritativeStorage();
  const config = getConfig();
  const requests = (await strictStore.find('partner_cashout_requests', { partnerId })) || [];
  const otherRequests = requests.filter(request => request.id !== requestId);
  const delivered = otherRequests.filter(request => request.status === 'delivered');
  const firstCashout = delivered.length === 0;
  const amount = Number(denominationGbp);
  const violations = [];
  const reviewReasons = [];

  const addViolation = (code, message, evidence = {}) => violations.push({ code, message, evidence });
  if (!Number.isFinite(amount) || amount <= 0) {
    addViolation('PARTNER_CASHOUT_AMOUNT_INVALID', 'The cashout amount is invalid.');
  } else {
    if (amount > config.maxSingleCashoutGbp) {
      addViolation('PARTNER_CASHOUT_SINGLE_LIMIT', 'The requested cashout exceeds the single-request limit.', {
        requestedGbp: amount,
        limitGbp: config.maxSingleCashoutGbp,
      });
    }
    if (firstCashout && amount > config.firstCashoutMaxGbp) {
      addViolation('PARTNER_CASHOUT_FIRST_LIMIT', 'The first cashout exceeds the launch-safety limit.', {
        requestedGbp: amount,
        limitGbp: config.firstCashoutMaxGbp,
      });
    }
    if (amount >= config.highValueReviewGbp) reviewReasons.push('HIGH_VALUE_CASHOUT');
  }

  const openRequests = otherRequests.filter(request => OPEN_STATUSES.has(request.status));
  if (openRequests.length >= config.maxOpenRequests) {
    addViolation('PARTNER_CASHOUT_OPEN_REQUEST_LIMIT', 'Too many cashout requests are already open.', {
      openRequestCount: openRequests.length,
      limit: config.maxOpenRequests,
    });
  }

  const rolling = windowMs =>
    otherRequests.filter(request => {
      if (!ROLLING_STATUSES.has(request.status)) return false;
      const at = cashoutDate(request);
      return at !== null && at >= now - windowMs;
    });
  const total = items => items.reduce((sum, request) => sum + cashoutAmount(request), 0);
  const prior24h = total(rolling(24 * 3600000));
  const prior30d = total(rolling(30 * 86400000));

  if (amount > 0 && prior24h + amount > config.rolling24hMaxGbp) {
    addViolation('PARTNER_CASHOUT_24H_LIMIT', 'The rolling 24-hour cashout limit would be exceeded.', {
      currentGbp: prior24h,
      requestedGbp: amount,
      limitGbp: config.rolling24hMaxGbp,
    });
  }
  if (amount > 0 && prior30d + amount > config.rolling30dMaxGbp) {
    addViolation('PARTNER_CASHOUT_30D_LIMIT', 'The rolling 30-day cashout limit would be exceeded.', {
      currentGbp: prior30d,
      requestedGbp: amount,
      limitGbp: config.rolling30dMaxGbp,
    });
  }
  if (firstCashout) reviewReasons.push('FIRST_CASHOUT');

  return {
    allowed: violations.length === 0,
    firstCashout,
    violations,
    requiresManualReview: reviewReasons.length > 0,
    reviewReasons: [...new Set(reviewReasons)],
    metrics: {
      openRequestCount: openRequests.length,
      rolling24hGbp: prior24h,
      rolling30dGbp: prior30d,
      priorDeliveredCount: delivered.length,
    },
    config,
  };
}

function normalisedIdentityValue(value) {
  return String(value || '').trim().toLowerCase();
}

async function identityDecision(partnerId, now = Date.now()) {
  await ensureAuthoritativeStorage();
  const config = getConfig();
  const partner = await strictStore.findOne('partners', { id: partnerId });
  const user = partner?.userId ? await strictStore.findOne('users', { id: partner.userId }) : null;

  if (!partner || !user) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_MISSING' };
  }
  if (partner.status !== 'active') {
    return { eligible: false, reason: 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE' };
  }
  if (user.verified !== true) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_EMAIL_UNVERIFIED' };
  }
  if (partner.cashoutIdentityStatus === 'rejected') {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_REJECTED' };
  }
  if (!config.identityReviewRequired) return { eligible: true, partner, user };
  if (partner.cashoutIdentityStatus !== 'verified' || !partner.cashoutIdentityVerifiedAt) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED' };
  }

  const verifiedAt = Date.parse(partner.cashoutIdentityVerifiedAt);
  if (
    !Number.isFinite(verifiedAt) ||
    verifiedAt < now - config.identityReviewMaxAgeDays * 86400000
  ) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_REVIEW_EXPIRED' };
  }
  if (
    partner.cashoutIdentityEmailSnapshot &&
    normalisedIdentityValue(partner.cashoutIdentityEmailSnapshot) !== normalisedIdentityValue(user.email)
  ) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_CHANGED' };
  }
  if (
    partner.cashoutIdentityCompanySnapshot &&
    normalisedIdentityValue(partner.cashoutIdentityCompanySnapshot) !== normalisedIdentityValue(user.company)
  ) {
    return { eligible: false, reason: 'PARTNER_CASHOUT_IDENTITY_CHANGED' };
  }
  return { eligible: true, partner, user };
}

async function setIdentityReview({ partnerId, status, reason, adminUserId }) {
  await ensureAuthoritativeStorage();
  if (!IDENTITY_STATUSES.has(status)) {
    const error = new Error('Identity review status must be pending, verified or rejected.');
    error.code = 'PARTNER_CASHOUT_IDENTITY_STATUS_INVALID';
    throw error;
  }
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 20) {
    const error = new Error('An identity review note of at least 20 characters is required.');
    error.code = 'PARTNER_CASHOUT_IDENTITY_NOTE_REQUIRED';
    throw error;
  }

  const partner = await strictStore.findOne('partners', { id: partnerId });
  if (!partner) {
    const error = new Error('Partner not found.');
    error.code = 'PARTNER_NOT_FOUND';
    throw error;
  }
  const partnerUser = partner.userId ? await strictStore.findOne('users', { id: partner.userId }) : null;
  if (status === 'verified' && (!partnerUser || partnerUser.verified !== true)) {
    const error = new Error(
      'A partner with a verified email account is required before cashout identity can be verified.'
    );
    error.code = 'PARTNER_CASHOUT_IDENTITY_ACCOUNT_NOT_VERIFIED';
    throw error;
  }

  const now = new Date().toISOString();
  const updates = {
    cashoutIdentityStatus: status,
    cashoutIdentityReviewNote: cleanReason.slice(0, 2000),
    cashoutIdentityReviewedBy: adminUserId || null,
    cashoutIdentityReviewedAt: now,
    cashoutIdentityVerifiedAt: status === 'verified' ? now : null,
    cashoutIdentityEmailSnapshot: status === 'verified' ? partnerUser.email || null : null,
    cashoutIdentityCompanySnapshot: status === 'verified' ? partnerUser.company || null : null,
    updatedAt: now,
  };
  const persisted = await strictStore.updateOne('partners', { id: partnerId }, { $set: updates });
  if (!persisted) {
    const error = new Error('Cashout identity review did not persist.');
    error.code = 'PARTNER_CASHOUT_IDENTITY_WRITE_FAILED';
    throw error;
  }
  return { ...partner, ...updates };
}

function issue(code, message, severity = 'error', evidence = {}) {
  return { code, message, severity, evidence };
}

async function reconcileRequest(cashoutRequest, options = {}) {
  await ensureAuthoritativeStorage();
  const targetStatus = options?.targetStatus || null;
  const issues = [];
  if (!cashoutRequest?.id || !cashoutRequest.partnerId) {
    return {
      ok: false,
      critical: true,
      issues: [issue('CASHOUT_REQUEST_IDENTITY_INVALID', 'Cashout request identity is invalid.')],
    };
  }

  const transactions =
    (await strictStore.find('partner_credit_transactions', {
      partnerId: cashoutRequest.partnerId,
    })) || [];
  const expectedPoints =
    Number(cashoutRequest.denominationGbp) * Number(cashoutRequest.pointsPerGbpSnapshot);
  if (
    !Number.isFinite(expectedPoints) ||
    expectedPoints <= 0 ||
    Number(cashoutRequest.pointsHeld) !== expectedPoints
  ) {
    issues.push(
      issue(
        'CASHOUT_POINTS_SNAPSHOT_MISMATCH',
        'Cashout held points do not match the denomination snapshot.',
        'error',
        {
          expectedPoints: Number.isFinite(expectedPoints) ? expectedPoints : null,
          pointsHeld: cashoutRequest.pointsHeld,
        }
      )
    );
  }

  const holds = transactions.filter(
    transaction =>
      transaction.type === partnerService.CREDIT_TYPES.CASHOUT_HOLD &&
      transaction.externalRef === cashoutRequest.id
  );
  const hold = cashoutRequest.holdTxnId
    ? holds.find(transaction => transaction.id === cashoutRequest.holdTxnId)
    : holds[0];
  if (holds.length !== 1 || !hold) {
    issues.push(
      issue(
        'CASHOUT_HOLD_INTEGRITY_FAILED',
        'Cashout must have exactly one matching hold transaction.',
        'error',
        {
          holdCount: holds.length,
          storedHoldTxnId: cashoutRequest.holdTxnId || null,
        }
      )
    );
  } else if (
    Number.isFinite(Number(cashoutRequest.pointsHeld)) &&
    Number(hold.amount) !== -Math.abs(Number(cashoutRequest.pointsHeld))
  ) {
    issues.push(issue('CASHOUT_HOLD_AMOUNT_MISMATCH', 'Cashout hold amount does not match held points.'));
  }

  const releases = hold
    ? transactions.filter(
        transaction =>
          transaction.type === partnerService.CREDIT_TYPES.CASHOUT_RELEASE &&
          transaction.externalRef === hold.id
      )
    : [];
  const redeems = transactions.filter(
    transaction =>
      transaction.type === partnerService.CREDIT_TYPES.REDEEM &&
      transaction.externalRef === cashoutRequest.id
  );
  const adjustmentType = partnerService.CREDIT_TYPES.ADJUSTMENT || 'ADJUSTMENT';
  const redeemReversals = redeems.flatMap(redeem =>
    transactions.filter(
      transaction =>
        transaction.type === adjustmentType &&
        transaction.subtype === 'CASHOUT_REDEEM_REVERSAL' &&
        transaction.externalRef === redeem.id
    )
  );

  if (redeems.length > 1) {
    issues.push(
      issue('CASHOUT_REDEEM_DUPLICATED', 'Cashout has more than one permanent redemption debit.', 'error', {
        redeemCount: redeems.length,
      })
    );
  }
  if (releases.length > 1) {
    issues.push(
      issue('CASHOUT_RELEASE_DUPLICATED', 'Cashout hold has been released more than once.', 'error', {
        releaseCount: releases.length,
      })
    );
  }
  if (
    redeems.length === 1 &&
    Number(redeems[0].amount) !== -Math.abs(Number(cashoutRequest.pointsHeld))
  ) {
    issues.push(issue('CASHOUT_REDEEM_AMOUNT_MISMATCH', 'Cashout redemption amount does not match held points.'));
  }
  if (
    releases.length === 1 &&
    Number(releases[0].amount) !== Math.abs(Number(cashoutRequest.pointsHeld))
  ) {
    issues.push(issue('CASHOUT_RELEASE_AMOUNT_MISMATCH', 'Cashout hold release amount does not match held points.'));
  }
  if (
    cashoutRequest.finalRedeemTxnId &&
    redeems.length === 1 &&
    redeems[0].id !== cashoutRequest.finalRedeemTxnId
  ) {
    issues.push(
      issue('CASHOUT_REDEEM_ID_MISMATCH', 'Stored final redemption ID does not match the cashout ledger debit.')
    );
  }

  const active = ['submitted', 'approved', 'processing'].includes(cashoutRequest.status);
  const deliveryRecovery = cashoutRequest.status === 'processing' && targetStatus === 'delivered';

  if (active && deliveryRecovery) {
    // The existing delivery handler is intentionally idempotent. Permit its two
    // recoverable interrupted states: redemption persisted, or redemption and hold
    // release persisted, before the final request-status write completed.
    if (releases.length > 0 && redeems.length === 0) {
      issues.push(
        issue(
          'CASHOUT_RELEASE_WITHOUT_REDEEM',
          'Cashout hold was released before a matching permanent redemption existed.'
        )
      );
    }
    if (redeemReversals.length > 0) {
      issues.push(
        issue(
          'CASHOUT_DELIVERY_REDEEM_REVERSED',
          'A cashout being delivered contains a prior redemption reversal and requires manual repair.'
        )
      );
    }
  } else if (active) {
    if (releases.length > 0) {
      issues.push(issue('CASHOUT_HOLD_ALREADY_RELEASED', 'An active cashout has already released its hold.'));
    }
    if (redeems.length > 0) {
      issues.push(issue('CASHOUT_REDEEM_PREMATURE', 'An undelivered cashout already has a redemption debit.'));
    }
  }

  if (cashoutRequest.status === 'delivered') {
    if (redeems.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_REDEEM_INVALID',
          'Delivered cashout must have exactly one redemption debit.',
          'error',
          { redeemCount: redeems.length }
        )
      );
    }
    if (releases.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_RELEASE_INVALID',
          'Delivered cashout must have exactly one hold release.',
          'error',
          { releaseCount: releases.length }
        )
      );
    }
    if (redeemReversals.length > 0) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_REDEEM_REVERSED',
          'Delivered cashout contains a redemption reversal and is financially inconsistent.'
        )
      );
    }
  }

  if (cashoutRequest.status === 'rejected' && hold) {
    if (releases.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_REJECTED_RELEASE_INVALID',
          'Rejected cashout must release its hold exactly once.',
          'error',
          { releaseCount: releases.length }
        )
      );
    }
    if (redeems.length === 1) {
      if (redeemReversals.length !== 1) {
        issues.push(
          issue(
            'CASHOUT_REJECTED_REDEEM_REVERSAL_INVALID',
            'Rejected cashout with an interrupted redemption must contain exactly one matching reversal.',
            'error',
            { reversalCount: redeemReversals.length }
          )
        );
      } else if (Number(redeemReversals[0].amount) !== Math.abs(Number(redeems[0].amount))) {
        issues.push(
          issue(
            'CASHOUT_REJECTED_REDEEM_REVERSAL_AMOUNT_MISMATCH',
            'Rejected cashout redemption reversal does not restore the original debit amount.'
          )
        );
      }
    }
  }

  let recoveryState = 'none';
  if (deliveryRecovery && redeems.length === 1 && releases.length === 0) {
    recoveryState = 'redeem_persisted';
  } else if (deliveryRecovery && redeems.length === 1 && releases.length === 1) {
    recoveryState = 'redeem_and_release_persisted';
  }

  return {
    ok: issues.length === 0,
    critical: issues.some(item => item.severity === 'error'),
    issues,
    targetStatus,
    recoveryState,
    metrics: {
      holdCount: holds.length,
      releaseCount: releases.length,
      redeemCount: redeems.length,
      redeemReversalCount: redeemReversals.length,
      expectedPoints: Number.isFinite(expectedPoints) ? expectedPoints : null,
    },
    reconciledAt: new Date().toISOString(),
  };
}

async function recordOpsEvent({
  action,
  phase,
  requestId = null,
  partnerId = null,
  adminUserId = null,
  reason = null,
  details = {},
}) {
  await ensureAuthoritativeStorage();
  const event = {
    id: uid('pco'),
    action,
    phase,
    requestId,
    partnerId,
    adminUserId,
    reason: reason ? String(reason).trim().slice(0, 2000) : null,
    details: details && typeof details === 'object' ? details : {},
    createdAt: new Date().toISOString(),
  };
  const persisted = await strictStore.insertOne('partner_cashout_ops_events', event);
  if (!persisted) {
    const error = new Error('Cashout operations audit event did not persist.');
    error.code = 'PARTNER_CASHOUT_AUDIT_WRITE_FAILED';
    throw error;
  }
  return event;
}

async function submissionDecision({ partnerId, denominationGbp }) {
  const controls = await getControls();
  const pause = pauseDecision(controls);
  if (pause.blocked) return { allowed: false, reason: pause.code, message: pause.message, controls };
  const partner = await strictStore.findOne('partners', { id: partnerId });
  if (!partner || partner.status !== 'active') {
    return { allowed: false, reason: 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE' };
  }
  if (partner.cashoutIdentityStatus === 'rejected') {
    return { allowed: false, reason: 'PARTNER_CASHOUT_IDENTITY_REJECTED' };
  }
  const limits = await evaluateLimits({ partnerId, denominationGbp });
  if (!limits.allowed) {
    return {
      allowed: false,
      reason: limits.violations[0]?.code || 'PARTNER_CASHOUT_LIMIT_REACHED',
      message: limits.violations[0]?.message,
      limits,
    };
  }
  return { allowed: true, limits, controls };
}

async function approvalDecision(cashoutRequest) {
  const controls = await getControls();
  const pause = pauseDecision(controls);
  if (pause.blocked) return { allowed: false, reason: pause.code, message: pause.message, controls };

  const [identity, limits, reconciliation] = await Promise.all([
    identityDecision(cashoutRequest.partnerId),
    evaluateLimits({
      partnerId: cashoutRequest.partnerId,
      denominationGbp: cashoutRequest.denominationGbp,
      requestId: cashoutRequest.id,
    }),
    reconcileRequest(cashoutRequest, { targetStatus: 'approved' }),
  ]);
  if (!identity.eligible) {
    return { allowed: false, reason: identity.reason, identity, limits, reconciliation };
  }
  if (!limits.allowed) {
    return {
      allowed: false,
      reason: limits.violations[0]?.code || 'PARTNER_CASHOUT_LIMIT_REACHED',
      identity,
      limits,
      reconciliation,
    };
  }
  if (!reconciliation.ok) {
    return {
      allowed: false,
      reason: 'PARTNER_CASHOUT_RECONCILIATION_FAILED',
      identity,
      limits,
      reconciliation,
    };
  }
  return {
    allowed: true,
    identity,
    limits,
    reconciliation,
    requiresManualReview: limits.requiresManualReview,
    reviewReasons: limits.reviewReasons,
  };
}

module.exports = {
  CONTROL_ID,
  OPEN_STATUSES,
  ROLLING_STATUSES,
  IDENTITY_STATUSES,
  getConfig,
  ensureAuthoritativeStorage,
  getControls,
  setControls,
  pauseDecision,
  evaluateLimits,
  identityDecision,
  setIdentityReview,
  reconcileRequest,
  recordOpsEvent,
  submissionDecision,
  approvalDecision,
  _test: {
    integerEnv,
    booleanEnv,
    cashoutDate,
    cashoutAmount,
    normalisedIdentityValue,
  },
};
