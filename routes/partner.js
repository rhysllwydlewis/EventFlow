/**
 * Partner Portal Routes
 * Handles partner registration, dashboard data, and referral management
 *
 * Base path (mounted in routes/index.js): /api/partner
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
const { getTremendousService } = require('../services/tremendousService');

const router = express.Router();

// ─── Partner Signup ───────────────────────────────────────────────────────────

/**
 * POST /api/partner/register
 * Register a new partner account (creates user with role=partner + partner record)
 */
router.post('/register', authLimiter, csrfProtection, async (req, res) => {
  const { firstName, lastName, email, password, location, company } = req.body || {};

  // Validate inputs
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

  const users = await dbUnified.read('users');
  if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const userFirstName = String(firstName).trim().slice(0, 40);
  const userLastName = String(lastName).trim().slice(0, 40);

  const user = {
    id: uid('usr'),
    name: `${userFirstName} ${userLastName}`,
    firstName: userFirstName,
    lastName: userLastName,
    email: String(email).toLowerCase(),
    role: 'partner',
    passwordHash: await bcrypt.hash(password, 10),
    location: String(location).trim().slice(0, 100),
    company: company ? String(company).trim().slice(0, 100) : undefined,
    verified: true, // Partners are auto-activated
    createdAt: new Date().toISOString(),
    notify_account: true,
  };

  await dbUnified.insertOne('users', user);

  // Create partner record with unique ref code
  const partner = await partnerService.createPartner(user.id);

  // Send welcome email (best-effort)
  try {
    const baseUrl = process.env.BASE_URL || 'https://eventflow.app';
    const refLink = `${baseUrl}/auth?ref=${partner.refCode}&role=supplier`;
    await postmark.sendMail({
      to: user.email,
      subject: 'Welcome to the EventFlow Partner Programme',
      template: 'partner-welcome',
      templateData: {
        name: user.firstName || user.name || 'Partner',
        refCode: partner.refCode,
        refLink,
        dashboardLink: `${baseUrl}/partner/dashboard`,
      },
      from: postmark.FROM_DEFAULT || postmark.FROM_BILLING || 'hello@eventflow.app',
      tags: ['partner-welcome', 'transactional'],
      messageStream: 'outbound',
    });
  } catch (emailErr) {
    logger.warn('Partner welcome email failed (non-blocking):', emailErr.message);
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });
  setAuthCookie(res, token, { remember: true });

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.status(201).json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    partner: { refCode: partner.refCode },
  });
});

// ─── Partner Dashboard ────────────────────────────────────────────────────────

/**
 * GET /api/partner/me
 * Get current partner's profile, ref code, and credit balance
 */
router.get('/me', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }

    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const balance = await partnerService.getBalance(partner.id);
    const pending = await partnerService.getPendingPoints(partner.id);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const refLink = `${baseUrl}/auth?ref=${partner.refCode}&role=supplier`;

    res.json({
      partner: {
        id: partner.id,
        refCode: partner.refCode,
        refLink,
        status: partner.status,
        createdAt: partner.createdAt,
      },
      credits: {
        ...balance,
        pendingPoints: pending.totalPending,
        pendingPackage: pending.pendingPackage,
        pendingSubscription: pending.pendingSubscription,
      },
    });
  } catch (err) {
    logger.error('Error fetching partner me:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/partner/referrals
 * Get list of referred suppliers with their qualification status
 */
router.get('/referrals', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }

    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const referrals = await partnerService.listReferralsByPartnerId(partner.id);

    // Enrich with basic user info (name masked for privacy — first + last letter only)
    const users = await dbUnified.read('users');
    const enriched = referrals.map(r => {
      const u = users.find(x => x.id === r.supplierUserId);
      return {
        id: r.id,
        // maskReferralName applies first+last-letter masking; see partnerService for full logic
        supplierName: partnerService.maskReferralName(
          u ? u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() : null,
          u ? u.company : null,
          u ? u.email : null
        ),
        signedUpAt: r.supplierCreatedAt,
        attributionExpiresAt: r.attributionExpiresAt,
        packageQualified: r.packageQualified,
        subscriptionQualified: r.subscriptionQualified,
        withinWindow: partnerService.isWithinAttributionWindow(r.supplierCreatedAt),
      };
    });

    enriched.sort((a, b) => new Date(b.signedUpAt) - new Date(a.signedUpAt));

    res.json({ items: enriched });
  } catch (err) {
    logger.error('Error fetching partner referrals:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/partner/transactions
 * Get credit transaction history for the current partner
 */
router.get('/transactions', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }

    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const balance = await partnerService.getBalance(partner.id);
    res.json({ items: balance.transactions });
  } catch (err) {
    logger.error('Error fetching partner transactions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Code Management ──────────────────────────────────────────────────────────

/**
 * POST /api/partner/regenerate-code
 * Generate a new referral code; the old code is archived and remains functional.
 */
router.post(
  '/regenerate-code',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await partnerService.getPartnerByUserId(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return res.status(403).json({
          error: 'Your partner account has been disabled. Please contact support.',
          disabled: true,
        });
      }

      const { oldCode, newCode } = await partnerService.regenerateCode(partner.id);
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const newRefLink = `${baseUrl}/auth?ref=${newCode}&role=supplier`;

      res.json({ ok: true, oldCode, newCode, refLink: newRefLink });
    } catch (err) {
      logger.error('Error regenerating partner code:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/partner/code-history
 * Retrieve the archived referral codes for the current partner.
 */
router.get('/code-history', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const history = await partnerService.getCodeHistory(partner.id);
    res.json({ items: history });
  } catch (err) {
    logger.error('Error fetching partner code history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Tremendous Gift Card Routes (partner-only) ───────────────────────────────

/**
 * GET /api/partner/tremendous/products
 * List available gift card products from Tremendous.
 * Requires: role === 'partner'
 */
router.get('/tremendous/products', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const tremendous = getTremendousService();
    const products = await tremendous.listProducts({ giftCardsOnly: true });
    res.json({ products });
  } catch (err) {
    logger.error('Tremendous listProducts error:', err);
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to fetch gift card products',
      notConfigured: err.statusCode === 503,
    });
  }
});

/**
 * POST /api/partner/tremendous/orders
 * Create a gift card order/reward for a recipient.
 * Requires: role === 'partner'
 *
 * Body:
 *   productId      {string}  — Tremendous product ID
 *   value          {number}  — Reward denomination in GBP (e.g. 5.00)
 *   currency       {string}  — ISO 4217 code (default: 'GBP')
 *   recipientName  {string}
 *   recipientEmail {string}
 *   message        {string}  — Optional message to recipient
 *
 * Financial safety:
 *   - Converts value to required points using POINTS_PER_GBP conversion rate
 *   - Checks partner has sufficient available (mature) points
 *   - Pre-debits points before calling Tremendous; reverses on failure
 *   - Persists order to partner_cashout_orders for audit
 *   - Sends audit copy to TREMENDOUS_AUDIT_EMAIL if configured
 */
router.post(
  '/tremendous/orders',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const { productId, value, currency, recipientName, recipientEmail, message } = req.body || {};

    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ error: 'productId is required' });
    }
    if (!value || typeof value !== 'number' || value <= 0) {
      return res.status(400).json({ error: 'value must be a positive number' });
    }
    if (!recipientName || typeof recipientName !== 'string' || !recipientName.trim()) {
      return res.status(400).json({ error: 'recipientName is required' });
    }
    if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
      return res.status(400).json({ error: 'recipientEmail must be a valid email address' });
    }

    try {
      const partner = await partnerService.getPartnerByUserId(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return res.status(403).json({
          error: 'Your partner account has been disabled. Please contact support.',
          disabled: true,
        });
      }

      // ── Balance enforcement ──────────────────────────────────────────────────
      const { POINTS_PER_GBP } = partnerService;
      const requestedGbp = Number(value);
      // Math.ceil ensures any fractional GBP value is always fully covered by points.
      // e.g. £10.50 @ 100 pts/£ = 1050 pts (exact); £10.01 = 1001 pts (rounds up to nearest point).
      const requiredPoints = Math.ceil(requestedGbp * POINTS_PER_GBP);

      const balance = await partnerService.getBalance(partner.id);
      if (balance.availableBalance < requiredPoints) {
        return res.status(400).json({
          error: `Insufficient available points. You need ${requiredPoints} points (£${requestedGbp.toFixed(2)}) but only have ${balance.availableBalance} available.`,
          requiredPoints,
          availablePoints: balance.availableBalance,
        });
      }

      // ── Pre-debit points (idempotency) ───────────────────────────────────────
      const externalRef = `partner:${partner.id}:${uid('ord')}`;
      const debitTxn = await partnerService.debitPoints({
        partnerId: partner.id,
        amount: requiredPoints,
        notes: `Gift card cashout: £${requestedGbp.toFixed(2)} to ${String(recipientEmail).trim()}`,
        externalRef,
      });

      // ── Call Tremendous ──────────────────────────────────────────────────────
      let order;
      try {
        const tremendous = getTremendousService();
        order = await tremendous.createOrder({
          productId: String(productId).trim(),
          value: requestedGbp,
          currency: currency ? String(currency).trim().toUpperCase().slice(0, 3) : 'GBP',
          recipient: {
            name: String(recipientName).trim().slice(0, 100),
            email: String(recipientEmail).trim().slice(0, 200),
          },
          externalId: externalRef,
          ...(message ? { message: String(message).trim().slice(0, 500) } : {}),
        });
      } catch (tremendousErr) {
        // Reverse the debit so partner doesn't lose points on API failure
        await partnerService.reverseDebit(debitTxn.id, partner.id);
        throw tremendousErr;
      }

      // ── Persist order record for audit ───────────────────────────────────────
      const cashoutRecord = {
        id: uid('pco'),
        partnerId: partner.id,
        partnerUserId: req.user.id,
        externalRef,
        debitTxnId: debitTxn.id,
        pointsDebited: requiredPoints,
        valueGbp: requestedGbp,
        currency: currency ? String(currency).trim().toUpperCase().slice(0, 3) : 'GBP',
        productId: String(productId).trim(),
        recipientName: String(recipientName).trim().slice(0, 100),
        recipientEmail: String(recipientEmail).trim().slice(0, 200),
        tremendousOrderId: order.id || null,
        tremendousRewardId: (order.rewards && order.rewards[0] && order.rewards[0].id) || null,
        tremendousStatus: order.status || null,
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.insertOne('partner_cashout_orders', cashoutRecord);
      logger.info(
        `Tremendous order created by partner ${partner.id}: ${order.id || '(no id)'} (ref: ${externalRef})`
      );

      // ── Audit email copy ─────────────────────────────────────────────────────
      const auditEmail = process.env.TREMENDOUS_AUDIT_EMAIL;
      if (auditEmail) {
        postmark
          .sendMail({
            to: auditEmail,
            subject: `[EventFlow Audit] Gift card sent – Partner ${partner.id}`,
            text: [
              `Partner: ${partner.id} (${req.user.email})`,
              `Order ID: ${order.id || '(no id)'}`,
              `Reward ID: ${cashoutRecord.tremendousRewardId || 'n/a'}`,
              `External Ref: ${externalRef}`,
              `Amount: £${requestedGbp.toFixed(2)} (${requiredPoints} pts debited)`,
              `Recipient: ${cashoutRecord.recipientName} <${cashoutRecord.recipientEmail}>`,
              `Product: ${cashoutRecord.productId}`,
              `Created At: ${cashoutRecord.createdAt}`,
            ].join('\n'),
            from: postmark.FROM_DEFAULT || 'hello@eventflow.app',
            tags: ['partner-cashout-audit'],
            messageStream: 'outbound',
          })
          .catch(emailErr => {
            logger.warn('Cashout audit email failed (non-blocking):', emailErr.message);
          });
      }

      res.status(201).json({ ok: true, order, cashoutId: cashoutRecord.id });
    } catch (err) {
      logger.error('Tremendous createOrder error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to create gift card order',
      });
    }
  }
);

/**
 * GET /api/partner/tremendous/orders/:id
 * Fetch the status of a Tremendous order.
 * Requires: role === 'partner'
 */
router.get('/tremendous/orders/:id', authRequired, roleRequired('partner'), async (req, res) => {
  const orderId = req.params.id;
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }
  try {
    const tremendous = getTremendousService();
    const order = await tremendous.getOrder(orderId);
    res.json({ order });
  } catch (err) {
    logger.error('Tremendous getOrder error:', err);
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to fetch order',
    });
  }
});

/**
 * POST /api/partner/tremendous/orders/:id/resend
 * Resend the gift card email for the first reward of an order.
 * Requires: role === 'partner'
 */
router.post(
  '/tremendous/orders/:id/resend',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const orderId = req.params.id;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }
    try {
      // Fetch the order to retrieve the reward ID
      const tremendous = getTremendousService();
      const order = await tremendous.getOrder(orderId);

      const rewards = order.rewards || [];
      if (!rewards.length) {
        return res.status(404).json({ error: 'No rewards found for this order' });
      }

      const rewardId = rewards[0].id;
      await tremendous.resendReward(rewardId);
      res.json({ ok: true, message: 'Gift card resent successfully' });
    } catch (err) {
      logger.error('Tremendous resendReward error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to resend gift card',
      });
    }
  }
);

/**
 * GET /api/partner/tremendous/orders
 * List the current partner's cashout orders (from internal DB, newest first).
 * Optionally returns Tremendous order status if query param `?status=1` is set.
 * Requires: role === 'partner'
 */
router.get('/tremendous/orders', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const all = (await dbUnified.read('partner_cashout_orders')) || [];
    const mine = all
      .filter(o => o.partnerId === partner.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    res.json({ items: mine, total: mine.length });
  } catch (err) {
    logger.error('Error listing partner cashout orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Reward-level endpoints ────────────────────────────────────────────────────

/**
 * GET /api/partner/tremendous/rewards/:id
 * Get the details of a single Tremendous reward by reward ID.
 * Requires: role === 'partner'
 */
router.get('/tremendous/rewards/:id', authRequired, roleRequired('partner'), async (req, res) => {
  const rewardId = req.params.id;
  if (!rewardId) {
    return res.status(400).json({ error: 'Reward ID is required' });
  }
  try {
    const tremendous = getTremendousService();
    const reward = await tremendous.getReward(rewardId);
    res.json({ reward });
  } catch (err) {
    logger.error('Tremendous getReward error:', err);
    res.status(err.statusCode || 502).json({
      error: err.message || 'Failed to fetch reward',
    });
  }
});

/**
 * POST /api/partner/tremendous/rewards/:id/resend
 * Resend a reward email by reward ID directly.
 * Requires: role === 'partner'
 */
router.post(
  '/tremendous/rewards/:id/resend',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const rewardId = req.params.id;
    if (!rewardId) {
      return res.status(400).json({ error: 'Reward ID is required' });
    }
    try {
      const tremendous = getTremendousService();
      await tremendous.resendReward(rewardId);
      res.json({ ok: true, message: 'Gift card resent successfully' });
    } catch (err) {
      logger.error('Tremendous resendReward (by rewardId) error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to resend gift card',
      });
    }
  }
);

/**
 * POST /api/partner/tremendous/rewards/:id/cancel
 * Cancel a reward that has not yet been redeemed.
 * Requires: role === 'partner'
 */
router.post(
  '/tremendous/rewards/:id/cancel',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const rewardId = req.params.id;
    if (!rewardId) {
      return res.status(400).json({ error: 'Reward ID is required' });
    }
    try {
      const tremendous = getTremendousService();
      const reward = await tremendous.cancelReward(rewardId);

      // Update cashout order record status if we have one linked to this reward
      try {
        const allOrders = (await dbUnified.read('partner_cashout_orders')) || [];
        const linked = allOrders.find(o => o.tremendousRewardId === rewardId);
        if (linked) {
          await dbUnified.updateOne(
            'partner_cashout_orders',
            { id: linked.id },
            { $set: { status: 'cancelled', updatedAt: new Date().toISOString() } }
          );
        }
      } catch (_dbErr) {
        logger.warn(
          'Failed to update cashout order status after cancel (non-blocking):',
          _dbErr.message
        );
      }

      logger.info(`Reward ${rewardId} cancelled by partner ${req.user.id}`);
      res.json({ ok: true, reward });
    } catch (err) {
      logger.error('Tremendous cancelReward error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to cancel reward',
      });
    }
  }
);

/**
 * POST /api/partner/tremendous/rewards/:id/generate-link
 * Generate a new redemption URL for a reward (delivery method must be LINK).
 * Requires: role === 'partner'
 */
router.post(
  '/tremendous/rewards/:id/generate-link',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    const rewardId = req.params.id;
    if (!rewardId) {
      return res.status(400).json({ error: 'Reward ID is required' });
    }
    try {
      const tremendous = getTremendousService();
      const result = await tremendous.generateRewardLink(rewardId);
      res.json({ ok: true, link: result.link, reward: result.reward });
    } catch (err) {
      logger.error('Tremendous generateRewardLink error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to generate reward link',
      });
    }
  }
);

/**
 * GET /api/partner/tremendous/funding-sources
 * List available Tremendous funding sources.
 * Requires: role === 'partner'
 */
router.get(
  '/tremendous/funding-sources',
  authRequired,
  roleRequired('partner'),
  async (req, res) => {
    try {
      const tremendous = getTremendousService();
      const fundingSources = await tremendous.listFundingSources();
      res.json({ funding_sources: fundingSources });
    } catch (err) {
      logger.error('Tremendous listFundingSources error:', err);
      res.status(err.statusCode || 502).json({
        error: err.message || 'Failed to fetch funding sources',
      });
    }
  }
);

// ─── General Partner Support Ticket ──────────────────────────────────────────

/**
 * POST /api/partner/support-ticket
 * Raise a general-purpose support ticket from the partner dashboard.
 *
 * Body: { subject: string, message: string }
 */
router.post(
  '/support-ticket',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await partnerService.getPartnerByUserId(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return res.status(403).json({
          error: 'Your partner account has been disabled. Please contact support.',
          disabled: true,
        });
      }

      const { subject, message } = req.body || {};

      const sanitizedSubject = subject ? String(subject).trim().slice(0, 150) : '';
      if (!sanitizedSubject) {
        return res.status(400).json({ error: 'Subject is required' });
      }

      const sanitizedMessage = message ? String(message).trim().slice(0, 2000) : '';
      if (!sanitizedMessage) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const now = new Date().toISOString();

      const newTicket = {
        id: uid('tkt'),
        senderId: req.user.id,
        senderType: 'partner',
        senderName: req.user.name || req.user.firstName || 'Partner',
        senderEmail: req.user.email,
        subject: sanitizedSubject,
        message: sanitizedMessage,
        status: 'open',
        priority: 'normal',
        accountTier: 'partner',
        category: 'partner_support',
        partnerId: partner.id,
        partnerRefCode: partner.refCode,
        assignedTo: null,
        lastReplyAt: now,
        lastReplyBy: 'partner',
        responses: [],
        createdAt: now,
        updatedAt: now,
      };

      await dbUnified.insertOne('tickets', newTicket);
      logger.info(`Partner support ticket created: ${newTicket.id} for partner ${partner.id}`);

      res.status(201).json({
        ok: true,
        ticketId: newTicket.id,
        message: 'Your support ticket has been submitted. Our team will be in touch.',
      });
    } catch (err) {
      logger.error('Error creating partner support ticket:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Partner Support Tickets List ─────────────────────────────────────────────

/**
 * GET /api/partner/support-tickets
 * List all support tickets raised by the current partner.
 * Returns tickets sorted newest first.
 */
router.get('/support-tickets', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const allTickets = (await dbUnified.read('tickets')) || [];
    const partnerTickets = allTickets
      .filter(t => t.senderId === req.user.id && t.senderType === 'partner')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(t => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        lastReplyAt: t.lastReplyAt,
        lastReplyBy: t.lastReplyBy,
        responseCount: Array.isArray(t.responses) ? t.responses.length : 0,
      }));

    res.json({ items: partnerTickets, total: partnerTickets.length });
  } catch (err) {
    logger.error('Error fetching partner support tickets:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Partner Cashout Requests ─────────────────────────────────────────────────

/**
 * Allowed cashout denominations (GBP integers, £5 increments, minimum £50).
 * Configurable via CASHOUT_DENOMINATIONS env var (comma-separated integers).
 */
const rawDenoms = process.env.CASHOUT_DENOMINATIONS;
const CASHOUT_DENOMINATIONS = (() => {
  if (rawDenoms) {
    const parsed = rawDenoms
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) return parsed;
  }
  // Default: £50 – £500 in £5 increments
  const defaults = [];
  for (let v = 50; v <= 500; v += 5) defaults.push(v);
  return defaults;
})();

const CASHOUT_METHODS = ['amazon_voucher', 'prepaid_debit_card'];

/**
 * POST /api/partner/cashout-requests
 * Submit a cashout request.
 *
 * Body: { method: 'amazon_voucher'|'prepaid_debit_card', denominationGbp: number, partnerMessage?: string }
 *
 * - Validates method and denomination.
 * - Enforces availableBalance >= required points.
 * - Creates a CASHOUT_HOLD ledger transaction (deducts points immediately).
 * - Persists request to partner_cashout_requests collection.
 */
router.post(
  '/cashout-requests',
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
      const partner = await partnerService.getPartnerByUserId(req.user.id);
      if (!partner) {
        return res.status(404).json({ error: 'Partner account not found' });
      }
      if (partner.status === 'disabled') {
        return res.status(403).json({
          error: 'Your partner account has been disabled. Please contact support.',
          disabled: true,
        });
      }

      const { method, denominationGbp, partnerMessage } = req.body || {};

      // Validate method
      if (!method || !CASHOUT_METHODS.includes(method)) {
        return res.status(400).json({
          error: `method must be one of: ${CASHOUT_METHODS.join(', ')}`,
        });
      }

      // Validate denomination
      const denomInt = parseInt(denominationGbp, 10);
      if (!Number.isInteger(denomInt) || denomInt <= 0) {
        return res.status(400).json({ error: 'denominationGbp must be a positive integer' });
      }
      if (!CASHOUT_DENOMINATIONS.includes(denomInt)) {
        return res.status(400).json({
          error: `denominationGbp must be one of the allowed denominations: ${CASHOUT_DENOMINATIONS.join(', ')}`,
        });
      }

      // Compute required points
      const requiredPoints = denomInt * partnerService.POINTS_PER_GBP;

      // Check availableBalance
      const balance = await partnerService.getBalance(partner.id);
      if (balance.availableBalance < requiredPoints) {
        return res.status(400).json({
          error: `Insufficient available balance. You need ${requiredPoints} points (£${denomInt}) but only have ${balance.availableBalance} available points.`,
          requiredPoints,
          availablePoints: balance.availableBalance,
        });
      }

      const now = new Date().toISOString();
      const cashoutId = uid('pcr');

      // Create hold transaction first (idempotency guard)
      const holdTxn = await partnerService.createCashoutHold({
        partnerId: partner.id,
        amount: requiredPoints,
        cashoutId,
      });

      // Persist cashout request record
      const cashoutRequest = {
        id: cashoutId,
        partnerId: partner.id,
        partnerUserId: req.user.id,
        method,
        denominationGbp: denomInt,
        pointsHeld: requiredPoints,
        pointsPerGbpSnapshot: partnerService.POINTS_PER_GBP,
        status: 'submitted',
        partnerMessage: partnerMessage ? String(partnerMessage).trim().slice(0, 1000) : null,
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

      await dbUnified.insertOne('partner_cashout_requests', cashoutRequest);
      logger.info(
        `Cashout request created: ${cashoutId} by partner ${partner.id} — £${denomInt} via ${method}`
      );

      res.status(201).json({
        ok: true,
        cashoutRequestId: cashoutRequest.id,
        request: cashoutRequest,
        message: `Your cashout request for £${denomInt} has been submitted. Requests are typically processed within 3–5 working days.`,
      });
    } catch (err) {
      logger.error('Error creating cashout request:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/partner/cashout-requests
 * List the current partner's own cashout requests, newest first.
 */
router.get('/cashout-requests', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const all = (await dbUnified.read('partner_cashout_requests')) || [];
    const mine = all
      .filter(r => r.partnerId === partner.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        method: r.method,
        denominationGbp: r.denominationGbp,
        pointsHeld: r.pointsHeld,
        status: r.status,
        partnerMessage: r.partnerMessage,
        adminResponseMessage: r.adminResponseMessage,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        approvedAt: r.approvedAt,
        rejectedAt: r.rejectedAt,
        processingAt: r.processingAt,
        deliveredAt: r.deliveredAt,
      }));

    res.json({ items: mine, total: mine.length });
  } catch (err) {
    logger.error('Error listing cashout requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/partner/cashout-requests/:id
 * Get details of a single cashout request (must belong to the current partner).
 */
router.get('/cashout-requests/:id', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner account not found' });
    }
    if (partner.status === 'disabled') {
      return res.status(403).json({
        error: 'Your partner account has been disabled. Please contact support.',
        disabled: true,
      });
    }

    const all = (await dbUnified.read('partner_cashout_requests')) || [];
    const request = all.find(r => r.id === req.params.id && r.partnerId === partner.id);
    if (!request) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    res.json({ request });
  } catch (err) {
    logger.error('Error fetching cashout request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
