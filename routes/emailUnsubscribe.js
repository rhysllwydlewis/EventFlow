/**
 * Email Unsubscribe Routes
 * Handles one-click unsubscribe links included in automated action-prompt emails.
 *
 * GET /email/action-prompts/unsubscribe?token=...
 *   - Validates HMAC token (no authentication required)
 *   - Sets emailPrefs.actionPrompts.enabled = false for the user
 *   - Redirects to /unsubscribed-action-prompts
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Verify an action-prompt unsubscribe token.
 * Token format: base64url(JSON payload) + '.' + HMAC-SHA256 signature
 *
 * @param {string} token
 * @returns {{ valid: boolean, userId?: string, email?: string }}
 */
function verifyToken(token) {
  try {
    const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'fallback-secret';
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false };
    }

    const [payloadB64, receivedSig] = parts;

    // Verify HMAC
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

    // Constant-time comparison
    if (
      receivedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expectedSig))
    ) {
      return { valid: false };
    }

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    if (!payload.userId || !payload.email || payload.purpose !== 'actionPrompts') {
      return { valid: false };
    }

    return { valid: true, userId: payload.userId, email: payload.email };
  } catch {
    return { valid: false };
  }
}

/**
 * GET /email/action-prompts/unsubscribe
 * One-click unsubscribe — no authentication required.
 */
router.get('/action-prompts/unsubscribe', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    logger.warn('[Unsubscribe] Missing token');
    return res.redirect('/unsubscribed-action-prompts?error=invalid');
  }

  const result = verifyToken(token);

  if (!result.valid) {
    logger.warn('[Unsubscribe] Invalid token');
    return res.redirect('/unsubscribed-action-prompts?error=invalid');
  }

  try {
    // Set emailPrefs.actionPrompts.enabled = false
    const updated = await dbUnified.updateOne(
      'users',
      { id: result.userId },
      { $set: { 'emailPrefs.actionPrompts.enabled': false } }
    );

    if (!updated) {
      logger.warn(`[Unsubscribe] User not found: ${result.userId}`);
      return res.redirect('/unsubscribed-action-prompts?error=notfound');
    }

    logger.info(`[Unsubscribe] User ${result.userId} unsubscribed from action-prompt emails`);
    return res.redirect('/unsubscribed-action-prompts?success=1');
  } catch (err) {
    logger.error('[Unsubscribe] Error processing unsubscribe:', err.message);
    return res.redirect('/unsubscribed-action-prompts?error=server');
  }
});

module.exports = router;
module.exports.verifyToken = verifyToken;
