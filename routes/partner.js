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
    return res.status(400).json({ error: 'Password must be at least 8 characters and include letters and numbers' });
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
router.post('/regenerate-code', authRequired, roleRequired('partner'), csrfProtection, async (req, res) => {
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
});

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

// ─── Payout Request ───────────────────────────────────────────────────────────

const GIFT_CARD_TYPES = ['Amazon', 'John Lewis', 'ASOS', 'Marks & Spencer', 'Other'];

/**
 * POST /api/partner/payout-request
 * Create a support ticket requesting a gift-card payout.
 *
 * Body:
 *   { points: number, giftCardType?: string, message?: string }
 */
router.post('/payout-request', authRequired, roleRequired('partner'), csrfProtection, async (req, res) => {
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

    const { points, giftCardType, message } = req.body || {};

    const parsedPoints = parseInt(points, 10);
    if (!Number.isFinite(parsedPoints) || parsedPoints <= 0) {
      return res.status(400).json({ error: 'points must be a positive integer' });
    }

    const balance = await partnerService.getBalance(partner.id);
    if (parsedPoints > balance.balance) {
      return res.status(400).json({
        error: `Insufficient points. You have ${balance.balance} available.`,
      });
    }

    const sanitizedGiftCardType =
      giftCardType && GIFT_CARD_TYPES.includes(String(giftCardType).trim())
        ? String(giftCardType).trim()
        : 'Not specified';

    const sanitizedMessage = message
      ? String(message).trim().slice(0, 1000)
      : '';

    const now = new Date().toISOString();
    const valueGbp = `£${(parsedPoints / 100).toFixed(2)}`;
    const subject = `Partner payout request — ${parsedPoints} credits (${valueGbp}) [${partner.id}]`;

    const ticketMessage =
      `Partner payout request\n\n` +
      `Partner ID: ${partner.id}\n` +
      `Partner Code: ${partner.refCode}\n` +
      `Points requested: ${parsedPoints} (${valueGbp})\n` +
      `Current balance: ${balance.balance} credits\n` +
      `Preferred gift card: ${sanitizedGiftCardType}\n` +
      (sanitizedMessage ? `\nPartner message:\n${sanitizedMessage}` : '');

    const newTicket = {
      id: uid('tkt'),
      senderId: req.user.id,
      senderType: 'partner',
      senderName: req.user.name || req.user.firstName || 'Partner',
      senderEmail: req.user.email,
      subject,
      message: ticketMessage,
      status: 'open',
      priority: 'normal',
      accountTier: 'partner',
      prioritySource: 'partner_payout',
      assignedTo: null,
      lastReplyAt: now,
      lastReplyBy: 'partner',
      responses: [],
      // Payout-specific metadata
      partnerId: partner.id,
      partnerRefCode: partner.refCode,
      payoutPoints: parsedPoints,
      payoutValueGbp: valueGbp,
      payoutGiftCardType: sanitizedGiftCardType,
      category: 'partner_payout',
      createdAt: now,
      updatedAt: now,
    };

    await dbUnified.insertOne('tickets', newTicket);
    logger.info(`Partner payout request ticket created: ${newTicket.id} for partner ${partner.id}`);

    res.status(201).json({
      ok: true,
      ticketId: newTicket.id,
      message: 'Your payout request has been submitted. Our team will be in touch.',
    });
  } catch (err) {
    logger.error('Error creating partner payout request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
