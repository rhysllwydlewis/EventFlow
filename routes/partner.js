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

    const balance = await partnerService.getBalance(partner.id);
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
      credits: balance,
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

    const referrals = await partnerService.listReferralsByPartnerId(partner.id);

    // Enrich with basic user info (name masked for privacy)
    const users = await dbUnified.read('users');
    const enriched = referrals.map(r => {
      const u = users.find(x => x.id === r.supplierUserId);
      return {
        id: r.id,
        supplierName: u ? `${(u.firstName || u.name || 'Supplier').charAt(0)}*** (${u.company || u.email?.split('@')[1] || 'supplier'})` : 'Unknown',
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

    const balance = await partnerService.getBalance(partner.id);
    res.json({ items: balance.transactions });
  } catch (err) {
    logger.error('Error fetching partner transactions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
