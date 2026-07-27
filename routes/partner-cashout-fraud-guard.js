'use strict';

const express = require('express');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const partnerAntiAbuse = require('../services/partnerAntiAbuseService');

const router = express.Router();

router.use(authRequired, roleRequired('admin'));

router.patch('/:id', async (req, res, next) => {
  if (req.body?.status !== 'approved') return next();

  try {
    const request = await dbUnified.findOne('partner_cashout_requests', { id: req.params.id });
    if (!request) return next();

    const assessment = await partnerAntiAbuse.assessCashout({
      partnerId: request.partnerId,
      requestId: request.id,
      requestedAt: request.createdAt,
    });
    await partnerAntiAbuse.persistAssessment(assessment);

    const updates = {
      fraudRiskScore: assessment.score,
      fraudRiskLevel: assessment.riskLevel,
      fraudReviewRequired: assessment.requiresManualReview,
      fraudAssessedAt: assessment.assessedAt,
    };

    const override = String(req.body?.fraudOverrideReason || '').trim();
    if (assessment.blockApproval && override.length < 20) {
      await dbUnified.updateOne(
        'partner_cashout_requests',
        { id: request.id },
        { $set: updates }
      );
      return res.status(409).json({
        error:
          'This cashout is high risk and cannot be approved without a fraud override reason of at least 20 characters.',
        code: 'PARTNER_CASHOUT_HIGH_RISK',
        assessment,
      });
    }

    if (assessment.blockApproval) {
      Object.assign(updates, {
        fraudOverrideReason: override.slice(0, 2000),
        fraudOverrideBy: req.user.id,
        fraudOverrideAt: new Date().toISOString(),
      });
    }

    await dbUnified.updateOne(
      'partner_cashout_requests',
      { id: request.id },
      { $set: updates }
    );
    req.partnerFraudAssessment = assessment;
    return next();
  } catch (error) {
    logger.error('[PARTNER-ANTI-ABUSE] Cashout approval guard failed closed', {
      cashoutRequestId: req.params.id,
      adminUserId: req.user?.id,
      error: error.message,
    });
    return res.status(503).json({
      error: 'Cashout fraud checks are temporarily unavailable. Approval has been blocked.',
      code: 'PARTNER_FRAUD_CHECK_UNAVAILABLE',
    });
  }
});

module.exports = router;
