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

module.exports = router;
