'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const HIGH_RISK_SCORE = 60;
const REVIEW_SCORE = 25;
const FIRST_CASHOUT_REVIEW_SCORE = 20;
const RAPID_CASHOUT_HOURS = 72;
const RAPID_MILESTONE_HOURS = 2;
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

let rewardGuardsInstalled = false;

function normalise(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function emailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  return value.includes('@') ? value.split('@').pop() : '';
}

function hoursBetween(earlier, later) {
  const start = new Date(earlier).getTime();
  const end = new Date(later).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
}

function addSignal(signals, code, score, message, evidence = {}) {
  signals.push({ code, score, message, evidence });
}

function assessmentId(partnerId, requestId) {
  return crypto
    .createHash('sha256')
    .update(`${partnerId}:${requestId || 'preview'}`)
    .digest('hex')
    .slice(0, 20);
}

async function supplierRewardEligibility(supplierUserId) {
  const supplier = await dbUnified.findOne('users', { id: supplierUserId });
  if (!supplier || supplier.role !== 'supplier') {
    return { eligible: false, reason: 'SUPPLIER_ACCOUNT_MISSING' };
  }
  if (supplier.verified !== true) {
    return { eligible: false, reason: 'SUPPLIER_EMAIL_UNVERIFIED', supplier };
  }
  if (!String(supplier.company || '').trim()) {
    return { eligible: false, reason: 'SUPPLIER_COMPANY_MISSING', supplier };
  }

  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return { eligible: false, reason: 'REFERRAL_RECORD_MISSING', supplier };

  const partner = await dbUnified.findOne('partners', { id: referral.partnerId });
  if (!partner || partner.status !== 'active') {
    return { eligible: false, reason: 'PARTNER_NOT_ACTIVE', supplier, referral };
  }
  const partnerUser = await dbUnified.findOne('users', { id: partner.userId });
  if (!partnerUser) {
    return { eligible: false, reason: 'PARTNER_IDENTITY_MISSING', supplier, referral, partner };
  }

  const supplierCompany = normalise(supplier.company);
  const partnerCompany = normalise(partnerUser.company);
  const supplierDomain = emailDomain(supplier.email);
  const partnerDomain = emailDomain(partnerUser.email);
  const samePrivateDomain =
    supplierDomain &&
    partnerDomain &&
    supplierDomain === partnerDomain &&
    !PUBLIC_EMAIL_DOMAINS.has(supplierDomain);
  const sameCompany = supplierCompany && partnerCompany && supplierCompany === partnerCompany;

  if (partner.userId === supplierUserId || samePrivateDomain || sameCompany) {
    return {
      eligible: false,
      reason: 'POSSIBLE_SELF_REFERRAL',
      supplier,
      referral,
      partner,
      evidence: { samePrivateDomain, sameCompany },
    };
  }

  return { eligible: true, supplier, referral, partner, partnerUser };
}

function installRewardGuards(partnerService = require('./partnerService')) {
  if (rewardGuardsInstalled) return partnerService;

  const rewardMethods = [
    'awardReferralSignupBonus',
    'awardPackageBonus',
    'awardFirstReviewBonus',
    'awardSubscriptionBonus',
  ];

  for (const methodName of rewardMethods) {
    const original = partnerService[methodName];
    if (typeof original !== 'function') continue;
    partnerService[methodName] = async supplierUserId => {
      const eligibility = await supplierRewardEligibility(supplierUserId);
      if (!eligibility.eligible) {
        logger.warn('[PARTNER-ANTI-ABUSE] Reward withheld', {
          methodName,
          supplierUserId,
          reason: eligibility.reason,
          evidence: eligibility.evidence,
        });
        return null;
      }
      return original(supplierUserId);
    };
  }

  rewardGuardsInstalled = true;
  logger.info('[PARTNER-ANTI-ABUSE] Reward eligibility guards installed');
  return partnerService;
}

function deferredSignupRewardMiddleware(req, res, next) {
  const verificationRequest =
    (req.method === 'GET' && req.path === '/verify') ||
    (req.method === 'POST' && req.path === '/verify-email');
  if (!verificationRequest) return next();

  const originalJson = res.json.bind(res);
  res.json = body => {
    if (body?.ok === true && body?.user?.id) {
      const partnerService = installRewardGuards();
      setImmediate(() => {
        partnerService.awardReferralSignupBonus(body.user.id).catch(error => {
          logger.warn('[PARTNER-ANTI-ABUSE] Deferred signup reward failed', {
            supplierUserId: body.user.id,
            error: error.message,
          });
        });
      });
    }
    return originalJson(body);
  };
  return next();
}

async function assessCashout({ partnerId, requestId = null, requestedAt = new Date().toISOString() }) {
  const [partners, users, referrals, transactions, requests] = await Promise.all([
    dbUnified.read('partners'),
    dbUnified.read('users'),
    dbUnified.read('partner_referrals'),
    dbUnified.read('partner_credit_transactions'),
    dbUnified.read('partner_cashout_requests'),
  ]);

  const partner = (partners || []).find(item => item.id === partnerId);
  const partnerUser = partner ? (users || []).find(user => user.id === partner.userId) : null;
  const partnerReferrals = (referrals || []).filter(item => item.partnerId === partnerId);
  const partnerTransactions = (transactions || []).filter(item => item.partnerId === partnerId);
  const priorRequests = (requests || []).filter(
    item => item.partnerId === partnerId && item.id !== requestId
  );
  const signals = [];

  if (!partner || !partnerUser) {
    addSignal(signals, 'MISSING_PARTNER_IDENTITY', 100, 'Partner identity record is missing.');
  } else {
    if (partner.status !== 'active') {
      addSignal(signals, 'PARTNER_NOT_ACTIVE', 100, 'Partner account is not active.', {
        status: partner.status,
      });
    }
    if (partnerUser.verified !== true) {
      addSignal(signals, 'PARTNER_EMAIL_UNVERIFIED', 50, 'Partner email is not verified.');
    }
  }

  if (priorRequests.length === 0) {
    addSignal(
      signals,
      'FIRST_CASHOUT',
      FIRST_CASHOUT_REVIEW_SCORE,
      'This is the partner’s first cashout and must be reviewed manually.'
    );
  }

  const partnerAgeHours = partner?.createdAt ? hoursBetween(partner.createdAt, requestedAt) : null;
  if (partnerAgeHours !== null && partnerAgeHours < RAPID_CASHOUT_HOURS) {
    addSignal(signals, 'RAPID_FIRST_CASHOUT', 35, 'Cashout requested shortly after partner signup.', {
      partnerAgeHours: Math.round(partnerAgeHours * 10) / 10,
    });
  }

  if (partnerReferrals.length === 0) {
    addSignal(signals, 'NO_REFERRAL_RECORDS', 40, 'Cashout has no supporting referral records.');
  }

  const partnerCompany = normalise(partnerUser?.company);
  const partnerDomain = emailDomain(partnerUser?.email);
  const supplierDomains = new Map();
  let unverifiedSuppliers = 0;
  let identityMatches = 0;
  let rapidMilestones = 0;

  for (const referral of partnerReferrals) {
    const supplier = (users || []).find(user => user.id === referral.supplierUserId);
    if (!supplier || supplier.verified !== true) unverifiedSuppliers += 1;

    const supplierDomain = emailDomain(supplier?.email);
    if (supplierDomain) {
      supplierDomains.set(supplierDomain, (supplierDomains.get(supplierDomain) || 0) + 1);
    }

    const supplierCompany = normalise(supplier?.company);
    if (
      (partnerDomain &&
        supplierDomain &&
        partnerDomain === supplierDomain &&
        !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
      (partnerCompany && supplierCompany && partnerCompany === supplierCompany)
    ) {
      identityMatches += 1;
    }

    const supplierTxns = partnerTransactions.filter(
      txn => txn.supplierUserId === referral.supplierUserId && Number(txn.amount) > 0
    );
    for (const txn of supplierTxns) {
      const elapsed = hoursBetween(referral.supplierCreatedAt || referral.createdAt, txn.createdAt);
      if (
        elapsed !== null &&
        elapsed < RAPID_MILESTONE_HOURS &&
        txn.type !== 'REFERRAL_SIGNUP_BONUS'
      ) {
        rapidMilestones += 1;
      }
    }
  }

  if (unverifiedSuppliers > 0) {
    addSignal(
      signals,
      'UNVERIFIED_REFERRED_SUPPLIERS',
      30,
      'One or more rewarded suppliers are unverified.',
      { count: unverifiedSuppliers }
    );
  }
  if (identityMatches > 0) {
    addSignal(
      signals,
      'POSSIBLE_SELF_REFERRAL',
      50,
      'Partner and supplier identity details overlap.',
      { count: identityMatches }
    );
  }
  if (rapidMilestones > 0) {
    addSignal(
      signals,
      'RAPID_MILESTONE_COMPLETION',
      25,
      'Milestones completed unusually quickly after signup.',
      { count: rapidMilestones }
    );
  }

  const repeatedDomains = [...supplierDomains.entries()].filter(([, count]) => count >= 3);
  if (repeatedDomains.length) {
    addSignal(
      signals,
      'CONCENTRATED_EMAIL_DOMAINS',
      20,
      'Several referred suppliers use the same email domain.',
      { domains: repeatedDomains.map(([domain, count]) => ({ domain, count })) }
    );
  }

  const rewardBySupplier = new Map();
  for (const txn of partnerTransactions) {
    if (!txn.supplierUserId || Number(txn.amount) <= 0) continue;
    rewardBySupplier.set(
      txn.supplierUserId,
      (rewardBySupplier.get(txn.supplierUserId) || 0) + Number(txn.amount)
    );
  }
  const orphanRewardSuppliers = [...rewardBySupplier.keys()].filter(
    supplierUserId =>
      !partnerReferrals.some(referral => referral.supplierUserId === supplierUserId)
  );
  if (orphanRewardSuppliers.length) {
    addSignal(
      signals,
      'ORPHAN_REWARD_TRANSACTIONS',
      60,
      'Reward transactions exist without referral records.',
      { count: orphanRewardSuppliers.length }
    );
  }

  const score = Math.min(100, signals.reduce((total, signal) => total + signal.score, 0));
  const result = {
    id: assessmentId(partnerId, requestId),
    partnerId,
    requestId,
    score,
    riskLevel: score >= HIGH_RISK_SCORE ? 'high' : score >= REVIEW_SCORE ? 'review' : 'low',
    requiresManualReview: score >= REVIEW_SCORE || priorRequests.length === 0,
    blockApproval: score >= HIGH_RISK_SCORE,
    signals,
    metrics: {
      referralCount: partnerReferrals.length,
      priorCashoutCount: priorRequests.length,
      unverifiedSupplierCount: unverifiedSuppliers,
      identityMatchCount: identityMatches,
      rapidMilestoneCount: rapidMilestones,
    },
    assessedAt: new Date().toISOString(),
  };

  logger.info('[PARTNER-ANTI-ABUSE] Cashout assessed', {
    partnerId,
    requestId,
    score: result.score,
    riskLevel: result.riskLevel,
    signalCodes: signals.map(signal => signal.code),
  });

  return result;
}

async function persistAssessment(assessment) {
  const existing = assessment.requestId
    ? await dbUnified.findOne('partner_fraud_assessments', { requestId: assessment.requestId })
    : null;
  if (existing) {
    await dbUnified.updateOne(
      'partner_fraud_assessments',
      { id: existing.id },
      { $set: { ...assessment, id: existing.id } }
    );
    return { ...assessment, id: existing.id };
  }
  const inserted = await dbUnified.insertOne('partner_fraud_assessments', assessment);
  if (!inserted) throw new Error('Fraud assessment did not persist');
  return assessment;
}

module.exports = {
  HIGH_RISK_SCORE,
  REVIEW_SCORE,
  assessCashout,
  persistAssessment,
  supplierRewardEligibility,
  installRewardGuards,
  deferredSignupRewardMiddleware,
  emailDomain,
  normalise,
};
