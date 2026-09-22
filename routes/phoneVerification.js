/**
 * Phone Verification Routes
 * Handles phone number verification via SMS
 */

'use strict';

const express = require('express');
const { randomInt } = require('crypto');
const logger = require('../utils/logger');

const dbUnified = require('../db-unified');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, strictAuthLimiter } = require('../middleware/rateLimits');

const router = express.Router();

// Initialize Twilio client if credentials are available
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/**
 * POST /api/me/phone/send-code
 * Send verification code to phone number
 */
router.post('/send-code', csrfProtection, writeLimiter, authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        ok: false,
        error: 'Phone number is required',
      });
    }

    // Validate phone number format (basic validation)
    if (!/^\+?[1-9]\d{1,14}$/.test(phoneNumber.replace(/\s/g, ''))) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid phone number format',
        message: 'Phone number must be in international format (e.g., +44 7123 456789)',
      });
    }

    // Generate cryptographically secure 6-digit code
    const code = randomInt(100000, 1000000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save code to database
    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $set: {
          phoneVerificationCode: code,
          phoneVerificationExpires: expires.toISOString(),
          phoneNumberToVerify: phoneNumber,
        },
      }
    );

    // Send SMS if Twilio is configured
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
      try {
        await twilioClient.messages.create({
          body: `Your EventFlow verification code is: ${code}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phoneNumber,
        });

        res.json({
          ok: true,
          message: 'Verification code sent successfully',
          expiresIn: 600, // 10 minutes in seconds
        });
      } catch (twilioError) {
        logger.error('Twilio SMS error:', twilioError);

        // In development, return the code for testing
        if (process.env.NODE_ENV !== 'production') {
          return res.json({
            ok: true,
            message: 'Development mode: SMS not sent',
            code, // Only in development!
            expiresIn: 600,
          });
        }

        return res.status(500).json({
          ok: false,
          error: 'Failed to send SMS',
          message: 'Unable to send verification code. Please try again later.',
        });
      }
    } else {
      // Twilio not configured - development mode
      if (process.env.NODE_ENV !== 'production') {
        return res.json({
          ok: true,
          message: 'Development mode: Twilio not configured',
          code, // Only in development!
          expiresIn: 600,
        });
      }

      return res.status(500).json({
        ok: false,
        error: 'Phone verification not configured',
        message: 'SMS service is not available. Please contact support.',
      });
    }
  } catch (error) {
    logger.error('Phone verification send error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to send verification code',
      message: error.message,
    });
  }
});

/**
 * POST /api/me/phone/verify-code
 * Verify phone number with code
 */
router.post('/verify-code', csrfProtection, strictAuthLimiter, authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: 'Verification code is required',
      });
    }

    // Get user
    const user = await dbUnified.findOne('users', { id: userId });

    if (!user || !user.phoneVerificationCode || !user.phoneNumberToVerify) {
      return res.status(400).json({
        ok: false,
        error: 'No verification code found',
        message: 'Please request a new verification code',
      });
    }

    // Check expiration
    if (new Date() > new Date(user.phoneVerificationExpires)) {
      return res.status(400).json({
        ok: false,
        error: 'Verification code expired',
        message: 'Please request a new verification code',
      });
    }

    // Verify code
    if (user.phoneVerificationCode !== code.toString()) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid verification code',
        message: 'The code you entered is incorrect',
      });
    }

    // Mark phone as verified
    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $set: {
          phoneNumber: user.phoneNumberToVerify,
          phoneVerified: true,
        },
        $unset: {
          phoneVerificationCode: '',
          phoneVerificationExpires: '',
          phoneNumberToVerify: '',
        },
      }
    );

    res.json({
      ok: true,
      message: 'Phone number verified successfully',
      phoneNumber: user.phoneNumberToVerify,
    });
  } catch (error) {
    logger.error('Phone verification verify error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to verify phone number',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/me/phone
 * Remove verified phone number
 */
router.delete('/', csrfProtection, authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    await dbUnified.updateOne(
      'users',
      { id: userId },
      {
        $unset: {
          phoneNumber: '',
          phoneVerified: '',
        },
      }
    );

    res.json({
      ok: true,
      message: 'Phone number removed successfully',
    });
  } catch (error) {
    logger.error('Phone removal error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to remove phone number',
      message: error.message,
    });
  }
});

/**
 * GET /api/me/phone/status
 * Get phone verification status
 */
router.get('/status', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await dbUnified.findOne('users', { id: userId });

    res.json({
      ok: true,
      phoneNumber: user?.phoneNumber || null,
      verified: !!user?.phoneVerified,
    });
  } catch (error) {
    logger.error('Phone status error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get phone status',
      message: error.message,
    });
  }
});

module.exports = router;
