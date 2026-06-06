'use strict';

const express = require('express');
const auth = require('../middleware/auth');
const limits = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const provenance = require('../services/verificationProvenance.service');

const router = express.Router();

router.get('/users/provenance', limits.apiLimiter, auth.authRequired, auth.roleRequired('admin'), async (_req, res) => {
  const users = await dbUnified.read('users');
  const verificationLogs = await provenance.readVerificationLogs();
  const items = (users || []).map(user => {
    const summary = provenance.summariseUser(user, verificationLogs);
    return {
      id: user.id || (user._id ? user._id.toString() : undefined),
      email: user.email,
      name: user.name,
      role: user.role,
      verified: Boolean(user.verified),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
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
  items.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  res.json({ ok: true, items });
});

module.exports = router;
