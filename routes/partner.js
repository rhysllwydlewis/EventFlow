/**
 * Partner Portal Routes
 * Partner registration, dashboard data, referrals, support and reward redemption.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { JWT_SECRET, authRequired, roleRequired, setAuthCookie } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { authLimiter } = require('../middleware/rateLimits');
const { passwordOk } = require('../middleware/validation');
const partnerService = require('../services/partnerService');
const postmark = require('../utils/postmark');
const { notifyAdmins } = require('../services/notifyAdmins.service');

const router = express.Router();
const CASHOUT_METHODS = Object.freeze(['amazon_voucher', 'prepaid_debit_card']);
const cashoutLocks = new Map();

function getCashoutDenominations() {
  const configured = String(process.env.CASHOUT_DENOMINATIONS || '')
    .split(',')
    .map(value => parseInt(value.trim(), 10))
    .filter(value => Number.isInteger(value) && value > 0);
  if (configured.length) {
    return [...new Set(configured)].sort((a, b) => a - b);
  }
  return Array.from({ length: 98 }, (_, index) => 15 + index * 5); // £15 to £500
}

function getProgrammeConfig() {
  const cashoutDenominations = getCashoutDenominations();
  return {
    pointsPerGbp: partnerService.POINTS_PER_GBP,
    maturityDays: partnerService.CREDIT_MATURITY_DAYS,
    attributionDays: partnerService.ATTRIBUTION_DAYS,
    minimumCashoutGbp: Math.min(...cashoutDenominations),
    cashoutDenominations,
    cashoutMethods: CASHOUT_METHODS,
  };
}

function getBaseUrl(req) {
  return process.env.BASE_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function disabledResponse(
  res,
  message = 'Your partner account has been disabled. Please contact support.'
) {
  return res.status(403).json({ error: message, disabled: true, supportAvailable: true });
}

function cleanIdempotencyKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9:_-]{8,120}$/.test(key) ? key : '';
}

async function withPartnerCashoutLock(partnerId, work) {
  const previous = cashoutLocks.get(partnerId) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  cashoutLocks.set(partnerId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (cashoutLocks.get(partnerId) === tail) {
      cashoutLocks.delete(partnerId);
    }
  }
}

function getPartnerForUser(userId) {
  return partnerService.getPartnerByUserId(userId);
}

async function getMaskedUsersById() {
  const users = await dbUnified.read('users');
  return new Map(users.map(user => [user.id, user]));
}

function maskedUserName(user) {
  return partnerService.maskReferralName(
    user ? user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() : null,
    user ? user.company : null,
    user ? user.email : null
  );
}

function ticketPublicShape(ticket) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    message: ticket.message,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastReplyAt: ticket.lastReplyAt,
    lastReplyBy: ticket.lastReplyBy,
    responses: Array.isArray(ticket.responses) ? ticket.responses : [],
    responseCount: Array.isArray(ticket.responses) ? ticket.responses.length : 0,
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

router.post('/register', authLimiter, csrfProtection, async (req, res) => {
  try {
    const { firstName, lastName, email, password, location, company } = req.body || {};
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    if (!email || !validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!password || !passwordOk(password)) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 8 characters and include letters and numbers' });
    }
    if (!location) {
      return res.status(400).json({ error: 'Location is required' });
    }

    const emailLower = String(email).toLowerCase();
    if (await dbUnified.findOne('users', { email: emailLower })) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const now = new Date().toISOString();
    const user = {
      id: uid('usr'),
      firstName: String(firstName).trim().slice(0, 40),
      lastName: String(lastName).trim().slice(0, 40),
      email: emailLower,
      role: 'partner',
      passwordHash: await bcrypt.hash(password, 10),
      location: String(location).trim().slice(0, 100),
      company: company ? String(company).trim().slice(0, 100) : undefined,
      verified: true,
      notify_account: true,
      createdAt: now,
      updatedAt: now,
    };
    user.name = `${user.firstName} ${user.lastName}`;

    if (!(await dbUnified.insertOne('users', user))) {
      return res.status(500).json({ error: 'Failed to create partner account. Please try again.' });
    }
    const partner = await partnerService.createPartner(user.id);
    const baseUrl = getBaseUrl(req);
    const refLink = `${baseUrl}/auth?ref=${partner.refCode}&role=supplier`;

    postmark
      .sendMail({
        to: user.email,
        subject: 'Welcome to the EventFlow Partner Programme',
        template: 'partner-welcome',
        templateData: {
          name: user.firstName,
          refCode: partner.refCode,
          refLink,
          dashboardLink: `${baseUrl}/partner/dashboard`,
        },
        from: postmark.FROM_HELLO,
        tags: ['partner-welcome', 'transactional'],
        messageStream: 'outbound',
      })
      .catch(error => logger.warn('Partner welcome email failed:', error.message));

    notifyAdmins({
      type: 'system',
      title: 'New Partner Registration',
      message: `${user.name} joined the Partner Programme (code: ${partner.refCode})`,
      actionUrl: `/admin-user-detail?id=${user.id}`,
      actionText: 'View Partner',
      priority: 'normal',
      metadata: { partnerId: partner.id, userId: user.id, refCode: partner.refCode },
    }).catch(() => {});

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });
    setAuthCookie(res, token, { remember: true });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.status(201).json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      partner: { refCode: partner.refCode },
    });
  } catch (error) {
    logger.error('Error registering partner:', error);
    return res.status(500).json({ error: 'Failed to create partner account. Please try again.' });
  }
});

// ─── Dashboard core ───────────────────────────────────────────────────────────

router.get('/me', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const [credits, pending, userRecord] = await Promise.all([
      partnerService.getBalance(partner.id),
      partnerService.getPendingPoints(partner.id),
      dbUnified.findOne('users', { id: req.user.id }),
    ]);
    const config = getProgrammeConfig();
    return res.json({
      partner: {
        id: partner.id,
        refCode: partner.refCode,
        refLink: `${getBaseUrl(req)}/auth?ref=${partner.refCode}&role=supplier`,
        status: partner.status,
        createdAt: partner.createdAt,
      },
      userProfile: {
        firstName: userRecord?.firstName || '',
        lastName: userRecord?.lastName || '',
        company: userRecord?.company || null,
        name: userRecord?.name || '',
        email: userRecord?.email || req.user.email || '',
      },
      config,
      pointsPerGbp: config.pointsPerGbp,
      credits: {
        ...credits,
        pendingPoints: pending.totalPending,
        pendingPackage: pending.pendingPackage,
        pendingReview: pending.pendingReview,
        pendingSubscription: pending.pendingSubscription,
      },
    });
  } catch (error) {
    logger.error('Error fetching partner profile:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/referrals', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const [referrals, usersById, reviewQualifications, balance] = await Promise.all([
      partnerService.listReferralsByPartnerId(partner.id),
      getMaskedUsersById(),
      partnerService.getReviewQualifications(partner.id),
      partnerService.getBalance(partner.id),
    ]);
    const transactionsBySupplier = new Map();
    for (const txn of balance.transactions) {
      if (!txn.supplierUserId || txn.amount <= 0) {
        continue;
      }
      const entries = transactionsBySupplier.get(txn.supplierUserId) || [];
      entries.push(txn);
      transactionsBySupplier.set(txn.supplierUserId, entries);
    }

    const items = referrals
      .map(referral => {
        const withinWindow = partnerService.isWithinAttributionWindow(referral.supplierCreatedAt);
        const reviewQualifiedAt = reviewQualifications.get(referral.supplierUserId) || null;
        const supplierTxns = transactionsBySupplier.get(referral.supplierUserId) || [];
        const pointsEarned = supplierTxns.reduce((sum, txn) => sum + txn.amount, 0);
        const potentialPoints =
          (withinWindow && !referral.packageQualified ? partnerService.PACKAGE_BONUS : 0) +
          (!reviewQualifiedAt ? partnerService.FIRST_REVIEW_BONUS : 0) +
          (withinWindow && !referral.subscriptionQualified ? partnerService.SUBSCRIPTION_BONUS : 0);
        const expiresAt =
          referral.attributionExpiresAt ||
          new Date(
            new Date(referral.supplierCreatedAt).getTime() +
              partnerService.ATTRIBUTION_DAYS * 86400000
          ).toISOString();
        const daysRemaining = withinWindow
          ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
          : 0;
        const completed =
          Boolean(referral.packageQualified) &&
          Boolean(reviewQualifiedAt) &&
          Boolean(referral.subscriptionQualified);

        return {
          id: referral.id,
          supplierName: maskedUserName(usersById.get(referral.supplierUserId)),
          signedUpAt: referral.supplierCreatedAt,
          attributionExpiresAt: expiresAt,
          daysRemaining,
          withinWindow,
          packageQualified: Boolean(referral.packageQualified),
          packageQualifiedAt: referral.packageQualifiedAt || null,
          reviewQualified: Boolean(reviewQualifiedAt),
          reviewQualifiedAt,
          subscriptionQualified: Boolean(referral.subscriptionQualified),
          subscriptionQualifiedAt: referral.subscriptionQualifiedAt || null,
          pointsEarned,
          potentialPoints,
          state: completed ? 'completed' : withinWindow ? 'active' : 'expired',
          source: referral.source || null,
          medium: referral.medium || null,
          campaign: referral.campaign || null,
        };
      })
      .sort((a, b) => new Date(b.signedUpAt) - new Date(a.signedUpAt));

    return res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Error fetching partner referrals:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const [balance, usersById] = await Promise.all([
      partnerService.getBalance(partner.id),
      getMaskedUsersById(),
    ]);
    const maturityMs = partnerService.CREDIT_MATURITY_DAYS * 86400000;
    const items = balance.transactions.map(txn => {
      const positiveReward =
        txn.amount > 0 &&
        ![
          partnerService.CREDIT_TYPES.ADJUSTMENT,
          partnerService.CREDIT_TYPES.CASHOUT_RELEASE,
        ].includes(txn.type);
      const maturesAt = positiveReward
        ? new Date(new Date(txn.createdAt).getTime() + maturityMs).toISOString()
        : null;
      let availability = 'available';
      if (positiveReward && new Date(maturesAt).getTime() > Date.now()) {
        availability = 'maturing';
      }
      if (txn.type === partnerService.CREDIT_TYPES.CASHOUT_HOLD) {
        availability = 'held';
      }
      if (txn.type === partnerService.CREDIT_TYPES.CASHOUT_RELEASE) {
        availability = 'released';
      }
      if (txn.type === partnerService.CREDIT_TYPES.REDEEM) {
        availability = 'redeemed';
      }
      return {
        ...txn,
        supplierName: txn.supplierUserId ? maskedUserName(usersById.get(txn.supplierUserId)) : null,
        maturesAt,
        availability,
      };
    });
    return res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Error fetching partner transactions:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const [balance, referrals, reviewQualifications] = await Promise.all([
      partnerService.getBalance(partner.id),
      partnerService.listReferralsByPartnerId(partner.id),
      partnerService.getReviewQualifications(partner.id),
    ]);
    const config = getProgrammeConfig();
    const minimumPoints = config.minimumCashoutGbp * config.pointsPerGbp;
    const availablePoints = balance.availableBalance || 0;
    const pointsToNextCashout = Math.max(0, minimumPoints - availablePoints);
    const active = referrals.filter(referral =>
      partnerService.isWithinAttributionWindow(referral.supplierCreatedAt)
    ).length;
    const completed = referrals.filter(
      referral =>
        referral.packageQualified &&
        referral.subscriptionQualified &&
        reviewQualifications.has(referral.supplierUserId)
    ).length;
    const qualified = referrals.filter(
      referral =>
        referral.packageQualified ||
        referral.subscriptionQualified ||
        reviewQualifications.has(referral.supplierUserId)
    ).length;

    return res.json({
      breakdown: {
        signup: balance.signupBonusTotal || 0,
        package: balance.packageBonusTotal || 0,
        review: balance.reviewBonusTotal || 0,
        subscription: balance.subscriptionBonusTotal || 0,
        adjustment: balance.adjustmentTotal || 0,
      },
      cashoutProgress: {
        availablePoints,
        minCashoutPoints: minimumPoints,
        pointsToNextCashout,
        percentToNextCashout: minimumPoints
          ? Math.min(100, Math.round((availablePoints / minimumPoints) * 100))
          : 100,
      },
      referralActivity: {
        total: referrals.length,
        active,
        qualified,
        completed,
        paidConversions: referrals.filter(referral => referral.subscriptionQualified).length,
      },
      config,
      pointsPerGbp: config.pointsPerGbp,
    });
  } catch (error) {
    logger.error('Error fetching partner stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Code management ──────────────────────────────────────────────────────────

router.post(
  '/regenerate-code',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await getPartnerForUser(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return disabledResponse(res);
      }
      const { oldCode, newCode } = await partnerService.regenerateCode(partner.id);
      return res.json({
        ok: true,
        oldCode,
        newCode,
        refLink: `${getBaseUrl(req)}/auth?ref=${newCode}&role=supplier`,
      });
    } catch (error) {
      logger.error('Error regenerating partner code:', error);
      return res.status(500).json({ error: 'Failed to regenerate partner code' });
    }
  }
);

router.get('/code-history', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }
    return res.json({ items: await partnerService.getCodeHistory(partner.id) });
  } catch (error) {
    logger.error('Error fetching code history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Restricted partner support ───────────────────────────────────────────────
// Support remains available to disabled partners, but no financial/referral data is exposed.

router.post(
  '/support-ticket',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await getPartnerForUser(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      const user = await dbUnified.findOne('users', { id: req.user.id });
      const subject = String(req.body?.subject || '')
        .trim()
        .slice(0, 150);
      const message = String(req.body?.message || '')
        .trim()
        .slice(0, 2000);
      if (!subject) {
        return res.status(400).json({ error: 'Subject is required' });
      }
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const now = new Date().toISOString();
      const disabled = partner.status === 'disabled';
      const ticket = {
        id: uid('tkt'),
        senderId: req.user.id,
        senderType: 'partner',
        senderName: user?.name || req.user.name || 'Partner',
        senderEmail: user?.email || req.user.email,
        subject,
        message,
        status: 'open',
        priority: disabled ? 'high' : 'normal',
        accountTier: 'partner',
        category: disabled ? 'partner_account_access' : 'partner_support',
        partnerId: partner.id,
        partnerRefCode: partner.refCode,
        assignedTo: null,
        lastReplyAt: now,
        lastReplyBy: 'partner',
        responses: [],
        createdAt: now,
        updatedAt: now,
      };
      if (!(await dbUnified.insertOne('tickets', ticket))) {
        return res.status(500).json({ error: 'Failed to submit ticket. Please try again.' });
      }
      notifyAdmins({
        type: 'support',
        title: disabled ? 'Partner account access appeal' : 'New partner support ticket',
        message: `${ticket.senderName}: ${ticket.subject}`,
        actionUrl: `/admin-tickets?ticket=${ticket.id}`,
        actionText: 'View ticket',
        priority: disabled ? 'high' : 'normal',
        metadata: { ticketId: ticket.id, partnerId: partner.id },
      }).catch(() => {});
      return res.status(201).json({
        ok: true,
        ticketId: ticket.id,
        message: 'Your support ticket has been submitted. Our team will be in touch.',
      });
    } catch (error) {
      logger.error('Error creating partner support ticket:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.get('/support-tickets', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    const tickets = await dbUnified.find('tickets', {
      senderId: req.user.id,
      senderType: 'partner',
    });
    const items = tickets
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(ticketPublicShape);
    return res.json({ items, total: items.length, disabled: partner.status === 'disabled' });
  } catch (error) {
    logger.error('Error listing partner support tickets:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/support-tickets/:id', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    const ticket = await dbUnified.findOne('tickets', {
      id: req.params.id,
      senderId: req.user.id,
      senderType: 'partner',
    });
    if (!ticket) {
      return res.status(404).json({ error: 'Support ticket not found' });
    }
    return res.json({ ticket: ticketPublicShape(ticket) });
  } catch (error) {
    logger.error('Error fetching partner support ticket:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/support-tickets/:id/reply',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await getPartnerForUser(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      const ticket = await dbUnified.findOne('tickets', {
        id: req.params.id,
        senderId: req.user.id,
        senderType: 'partner',
      });
      if (!ticket) {
        return res.status(404).json({ error: 'Support ticket not found' });
      }
      if (ticket.status === 'closed') {
        return res.status(409).json({ error: 'This ticket is closed' });
      }
      const message = String(req.body?.message || '')
        .trim()
        .slice(0, 5000);
      if (!message) {
        return res.status(400).json({ error: 'Reply message is required' });
      }

      const now = new Date().toISOString();
      const responses = Array.isArray(ticket.responses) ? [...ticket.responses] : [];
      responses.push({
        id: uid('trp'),
        message,
        content: message,
        authorId: req.user.id,
        authorRole: 'partner',
        isStaff: false,
        createdAt: now,
      });
      const updated = await dbUnified.updateOne(
        'tickets',
        { id: ticket.id },
        {
          $set: {
            responses,
            status: ticket.status === 'resolved' ? 'open' : ticket.status,
            lastReplyAt: now,
            lastReplyBy: 'partner',
            updatedAt: now,
          },
        }
      );
      if (!updated) {
        return res.status(500).json({ error: 'Failed to send reply' });
      }
      return res.status(201).json({ ok: true, message: 'Reply sent' });
    } catch (error) {
      logger.error('Error replying to partner support ticket:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Cashout requests ─────────────────────────────────────────────────────────

router.post(
  '/cashout-requests',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const partner = await getPartnerForUser(req.user.id).catch(() => null);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const config = getProgrammeConfig();
    const method = String(req.body?.method || '').trim();
    const denominationGbp = Number(req.body?.denominationGbp);
    const partnerMessage =
      String(req.body?.partnerMessage || '')
        .trim()
        .slice(0, 1000) || null;
    const idempotencyKey = cleanIdempotencyKey(
      req.get('Idempotency-Key') || req.body?.idempotencyKey
    );

    if (!CASHOUT_METHODS.includes(method)) {
      return res
        .status(400)
        .json({ error: `method must be one of: ${CASHOUT_METHODS.join(', ')}` });
    }
    if (
      !Number.isInteger(denominationGbp) ||
      !config.cashoutDenominations.includes(denominationGbp)
    ) {
      return res.status(400).json({
        error: `denominationGbp must be one of the allowed denominations: ${config.cashoutDenominations.join(', ')}`,
      });
    }
    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'A valid Idempotency-Key is required for cashout requests',
      });
    }

    try {
      return await withPartnerCashoutLock(partner.id, async () => {
        const existing = await dbUnified.findOne('partner_cashout_requests', {
          partnerId: partner.id,
          idempotencyKey,
        });
        if (existing) {
          return res.status(200).json({
            ok: true,
            idempotentReplay: true,
            cashoutRequestId: existing.id,
            request: existing,
          });
        }

        const requiredPoints = denominationGbp * config.pointsPerGbp;
        const balance = await partnerService.getBalance(partner.id);
        if (balance.availableBalance < requiredPoints) {
          return res.status(400).json({
            error: `Insufficient available balance. You need ${requiredPoints} points (£${denominationGbp}) but only have ${balance.availableBalance} available points.`,
            requiredPoints,
            availablePoints: balance.availableBalance,
          });
        }

        const now = new Date().toISOString();
        const cashoutId = uid('pcr');
        const holdTxn = await partnerService.createCashoutHold({
          partnerId: partner.id,
          amount: requiredPoints,
          cashoutId,
        });
        if (!holdTxn?.id) {
          throw new Error('Cashout hold was not persisted');
        }

        const requestRecord = {
          id: cashoutId,
          idempotencyKey,
          partnerId: partner.id,
          partnerUserId: req.user.id,
          method,
          denominationGbp,
          pointsHeld: requiredPoints,
          pointsPerGbpSnapshot: config.pointsPerGbp,
          status: 'submitted',
          partnerMessage,
          adminResponseMessage: null,
          adminInternalNotes: null,
          adminUserIdApproved: null,
          approvedAt: null,
          rejectedAt: null,
          processingAt: null,
          deliveredAt: null,
          deliveryDetails: null,
          holdTxnId: holdTxn.id,
          finalRedeemTxnId: null,
          createdAt: now,
          updatedAt: now,
        };

        try {
          if (!(await dbUnified.insertOne('partner_cashout_requests', requestRecord))) {
            throw new Error('Cashout request insert did not persist');
          }
        } catch (insertError) {
          try {
            const release = await partnerService.releaseCashoutHold(holdTxn.id, partner.id);
            if (!release?.id) {
              throw new Error('Cashout hold rollback did not persist');
            }
          } catch (rollbackError) {
            logger.error('[PARTNER-CASHOUT] CRITICAL rollback failure', {
              partnerId: partner.id,
              cashoutId,
              holdTxnId: holdTxn.id,
              insertError: insertError.message,
              rollbackError: rollbackError.message,
            });
            return res.status(500).json({
              error:
                'Your request could not be completed and requires manual reconciliation. Please contact support with the reference below.',
              reconciliationRequired: true,
              reference: cashoutId,
            });
          }
          return res.status(500).json({
            error: 'Failed to submit cashout request. Your points have been restored.',
          });
        }

        const refreshedBalance = await partnerService.getBalance(partner.id);
        return res.status(201).json({
          ok: true,
          cashoutRequestId: requestRecord.id,
          request: requestRecord,
          credits: refreshedBalance,
          config,
          message: `Your cashout request for £${denominationGbp} has been submitted. Requests are typically processed within 3–5 working days.`,
        });
      });
    } catch (error) {
      logger.error('Error creating cashout request:', error);
      return res.status(500).json({ error: 'Failed to submit cashout request. Please try again.' });
    }
  }
);

router.get('/cashout-requests', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const records = await dbUnified.find('partner_cashout_requests', { partnerId: partner.id });
    const items = records
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(record => ({
        id: record.id,
        method: record.method,
        denominationGbp: record.denominationGbp,
        pointsHeld: record.pointsHeld,
        status: record.status,
        partnerMessage: record.partnerMessage,
        adminResponseMessage: record.adminResponseMessage,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        approvedAt: record.approvedAt,
        rejectedAt: record.rejectedAt,
        processingAt: record.processingAt,
        deliveredAt: record.deliveredAt,
      }));
    return res.json({ items, total: records.length, displayed: items.length });
  } catch (error) {
    logger.error('Error listing cashout requests:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/cashout-requests/:id', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }
    const requestRecord = await dbUnified.findOne('partner_cashout_requests', {
      id: req.params.id,
      partnerId: partner.id,
    });
    if (!requestRecord) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }
    return res.json({ request: requestRecord });
  } catch (error) {
    logger.error('Error fetching cashout request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────

router.patch('/me', authRequired, roleRequired('partner'), csrfProtection, async (req, res) => {
  try {
    const partner = await getPartnerForUser(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return disabledResponse(res);
    }

    const { firstName, lastName, company } = req.body || {};
    const updates = {};
    if (firstName !== undefined) {
      const value = String(firstName).trim().slice(0, 40);
      if (!value) {
        return res.status(400).json({ error: 'First name cannot be empty' });
      }
      updates.firstName = value;
    }
    if (lastName !== undefined) {
      const value = String(lastName).trim().slice(0, 40);
      if (!value) {
        return res.status(400).json({ error: 'Last name cannot be empty' });
      }
      updates.lastName = value;
    }
    if (company !== undefined) {
      updates.company = company ? String(company).trim().slice(0, 100) : null;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const current = await dbUnified.findOne('users', { id: req.user.id });
    if (updates.firstName || updates.lastName) {
      updates.name = `${updates.firstName || current?.firstName || ''} ${
        updates.lastName || current?.lastName || ''
      }`.trim();
    }
    updates.updatedAt = new Date().toISOString();
    if (!(await dbUnified.updateOne('users', { id: req.user.id }, updates))) {
      return res.status(500).json({ error: 'Failed to update profile' });
    }
    return res.json({ ok: true, message: 'Profile updated successfully', userProfile: updates });
  } catch (error) {
    logger.error('Error updating partner profile:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/change-password',
  authLimiter,
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await getPartnerForUser(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return disabledResponse(res);
      }
      const { currentPassword, newPassword } = req.body || {};
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current password and new password are required' });
      }
      if (!passwordOk(newPassword)) {
        return res.status(400).json({
          error: 'New password must be at least 8 characters and include letters and numbers',
        });
      }
      const user = await dbUnified.findOne('users', { id: req.user.id });
      if (!user?.passwordHash) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      if (
        !(await dbUnified.updateOne(
          'users',
          { id: req.user.id },
          { passwordHash, updatedAt: new Date().toISOString() }
        ))
      ) {
        return res.status(500).json({ error: 'Failed to update password' });
      }
      return res.json({ ok: true, message: 'Password changed successfully' });
    } catch (error) {
      logger.error('Error changing partner password:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
