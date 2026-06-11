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
const { notifyAdmins } = require('../services/notifyAdmins.service');

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

  const emailLower = String(email).toLowerCase();
  if (await dbUnified.findOne('users', { email: emailLower })) {
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

  const partnerUserInserted = await dbUnified.insertOne('users', user);
  if (!partnerUserInserted) {
    logger.error('[PARTNER-REGISTER] insertOne failed — user not saved', { email: user.email });
    return res.status(500).json({ error: 'Failed to create partner account. Please try again.' });
  }

  // Create partner record with unique ref code
  const partner = await partnerService.createPartner(user.id);

  // Send welcome email (best-effort)
  try {
    const baseUrl = process.env.BASE_URL || process.env.APP_BASE_URL || 'https://event-flow.co.uk';
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
      from: postmark.FROM_HELLO,
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
  // Notify all admins of new partner (fire-and-forget, non-blocking)
  notifyAdmins({
    type: 'system',
    title: 'New Partner Registration',
    message: `${user.name || user.email} joined the Partner Programme (code: ${partner.refCode})`,
    actionUrl: `/admin-user-detail?id=${user.id}`,
    actionText: 'View Partner',
    priority: 'normal',
    metadata: { partnerId: partner.id, userId: user.id, refCode: partner.refCode },
  }).catch(() => {});

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

    const [balance, pending, userRecord] = await Promise.all([
      partnerService.getBalance(partner.id),
      partnerService.getPendingPoints(partner.id),
      dbUnified.findOne('users', { id: req.user.id }),
    ]);
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
      // User profile fields — used to pre-fill the Account Settings form
      userProfile: {
        firstName: userRecord?.firstName || '',
        lastName: userRecord?.lastName || '',
        company: userRecord?.company || null,
        name: userRecord?.name || '',
      },
      pointsPerGbp: partnerService.POINTS_PER_GBP,
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

      const partnerTicketInserted = await dbUnified.insertOne('tickets', newTicket);
      if (!partnerTicketInserted) {
        logger.error('[PARTNER] ticket insertOne failed', { ticketId: newTicket.id });
        return res.status(500).json({ error: 'Failed to submit ticket. Please try again.' });
      }
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

    const rawPartnerTickets = await dbUnified.find('tickets', {
      senderId: req.user.id,
      senderType: 'partner',
    });
    const partnerTickets = rawPartnerTickets
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
 * Allowed cashout denominations (GBP integers, £5 increments, minimum £15).
 * Configurable via CASHOUT_DENOMINATIONS env var (comma-separated integers).
 */
const rawDenoms = process.env.CASHOUT_DENOMINATIONS;
const CASHOUT_DENOMINATIONS = (() => {
  if (rawDenoms) {
    const parsed = rawDenoms
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  // Default: £15 – £500 in £5 increments
  const defaults = [];
  for (let v = 15; v <= 500; v += 5) {
    defaults.push(v);
  }
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

      const cashoutInserted = await dbUnified.insertOne('partner_cashout_requests', cashoutRequest);
      if (!cashoutInserted) {
        logger.error('[PARTNER] cashout insertOne failed', { requestId: cashoutRequest.id });
        return res
          .status(500)
          .json({ error: 'Failed to submit cashout request. Please try again.' });
      }
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
    const allMine = await dbUnified.find('partner_cashout_requests', { partnerId: partner.id });
    const mine = allMine
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

    const request = await dbUnified.findOne('partner_cashout_requests', {
      id: req.params.id,
      partnerId: partner.id,
    });
    if (!request) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    res.json({ request });
  } catch (err) {
    logger.error('Error fetching cashout request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ─── Partner Profile Update ───────────────────────────────────────────────────

/**
 * PATCH /api/partner/me
 * Update the current partner's display name and/or company.
 * Body: { firstName?, lastName?, company? }
 */
router.patch('/me', authRequired, roleRequired('partner'), csrfProtection, async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) return res.status(404).json({ error: 'Partner account not found' });
    if (partner.status === 'disabled')
      return res.status(403).json({ error: 'Your partner account has been disabled.' });

    const { firstName, lastName, company } = req.body || {};

    const updates = {};
    if (firstName !== undefined) {
      const f = String(firstName).trim().slice(0, 40);
      if (!f) return res.status(400).json({ error: 'First name cannot be empty' });
      updates.firstName = f;
    }
    if (lastName !== undefined) {
      const l = String(lastName).trim().slice(0, 40);
      if (!l) return res.status(400).json({ error: 'Last name cannot be empty' });
      updates.lastName = l;
    }
    if (updates.firstName || updates.lastName) {
      const user = await dbUnified.findOne('users', { id: req.user.id });
      const fn = updates.firstName || (user && user.firstName) || '';
      const ln = updates.lastName || (user && user.lastName) || '';
      updates.name = `${fn} ${ln}`.trim();
    }
    if (company !== undefined) {
      updates.company = company ? String(company).trim().slice(0, 100) : null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.updatedAt = new Date().toISOString();
    const ok = await dbUnified.updateOne('users', { id: req.user.id }, updates);
    if (!ok) return res.status(500).json({ error: 'Failed to update profile' });

    logger.info(`Partner profile updated for user ${req.user.id}`);
    res.json({ ok: true, message: 'Profile updated successfully' });
  } catch (err) {
    logger.error('Error updating partner profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Partner Password Change ──────────────────────────────────────────────────

/**
 * POST /api/partner/change-password
 * Change the current partner's password.
 * Body: { currentPassword: string, newPassword: string }
 */
router.post(
  '/change-password',
  authLimiter,
  authRequired,
  roleRequired('partner'),
  csrfProtection,
  async (req, res) => {
    try {
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
      if (!user || !user.passwordHash) {
        return res.status(404).json({ error: 'User not found' });
      }

      const match = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!match) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      const ok = await dbUnified.updateOne(
        'users',
        { id: req.user.id },
        { passwordHash: newHash, updatedAt: new Date().toISOString() }
      );
      if (!ok) return res.status(500).json({ error: 'Failed to update password' });

      logger.info(`Partner password changed for user ${req.user.id}`);
      res.json({ ok: true, message: 'Password changed successfully' });
    } catch (err) {
      logger.error('Error changing partner password:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Partner Stats (Earnings Breakdown) ──────────────────────────────────────

/**
 * GET /api/partner/stats
 * Returns an earnings breakdown by bonus type for the charts/widgets on the dashboard.
 */
router.get('/stats', authRequired, roleRequired('partner'), async (req, res) => {
  try {
    const partner = await partnerService.getPartnerByUserId(req.user.id);
    if (!partner) return res.status(404).json({ error: 'Partner account not found' });
    if (partner.status === 'disabled')
      return res.status(403).json({
        error: 'Your partner account has been disabled.',
        disabled: true,
      });

    const balance = await partnerService.getBalance(partner.id);
    const referrals = await partnerService.listReferralsByPartnerId(partner.id);
    const activeReferrals = referrals.filter(r =>
      partnerService.isWithinAttributionWindow(r.supplierCreatedAt)
    ).length;

    const minCashoutPoints = 15 * partnerService.POINTS_PER_GBP; // £15 minimum cashout
    const availPts = balance.availableBalance || 0;
    const pointsToNextCashout = availPts >= minCashoutPoints ? 0 : minCashoutPoints - availPts;

    res.json({
      breakdown: {
        signup: balance.signupBonusTotal || 0,
        package: balance.packageBonusTotal || 0,
        review: balance.reviewBonusTotal || 0,
        subscription: balance.subscriptionBonusTotal || 0,
        adjustment: balance.adjustmentTotal || 0,
      },
      cashoutProgress: {
        availablePoints: availPts,
        minCashoutPoints,
        pointsToNextCashout,
        percentToNextCashout: Math.min(100, Math.round((availPts / minCashoutPoints) * 100)),
      },
      referralActivity: {
        total: referrals.length,
        active: activeReferrals,
        qualified: referrals.filter(r => r.packageQualified || r.subscriptionQualified).length,
      },
      pointsPerGbp: partnerService.POINTS_PER_GBP,
    });
  } catch (err) {
    logger.error('Error fetching partner stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
