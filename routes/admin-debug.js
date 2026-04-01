/**
 * Admin Debug Routes
 * Emergency authentication debugging and fixing endpoints
 * All endpoints require admin authentication
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { auditLog } = require('../middleware/audit');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');

const router = express.Router();

/**
 * GET /api/v1/admin/debug/user?email=user@example.com
 * Debug endpoint to inspect user record without exposing password
 * Admin only - for diagnosing auth issues
 */
router.get('/user', authRequired, roleRequired('admin'), async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter required' });
  }

  const users = await dbUnified.read('users');
  const user = users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Return user data with diagnostics, but NOT the password hash
  res.json({
    debug_info: {
      id: user.id,
      email: user.email,
      name: user.name,
      verified: user.verified,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      hasPasswordHash: !!user.passwordHash,
      passwordHashLength: user.passwordHash ? user.passwordHash.length : 0,
      passwordHashValid: user.passwordHash && user.passwordHash.startsWith('$2'),
      hasResetToken: !!user.resetToken,
      hasVerificationToken: !!user.verificationToken,
      isPro: user.isPro,
      subscriptionId: user.subscriptionId,
    },
    diagnostics: {
      readyToLogin: user.verified && !!user.passwordHash && user.passwordHash.startsWith('$2'),
      issues: [
        !user.verified ? '⚠️ Email not verified' : null,
        !user.passwordHash ? '❌ No password hash found' : null,
        user.passwordHash && !user.passwordHash.startsWith('$2')
          ? '❌ Invalid bcrypt hash format'
          : null,
        user.verified === false ? '❌ Account marked as unverified' : null,
      ].filter(Boolean),
    },
  });
});

/**
 * POST /api/v1/admin/debug/fix-password
 * Emergency endpoint to fix user password
 * Admin only - for recovering accounts with bad password hashes
 */
router.post(
  '/fix-password',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  express.json(),
  async (req, res) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'email and newPassword required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const users = await dbUnified.read('users');
    const foundUser = users.find(
      u => (u.email || '').toLowerCase() === String(email).toLowerCase()
    );

    if (!foundUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update user
      await dbUnified.updateOne(
        'users',
        { id: foundUser.id },
        { $set: { passwordHash: hashedPassword } }
      );

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'fix_password',
        targetType: 'user',
        targetId: foundUser.id,
        details: { email: email },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      logger.info(`[ADMIN DEBUG] Password fixed for user: ${email} by admin: ${req.user.email}`);

      res.json({
        ok: true,
        message: `Password updated for ${email}. User can now log in.`,
        email: email,
        user: {
          id: foundUser.id,
          email: foundUser.email,
          name: foundUser.name,
        },
      });
    } catch (error) {
      logger.error('Error fixing password:', error);
      res.status(500).json({ error: 'Failed to update password' });
    }
  }
);

/**
 * POST /api/v1/admin/debug/verify-user
 * Emergency endpoint to verify user email
 * Admin only - for account recovery
 */
router.post(
  '/verify-user',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  express.json(),
  async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    const users = await dbUnified.read('users');
    const user = users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { verified: true },
        $unset: { verificationToken: '', verificationTokenExpiresAt: '' },
      }
    );

    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'verify_user',
      targetType: 'user',
      targetId: user.id,
      details: { email: email },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    logger.info(`[ADMIN DEBUG] User verified: ${email} by admin: ${req.user.email}`);

    res.json({
      ok: true,
      message: `User ${email} is now verified`,
      user: {
        id: user.id,
        email: user.email,
        verified: true,
      },
    });
  }
);

/**
 * POST /api/v1/admin/debug/test-email
 * Test email sending and verify Postmark is working
 * Admin only
 */
router.post(
  '/test-email',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  express.json(),
  async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    try {
      logger.info(`🧪 Testing email send to: ${email}`);

      // Find user
      const users = await dbUnified.read('users');
      const user = users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Generate test token
      const testToken = tokenUtils.generateEmailVerificationToken(user.email);

      // Send test email
      await postmark.sendVerificationEmail(user, testToken);

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'test_email',
        targetType: 'user',
        targetId: user.id,
        details: { email: email },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        ok: true,
        message: `Test email sent to ${email}`,
      });
    } catch (error) {
      logger.error('Email test failed:', error);
      res.status(500).json({
        error: 'Email send failed',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /api/v1/admin/debug/login-test
 * Test login without actually logging in
 * Returns diagnostics about why login might fail
 * Admin only - to prevent credential enumeration
 */
router.post(
  '/login-test',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  express.json(),
  async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }

    logger.info(`[LOGIN TEST] Testing login for: ${email}`);

    const allUsers = await dbUnified.read('users');
    const user = allUsers.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

    const diagnostics = {
      email: email,
      found: !!user,
      verified: user?.verified,
      hasPasswordHash: !!user?.passwordHash,
      hashValid: user?.passwordHash?.startsWith('$2'),
      passwordMatches: false,
      canLogin: false,
      issues: [],
    };

    if (!user) {
      diagnostics.issues.push('❌ User not found');
      return res.status(200).json(diagnostics);
    }

    if (!user.verified) {
      diagnostics.issues.push('❌ Email not verified');
    }

    if (!user.passwordHash) {
      diagnostics.issues.push('❌ No password hash stored');
    } else if (!user.passwordHash.startsWith('$2')) {
      diagnostics.issues.push('❌ Invalid bcrypt hash format');
    } else {
      // Test password
      try {
        const matches = await bcrypt.compare(password, user.passwordHash);
        diagnostics.passwordMatches = matches;

        if (!matches) {
          diagnostics.issues.push('❌ Password does not match');
        }
      } catch (error) {
        diagnostics.issues.push(`❌ Password comparison error: ${error.message}`);
      }
    }

    diagnostics.canLogin =
      user.verified &&
      !!user.passwordHash &&
      user.passwordHash.startsWith('$2') &&
      diagnostics.passwordMatches;

    res.json(diagnostics);
  }
);

/**
 * POST /api/v1/admin/debug/audit-users
 * Audit all users and identify issues
 * Admin only
 */
router.post(
  '/audit-users',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const users = await dbUnified.read('users');

    const audit = {
      totalUsers: users.length,
      issues: {
        noPasswordHash: [],
        invalidBcryptHash: [],
        notVerified: [],
        noEmail: [],
      },
      summary: {},
    };

    users.forEach(user => {
      if (!user.email) {
        audit.issues.noEmail.push(user.id);
      }
      if (!user.passwordHash) {
        audit.issues.noPasswordHash.push({ id: user.id, email: user.email });
      } else if (!user.passwordHash.startsWith('$2')) {
        audit.issues.invalidBcryptHash.push({ id: user.id, email: user.email });
      }
      if (user.verified !== true) {
        audit.issues.notVerified.push({ id: user.id, email: user.email });
      }
    });

    audit.summary = {
      usersWithoutPassword: audit.issues.noPasswordHash.length,
      usersWithInvalidHash: audit.issues.invalidBcryptHash.length,
      unverifiedUsers: audit.issues.notVerified.length,
      usersWithoutEmail: audit.issues.noEmail.length,
    };

    // Audit log
    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'audit_users',
      targetType: 'users',
      targetId: 'all',
      details: { summary: audit.summary },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    logger.info(`[ADMIN DEBUG] User audit completed by admin: ${req.user.email}`);

    res.json(audit);
  }
);

/**
 * POST /api/v1/admin/debug/test-webhooks
 * Tests all configured webhook integrations and reports their status.
 *
 * Checks:
 *   - Stripe webhook:   STRIPE_WEBHOOK_SECRET configured?
 *   - Postmark webhook: POSTMARK_WEBHOOK_USER + POSTMARK_WEBHOOK_PASS configured?
 *   - MongoDB webhook:  MONGODB_WEBHOOK_SECRET configured?
 *
 * For each configured webhook the endpoint also sends a synthetic test request
 * to the local webhook handler and records the HTTP response.
 *
 * Admin only.
 */
router.post(
  '/test-webhooks',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    // Build base URL from environment variables only — never from request headers
    // to avoid SSRF via a forged Host header.
    const port = process.env.PORT || 3000;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    logger.info(`[ADMIN DEBUG] Webhook test triggered by admin: ${req.user.email}`);

    /**
     * Send a synthetic POST to a local webhook endpoint and return a result object.
     *
     * @param {string} name       Human-readable label.
     * @param {string} path       URL path relative to baseUrl.
     * @param {Object} body       JSON payload to send.
     * @param {Object} headers    Additional headers (e.g. signature header).
     * @returns {Promise<{name, configured, status, ok, error}>}
     */
    async function probeWebhook(name, path, body, headers = {}) {
      const url = `${baseUrl}${path}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const httpRes = await fetch(url, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        clearTimeout(timer);
        return { name, configured: true, status: httpRes.status, ok: httpRes.ok };
      } catch (err) {
        return { name, configured: true, status: null, ok: false, error: err.message };
      }
    }

    const results = [];

    // ── Stripe ──────────────────────────────────────────────────────────
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecret) {
      results.push({
        name: 'stripe',
        configured: false,
        ok: false,
        details: 'STRIPE_WEBHOOK_SECRET is not set',
      });
    } else {
      // Build a minimal Stripe-like signed payload for the probe
      const crypto = require('crypto');
      const timestamp = Math.floor(Date.now() / 1000);
      const testBody = JSON.stringify({ type: 'ping', data: { object: {} } });
      const signedPayload = `${timestamp}.${testBody}`;
      const sig = crypto.createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
      const stripeSignatureHeader = `t=${timestamp},v1=${sig}`;
      const stripeResult = await probeWebhook(
        'stripe',
        '/api/v2/webhooks/stripe',
        JSON.parse(testBody),
        { 'stripe-signature': stripeSignatureHeader, 'content-type': 'application/json' }
      );
      // The Stripe endpoint rejects unknown event types with 400 after accepting the
      // signature — meaning the endpoint is live and signature verification passed.
      // Treat 200 and 400 as "reachable and authenticated"; anything else is a failure.
      const stripeReachable =
        stripeResult.status === 200 || stripeResult.status === 400;
      stripeResult.ok = stripeReachable;
      stripeResult.details = stripeResult.status != null
        ? `Endpoint reachable (HTTP ${stripeResult.status}${stripeResult.status === 400 ? ' — test event type rejected, signature accepted' : ''})`
        : stripeResult.error;
      results.push(stripeResult);
    }

    // ── Postmark ─────────────────────────────────────────────────────────
    const postmarkUser = process.env.POSTMARK_WEBHOOK_USER;
    const postmarkPass = process.env.POSTMARK_WEBHOOK_PASS;
    if (!postmarkUser || !postmarkPass) {
      results.push({
        name: 'postmark',
        configured: false,
        ok: null,
        details:
          'POSTMARK_WEBHOOK_USER / POSTMARK_WEBHOOK_PASS not set — authentication skipped in non-production',
      });
    } else {
      const creds = Buffer.from(`${postmarkUser}:${postmarkPass}`).toString('base64');
      const postmarkResult = await probeWebhook(
        'postmark',
        '/api/webhooks/postmark',
        { RecordType: 'Open', MessageID: 'test-debug-probe', Recipient: 'debug@test.invalid' },
        { Authorization: `Basic ${creds}` }
      );
      postmarkResult.details =
        postmarkResult.status != null
          ? `Endpoint responded with HTTP ${postmarkResult.status}`
          : postmarkResult.error;
      results.push(postmarkResult);
    }

    // ── MongoDB ───────────────────────────────────────────────────────────
    const mongoSecret = process.env.MONGODB_WEBHOOK_SECRET;
    if (!mongoSecret) {
      results.push({
        name: 'mongodb',
        configured: false,
        ok: null,
        details:
          'MONGODB_WEBHOOK_SECRET is not set — signature verification skipped in non-production',
      });
    } else {
      const crypto = require('crypto');
      const testBody = JSON.stringify({
        operationType: 'insert',
        ns: { db: 'eventflow', coll: '__debug_probe__' },
        documentKey: { _id: `debug-probe-${Date.now()}` },
        fullDocument: { _debug: true },
      });
      const sig = crypto.createHmac('sha256', mongoSecret).update(testBody).digest('hex');
      const mongoResult = await probeWebhook(
        'mongodb',
        '/api/webhooks/mongodb',
        JSON.parse(testBody),
        { 'x-mongodb-webhook-signature': `sha256=${sig}` }
      );
      mongoResult.details =
        mongoResult.status != null
          ? `Endpoint responded with HTTP ${mongoResult.status}`
          : mongoResult.error;
      results.push(mongoResult);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    const configured = results.filter(r => r.configured).length;
    const passed = results.filter(r => r.configured && r.ok === true).length;

    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'test_webhooks',
      targetType: 'webhooks',
      targetId: 'all',
      details: { configured, passed, webhooks: results.map(r => r.name) },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    logger.info(`[ADMIN DEBUG] Webhook test completed: ${passed}/${results.length} ok`);

    res.json({ ok: passed === results.length, results, summary: { total: results.length, configured, passed } });
  }
);

module.exports = router;
