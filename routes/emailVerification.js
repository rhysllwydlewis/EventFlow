/**
 * Email Verification Routes
 * Enhanced email verification with resend functionality
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const crypto = require('crypto');

const dbUnified = require('../db-unified');
const { authRequired } = require('../middleware/auth');
// csrfProtection is available but not used in GET endpoints
const { resendEmailLimiter } = require('../middleware/rateLimits');
const postmark = require('../utils/postmark');

const router = express.Router();

/**
 * POST /api/auth/send-verification
 * Send or resend email verification link
 */
router.post('/send-verification', resendEmailLimiter, authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user
    const user = await dbUnified.findOne('users', { id: userId });

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: 'User not found',
      });
    }

    // Check if already verified
    if (user.emailVerified || user.verified) {
      return res.json({
        ok: true,
        message: 'Email is already verified',
        alreadyVerified: true,
      });
    }

    // Generate verification token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresIn = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    const expires = new Date(Date.now() + expiresIn);

    // Save token
    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $set: {
          emailVerificationToken: token,
          emailVerificationExpires: expires.toISOString(),
        },
      }
    );

    // Send verification email
    const baseUrl = process.env.BASE_URL || 'https://event-flow.co.uk';
    const verificationLink = `${baseUrl}/verify?token=${token}`;

    try {
      await postmark.sendMail({
        to: user.email,
        subject: 'Verify your email address',
        template: 'verification',
        templateData: {
          name: user.name || 'there',
          verificationLink,
        },
        from: postmark.FROM_NOREPLY,
        tags: ['verification', 'transactional'],
        messageStream: 'outbound',
      });

      res.json({
        ok: true,
        message: 'Verification email sent successfully',
        expiresIn: 86400, // 24 hours in seconds
      });
    } catch (emailError) {
      logger.error('Failed to send verification email:', emailError);
      res.status(500).json({
        ok: false,
        error: 'Failed to send verification email',
        message: 'Please try again later',
      });
    }
  } catch (error) {
    logger.error('Send verification error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to send verification email',
      message: error.message,
    });
  }
});

/**
 * GET /api/auth/verify-email/:token
 * Verify email with token (alternative to existing verify endpoints)
 */
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: 'Token is required',
      });
    }

    // Find user with token
    const user = await dbUnified.findOne('users', {
      emailVerificationToken: token,
    });

    if (!user) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid or expired token',
        message: 'This verification link is not valid',
      });
    }

    // Check expiration
    if (user.emailVerificationExpires && new Date() > new Date(user.emailVerificationExpires)) {
      return res.status(400).json({
        ok: false,
        error: 'Token expired',
        message: 'This verification link has expired. Please request a new one.',
      });
    }

    // Mark as verified
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          emailVerified: true,
          verified: true,
        },
        $unset: {
          emailVerificationToken: '',
          emailVerificationExpires: '',
        },
      }
    );

    res.json({
      ok: true,
      message: 'Email verified successfully',
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to verify email',
      message: error.message,
    });
  }
});

/**
 * GET /api/auth/email-status
 * Get email verification status for current user
 */
router.get('/email-status', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await dbUnified.findOne('users', { id: userId });

    res.json({
      ok: true,
      verified: !!user?.emailVerified || !!user?.verified,
      email: user?.email,
    });
  } catch (error) {
    logger.error('Email status error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get email status',
      message: error.message,
    });
  }
});

module.exports = router;
