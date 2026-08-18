'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const emailLogService = require('../services/emailLog.service');
const verificationProvenance = require('../services/verificationProvenance.service');
const postmark = require('../utils/postmark');
const { EMAIL_ENABLED } = require('../config/email');
const reviewRequestOperations = require('../utils/reviewRequestOperations');

const router = express.Router();

function safeDomain(address) {
  if (!address || typeof address !== 'string' || !address.includes('@')) {
    return process.env.EMAIL_DOMAIN || null;
  }
  return address.split('@').pop() || null;
}

router.get(
  '/summary',
  limits.apiLimiter,
  auth.authRequired,
  auth.roleRequired('admin'),
  async (_req, res) => {
    const emailSummary = await emailLogService.getSummary();
    const provenance = await verificationProvenance.getVerificationIntegrity({ lookbackDays: 30 });
    const status = postmark.getPostmarkStatus();
    const defaultFrom = status.from || null;
    res.json({
      ok: true,
      summary: emailSummary.summary,
      health: {
        emailEnabled: EMAIL_ENABLED,
        postmarkConfigured: Boolean(status.apiKeyConfigured),
        provider: !EMAIL_ENABLED ? 'disabled' : status.enabled ? 'postmark' : 'outbox',
        defaultFrom,
        emailDomain: process.env.EMAIL_DOMAIN || safeDomain(defaultFrom),
        campaignMessageStream: process.env.CAMPAIGN_MESSAGE_STREAM || 'outbound',
        lastWebhookAt: emailSummary.lastWebhookAt,
        totalLogged: emailSummary.total,
        bounceRatePercent: emailSummary.bounceRate,
        complaintRatePercent: emailSummary.complaintRate,
        verificationProvenance: provenance.summary,
      },
    });
  }
);

router.get(
  '/review-requests',
  limits.apiLimiter,
  auth.authRequired,
  auth.roleRequired('admin'),
  async (req, res) => {
    try {
      const requests = await dbUnified.read('reviewRequests');
      return res.json({
        ok: true,
        ...reviewRequestOperations.listAdminRequests(requests || [], req.query, new Date()),
      });
    } catch {
      return res.status(500).json({
        ok: false,
        error: 'Unable to load review request operations',
      });
    }
  }
);

async function verificationIntegrityHandler(req, res) {
  const lookbackDays = Number(req.query.lookbackDays || 30);
  const result = await verificationProvenance.getVerificationIntegrity({ lookbackDays });
  res.json(result);
}

router.get(
  '/verification-provenance',
  limits.apiLimiter,
  auth.authRequired,
  auth.roleRequired('admin'),
  verificationIntegrityHandler
);
router.get(
  '/verification-integrity',
  limits.apiLimiter,
  auth.authRequired,
  auth.roleRequired('admin'),
  verificationIntegrityHandler
);

router.get(
  '/users-provenance',
  limits.apiLimiter,
  auth.authRequired,
  auth.roleRequired('admin'),
  async (_req, res) => {
    const users = await dbUnified.read('users');
    const verificationLogs = await verificationProvenance.readVerificationLogs();
    const items = (users || []).map(user => {
      const summary = verificationProvenance.summariseUser(user, verificationLogs);
      return {
        id: user.id || (user._id ? user._id.toString() : undefined),
        email: user.email,
        name: user.name,
        role: user.role,
        verified: Boolean(user.verified),
        createdAt: user.createdAt,
        signupMethod: summary.signupMethod,
        authProvider: summary.authProvider,
        verificationMethod: summary.verificationMethod,
        verifiedAt: summary.verifiedAt,
        verifiedBy: summary.verifiedBy,
        emailDeliveryStatus: summary.emailDeliveryStatus,
        verificationEmailSentAt: summary.verificationEmailSentAt,
        lastVerificationEmailLogId: summary.lastVerificationEmailLogId,
        lastVerificationEmailPostmarkMessageId: summary.lastVerificationEmailPostmarkMessageId,
        hasGoogleLink: summary.hasGoogleLink,
        googleLinkedAt: summary.googleLinkedAt,
      };
    });
    items.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    res.json({ ok: true, items });
  }
);

module.exports = router;
