/**
 * User Settings Routes
 * Handles user notification preferences and settings
 */

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { authRequired, setAuthCookie, JWT_SECRET } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { getFeatureFlags } = require('../middleware/features');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerRegistrationRisk = require('../services/partnerRegistrationRiskService');
const accountTypeConversion = require('../services/accountTypeConversion.service');

const router = express.Router();

// Resolves role from `targetRole` (this route's body shape), not `role` — the
// registration route's own guard instance only fires for `{ role: 'supplier' }`
// bodies and would never trigger for this endpoint otherwise.
const accountTypeConversionRiskGuard = partnerRegistrationRisk.registrationRiskGuard({
  roleResolver: req => (req.body?.targetRole === 'supplier' ? 'supplier' : null),
});

const ACCOUNT_TYPE_CONVERSION_STATUS_BY_CODE = {
  NOT_FOUND: 404,
  ADMIN_ROLE_PROTECTED: 403,
  ALREADY_TARGET_ROLE: 409,
  VALIDATION_ERROR: 400,
  COOLDOWN_ACTIVE: 429,
  SUPPLIER_PROFILE_PROVISIONING_FAILED: 500,
  SUPPLIER_SUSPEND_FAILED: 500,
  UPDATE_FAILED: 500,
};

/**
 * GET /api/me/settings
 * Get user notification settings including email preferences
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const users = await dbUnified.read('users');
    const i = users.findIndex(u => u.id === req.user.id);
    if (i < 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const user = users[i];
    // Default ON when field is absent (backward compatible)
    const actionPrompts = user.emailPrefs?.actionPrompts || {};

    // Newsletter status is read-only here — subscribing/unsubscribing goes
    // through routes/newsletter.js's own endpoints (double opt-in confirm
    // flow on subscribe), not this endpoint, so there's one source of truth
    // for that consent state.
    let newsletterStatus = 'not-subscribed';
    if (user.email) {
      const subscriber = await dbUnified.findOne('newsletterSubscribers', {
        email: String(user.email).toLowerCase().trim(),
      });
      if (subscriber) {
        newsletterStatus = subscriber.status || 'not-subscribed';
      }
    }

    res.json({
      // notify_account is the field every actual send-gate checks
      // (utils/postmark.js, services/queue/workers/email.worker.js) — read
      // it here too, not the deprecated `notify` field, so a value set via
      // this endpoint or via PUT /api/auth/preferences reads back the same
      // either way. Fall back to the legacy `notify` field only when
      // notify_account was never explicitly set: a user who unchecked this
      // toggle before notify_account existed already expressed their real
      // preference via `notify: false`, and this endpoint now also writes
      // notify_account going forward — without this fallback, re-reading
      // their settings would silently show the toggle as back on.
      notify:
        user.notify_account !== undefined ? user.notify_account !== false : user.notify !== false,
      emailPrefs: {
        actionPrompts: {
          enabled: actionPrompts.enabled !== false,
          missingPackages: actionPrompts.missingPackages !== false,
          incompleteProfile: actionPrompts.incompleteProfile !== false,
          missingPhotos: actionPrompts.missingPhotos !== false,
        },
      },
      newsletterStatus,
      communityDigestCadence: user.communityNotificationPreferences?.email || 'weekly',
      browseNudgeOptOut: user.browseNudgeOptOut === true,
      verificationReminderOptOut: user.verificationReminderOptOut === true,
      verified: user.verified === true || user.emailVerified === true,
    });
  } catch (error) {
    logger.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * POST /api/me/settings
 * Update user notification settings including email preferences
 */
router.post('/', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const body = req.body || {};
    const updateFields = {};

    // notify_account is the field every actual send-gate checks
    // (utils/postmark.js's sendNotificationEmail, services/queue/workers/
    // email.worker.js) — this endpoint previously only wrote the deprecated
    // `notify` field, so unchecking the toggle here silently had no effect
    // on whether the user actually kept receiving account-notification
    // email. Write both, mirroring PUT /api/auth/preferences. Gated on
    // `!== undefined` like every other field below — this previously wrote
    // unconditionally, so any caller posting a partial payload (e.g. just
    // `{ browseNudgeOptOut: true }`) silently disabled the user's account
    // notifications as a side effect of a request that never mentioned them.
    let notify;
    if (body.notify !== undefined) {
      notify = !!body.notify;
      updateFields.notify = notify;
      updateFields.notify_account = notify;
    }

    // Update emailPrefs.actionPrompts if provided
    if (body.emailPrefs && typeof body.emailPrefs.actionPrompts === 'object') {
      const ap = body.emailPrefs.actionPrompts;
      if (ap.enabled !== undefined && typeof ap.enabled !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.enabled must be a boolean' });
      }
      if (ap.missingPackages !== undefined && typeof ap.missingPackages !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.missingPackages must be a boolean' });
      }
      if (ap.incompleteProfile !== undefined && typeof ap.incompleteProfile !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.incompleteProfile must be a boolean' });
      }
      if (ap.missingPhotos !== undefined && typeof ap.missingPhotos !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'emailPrefs.actionPrompts.missingPhotos must be a boolean' });
      }
      if (ap.enabled !== undefined) {
        updateFields['emailPrefs.actionPrompts.enabled'] = ap.enabled;
      }
      if (ap.missingPackages !== undefined) {
        updateFields['emailPrefs.actionPrompts.missingPackages'] = ap.missingPackages;
      }
      if (ap.incompleteProfile !== undefined) {
        updateFields['emailPrefs.actionPrompts.incompleteProfile'] = ap.incompleteProfile;
      }
      if (ap.missingPhotos !== undefined) {
        updateFields['emailPrefs.actionPrompts.missingPhotos'] = ap.missingPhotos;
      }
    }

    const VALID_DIGEST_CADENCES = ['immediate', 'daily', 'weekly', 'none'];
    if (body.communityDigestCadence !== undefined) {
      if (!VALID_DIGEST_CADENCES.includes(body.communityDigestCadence)) {
        return res.status(400).json({
          error: `communityDigestCadence must be one of: ${VALID_DIGEST_CADENCES.join(', ')}`,
        });
      }
      updateFields['communityNotificationPreferences.email'] = body.communityDigestCadence;
    }

    if (body.browseNudgeOptOut !== undefined) {
      if (typeof body.browseNudgeOptOut !== 'boolean') {
        return res.status(400).json({ error: 'browseNudgeOptOut must be a boolean' });
      }
      updateFields.browseNudgeOptOut = body.browseNudgeOptOut;
    }

    if (body.verificationReminderOptOut !== undefined) {
      if (typeof body.verificationReminderOptOut !== 'boolean') {
        return res.status(400).json({ error: 'verificationReminderOptOut must be a boolean' });
      }
      updateFields.verificationReminderOptOut = body.verificationReminderOptOut;
    }

    const updated = await dbUnified.updateOne('users', { id: req.user.id }, { $set: updateFields });
    if (!updated) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true, notify });
  } catch (error) {
    logger.error('Error updating user settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/v1/me/settings/account-type
 * Self-service conversion between `customer` and `supplier`.
 * See docs/ACCOUNT_TYPE_CONVERSION_PLAN.md for the full design.
 */
router.post(
  '/account-type',
  writeLimiter,
  authRequired,
  csrfProtection,
  (req, res, next) => {
    // The risk guard reads req.body.email directly and hashes/assesses it for
    // velocity and reputation checks. Overwrite unconditionally — a fallback
    // (`|| req.user.email`) would let an authenticated caller submit an
    // arbitrary email in the body and have the guard assess that identity
    // instead of the account actually being upgraded, evading the checks
    // that identity is supposed to be scored against.
    req.body = req.body || {};
    req.body.email = req.user.email;
    next();
  },
  async (req, res, next) => {
    // Mirrors routes/auth.js's inline supplierApplications check — only applies
    // when the target role is 'supplier', so it can't go through featureRequired().
    if (req.body.targetRole === 'supplier') {
      const features = await getFeatureFlags();
      if (!features.supplierApplications) {
        return res.status(503).json({
          error: 'Feature temporarily unavailable',
          message: 'Supplier applications are currently disabled. Please try again later.',
          feature: 'supplierApplications',
        });
      }
    }
    next();
  },
  accountTypeConversionRiskGuard,
  async (req, res) => {
    const { targetRole, supplierInfo } = req.body || {};

    if (targetRole !== 'customer' && targetRole !== 'supplier') {
      return res.status(400).json({ error: 'targetRole must be "customer" or "supplier"' });
    }

    try {
      const user = await dbUnified.findOne('users', { id: req.user.id });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.role === 'admin') {
        return res
          .status(403)
          .json({ error: 'Admin accounts cannot be converted through this flow' });
      }

      const actor = { type: 'self', id: user.id, email: user.email };
      const result =
        targetRole === 'supplier'
          ? await accountTypeConversion.convertToSupplier(user, { supplierInfo, actor })
          : await accountTypeConversion.convertToCustomer(user, { actor });

      // Record the risk-assessment outcome as 'created' rather than letting the
      // guard's res.on('finish') handler fall through to 'completed_without_user',
      // which is excluded from the abuse-detection velocity checks.
      if (targetRole === 'supplier' && req.partnerRegistrationRisk) {
        try {
          await partnerRegistrationRisk.completeRegistrationRisk(req, user.id);
        } catch (riskError) {
          logger.warn('[ACCOUNT-TYPE] risk metadata finalisation failed (non-blocking)', {
            userId: user.id,
            error: riskError.message,
          });
        }
      }

      // Reissue the auth cookie so req.user.role (and dashboard redirects) reflect
      // the new role immediately, without forcing a logout/login.
      // remember is deliberately false: the JWT payload itself carries no record
      // of whether the caller's original login was "remember me" or session-only
      // (routes/auth.js signs every token with the same 7d expiresIn regardless),
      // so there's no reliable signal here for what the caller originally chose.
      // Defaulting to session-only only ever narrows the cookie's lifetime versus
      // what they had — never silently upgrades a session-only cookie to a
      // persistent one, which is the direction that would be a security problem.
      const token = jwt.sign({ id: user.id, email: user.email, role: result.role }, JWT_SECRET, {
        expiresIn: '7d',
      });
      setAuthCookie(res, token, { remember: false });

      res.json({
        ok: true,
        role: result.role,
        previousRole: result.previousRole,
        redirect: result.role === 'supplier' ? '/dashboard/supplier' : '/dashboard/customer',
      });
    } catch (error) {
      if (error instanceof accountTypeConversion.AccountTypeConversionError) {
        const status = ACCOUNT_TYPE_CONVERSION_STATUS_BY_CODE[error.code] || 400;
        return res.status(status).json({
          error: error.message,
          code: error.code,
          ...(error.retryAfterDays !== undefined ? { retryAfterDays: error.retryAfterDays } : {}),
        });
      }
      logger.error('Error converting account type:', error);
      res.status(500).json({ error: 'Failed to convert account type' });
    }
  }
);

module.exports = router;
