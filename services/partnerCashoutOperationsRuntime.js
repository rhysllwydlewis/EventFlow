'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const partnerAntiAbuse = require('./partnerAntiAbuseService');
const strictStore = require('./partnerCashoutStrictStore');
const ops = require('./partnerCashoutOperationsService');
const { notifyAdmins } = require('./notifyAdmins.service');

let installed = false;
let originalAssessCashout = null;

function errorStatus(decision) {
  if (decision?.reason === 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE') return 403;
  if (decision?.reason === 'PARTNER_CASHOUT_IDENTITY_REJECTED') return 403;
  if (
    decision?.reason === 'PARTNER_CASHOUT_STORAGE_UNAVAILABLE' ||
    decision?.reason === 'PARTNER_CASHOUT_LOCK_STORAGE_UNAVAILABLE'
  ) {
    return 503;
  }
  return 409;
}

function decisionPayload(decision) {
  return {
    error: decision?.message || 'This cashout cannot proceed under the current cashout policy.',
    code: decision?.reason || 'PARTNER_CASHOUT_POLICY_BLOCKED',
    limits: decision?.limits || undefined,
    reconciliation: decision?.reconciliation || undefined,
    identity: decision?.identity
      ? { eligible: decision.identity.eligible, reason: decision.identity.reason || null }
      : undefined,
  };
}

async function recordBlockedSubmission(partnerId, decision, req) {
  try {
    await ops.recordOpsEvent({
      action: 'cashout_submission_blocked',
      phase: 'completed',
      partnerId,
      reason: decision.reason,
      details: {
        denominationGbp: Number(req.body?.denominationGbp) || null,
        limitViolations: decision.limits?.violations?.map(item => item.code) || [],
      },
    });
  } catch (error) {
    logger.error('[PARTNER-CASHOUT-OPS] Failed to persist blocked submission event', {
      partnerId,
      error: error.message,
    });
  }
}

function attachTransitionOutcomeAudit(req, res, context) {
  let recorded = false;
  const writeOutcome = () => {
    if (recorded) return;
    recorded = true;
    const success = res.statusCode >= 200 && res.statusCode < 300;
    ops
      .recordOpsEvent({
        action: 'cashout_status_transition',
        phase: success ? 'completed' : 'failed',
        requestId: context.requestId,
        partnerId: context.partnerId,
        adminUserId: req.user?.id || null,
        reason: req.body?.adminInternalNotes || null,
        details: {
          fromStatus: context.fromStatus,
          toStatus: context.toStatus,
          httpStatus: res.statusCode,
        },
      })
      .catch(error => {
        logger.error('[PARTNER-CASHOUT-OPS] Failed to persist cashout transition outcome', {
          requestId: context.requestId,
          toStatus: context.toStatus,
          httpStatus: res.statusCode,
          error: error.message,
        });
      });
  };
  res.once('finish', writeOutcome);
  res.once('close', writeOutcome);
}

function buildPartnerSubmissionGuard() {
  const guardRouter = express.Router();
  guardRouter.post(
    '/cashout-requests',
    authRequired,
    roleRequired('partner'),
    async (req, res, next) => {
      try {
        const partner = await strictStore.findOne('partners', { userId: req.user.id });
        if (!partner) {
          return res.status(403).json({
            error: 'Partner account not found.',
            code: 'PARTNER_NOT_FOUND',
          });
        }
        const decision = await ops.submissionDecision({
          partnerId: partner.id,
          denominationGbp: Number(req.body?.denominationGbp),
        });
        req.partnerCashoutOpsDecision = decision;
        if (decision.allowed) return next();
        await recordBlockedSubmission(partner.id, decision, req);
        return res.status(errorStatus(decision)).json(decisionPayload(decision));
      } catch (error) {
        logger.error('[PARTNER-CASHOUT-OPS] Submission policy check failed closed', {
          userId: req.user?.id,
          error: error.message,
          code: error.code,
        });
        return res.status(503).json({
          error: 'Cashout safety checks are temporarily unavailable. Please try again later.',
          code: error.code || 'PARTNER_CASHOUT_POLICY_UNAVAILABLE',
        });
      }
    }
  );
  return guardRouter.stack;
}

function buildAdminTransitionGuard() {
  const guardRouter = express.Router();
  guardRouter.patch('/:id', async (req, res, next) => {
    const targetStatus = req.body?.status;
    if (!['approved', 'processing', 'delivered', 'rejected'].includes(targetStatus)) return next();
    try {
      const request = await strictStore.findOne('partner_cashout_requests', { id: req.params.id });
      if (!request) return next();

      await ops.recordOpsEvent({
        action: 'cashout_status_transition',
        phase: 'requested',
        requestId: request.id,
        partnerId: request.partnerId,
        adminUserId: req.user?.id || null,
        reason: req.body?.adminInternalNotes || null,
        details: { fromStatus: request.status, toStatus: targetStatus },
      });
      attachTransitionOutcomeAudit(req, res, {
        requestId: request.id,
        partnerId: request.partnerId,
        fromStatus: request.status,
        toStatus: targetStatus,
      });

      // Rejections remain available during an emergency pause so held points can be restored.
      if (targetStatus === 'rejected') return next();

      const controls = await ops.getControls();
      const pause = ops.pauseDecision(controls);
      if (pause.blocked) {
        return res.status(409).json({ error: pause.message, code: pause.code, controls });
      }

      if (targetStatus === 'approved') {
        const decision = await ops.approvalDecision(request);
        if (!decision.allowed) {
          if (
            decision.reason === 'PARTNER_CASHOUT_RECONCILIATION_FAILED' ||
            String(decision.reason || '').includes('IDENTITY')
          ) {
            notifyAdmins({
              type: 'system',
              title: 'Partner cashout blocked by safety controls',
              message: `Cashout ${request.id} was blocked: ${decision.reason}`,
              actionUrl: `/admin-cashout-requests.html?request=${request.id}`,
              actionText: 'Review cashout',
              priority: 'high',
              metadata: {
                requestId: request.id,
                partnerId: request.partnerId,
                reason: decision.reason,
              },
            }).catch(() => {});
          }
          return res.status(errorStatus(decision)).json(decisionPayload(decision));
        }
        req.partnerCashoutOpsApproval = decision;
      } else {
        const [identity, reconciliation] = await Promise.all([
          ops.identityDecision(request.partnerId),
          ops.reconcileRequest(request, { targetStatus }),
        ]);
        if (!identity.eligible) {
          return res.status(409).json({
            error: 'Cashout identity review is no longer valid.',
            code: identity.reason,
          });
        }
        if (!reconciliation.ok) {
          notifyAdmins({
            type: 'system',
            title: 'Partner cashout reconciliation failure',
            message: `Cashout ${request.id} cannot move to ${targetStatus}: ledger reconciliation failed.`,
            actionUrl: `/admin-cashout-requests.html?request=${request.id}`,
            actionText: 'Review cashout',
            priority: 'high',
            metadata: {
              requestId: request.id,
              partnerId: request.partnerId,
              issueCodes: reconciliation.issues.map(item => item.code),
            },
          }).catch(() => {});
          return res.status(409).json({
            error: 'Cashout ledger reconciliation failed. Resolve the ledger state before continuing.',
            code: 'PARTNER_CASHOUT_RECONCILIATION_FAILED',
            reconciliation,
          });
        }
      }
      return next();
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Admin transition guard failed closed', {
        requestId: req.params.id,
        targetStatus,
        error: error.message,
        code: error.code,
      });
      return res.status(503).json({
        error: 'Cashout safety checks are temporarily unavailable. No transition was applied.',
        code: error.code || 'PARTNER_CASHOUT_POLICY_UNAVAILABLE',
      });
    }
  });
  return guardRouter.stack;
}

function insertBeforeRoute(router, layers, predicate) {
  const index = router.stack.findIndex(predicate);
  if (index < 0) throw new Error('Target cashout route was not found during guard installation');
  router.stack.splice(index, 0, ...layers);
}

function appendAdminOpsRoutes(adminRouter) {
  adminRouter.get('/ops/controls', async (_req, res) => {
    try {
      const controls = await ops.getControls();
      return res.json({ controls, config: ops.getConfig() });
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Failed to read cashout controls', {
        error: error.message,
        code: error.code,
      });
      return res.status(503).json({
        error: 'Cashout safety controls are temporarily unavailable.',
        code: error.code || 'PARTNER_CASHOUT_CONTROL_READ_FAILED',
      });
    }
  });

  adminRouter.patch('/ops/controls', csrfProtection, async (req, res) => {
    try {
      await ops.recordOpsEvent({
        action: 'cashout_controls_change',
        phase: 'requested',
        adminUserId: req.user.id,
        reason: req.body?.reason,
        details: {
          programmePaused: req.body?.programmePaused,
          cashoutsPaused: req.body?.cashoutsPaused,
        },
      });
      const controls = await ops.setControls({
        programmePaused: req.body?.programmePaused,
        cashoutsPaused: req.body?.cashoutsPaused,
        reason: req.body?.reason,
        adminUserId: req.user.id,
      });
      await ops.recordOpsEvent({
        action: 'cashout_controls_change',
        phase: 'completed',
        adminUserId: req.user.id,
        reason: req.body?.reason,
        details: controls,
      });
      notifyAdmins({
        type: 'system',
        title:
          controls.programmePaused || controls.cashoutsPaused
            ? 'Partner cashouts paused'
            : 'Partner cashout controls updated',
        message: controls.reason || 'Partner cashout controls were updated by an administrator.',
        actionUrl: '/admin-cashout-requests.html',
        actionText: 'Open cashouts',
        priority: controls.programmePaused || controls.cashoutsPaused ? 'high' : 'normal',
        metadata: {
          updatedBy: req.user.id,
          programmePaused: controls.programmePaused,
          cashoutsPaused: controls.cashoutsPaused,
        },
      }).catch(() => {});
      return res.json({ ok: true, controls });
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Failed to update cashout controls', {
        error: error.message,
        code: error.code,
      });
      const status = String(error.code || '').includes('STORAGE_UNAVAILABLE') ? 503 : 400;
      return res.status(status).json({
        error: error.message,
        code: error.code || 'PARTNER_CASHOUT_CONTROL_FAILED',
      });
    }
  });

  adminRouter.patch('/ops/identity/:partnerId', csrfProtection, async (req, res) => {
    try {
      await ops.recordOpsEvent({
        action: 'cashout_identity_review',
        phase: 'requested',
        partnerId: req.params.partnerId,
        adminUserId: req.user.id,
        reason: req.body?.reason,
        details: { status: req.body?.status },
      });
      const partner = await ops.setIdentityReview({
        partnerId: req.params.partnerId,
        status: String(req.body?.status || ''),
        reason: req.body?.reason,
        adminUserId: req.user.id,
      });
      await ops.recordOpsEvent({
        action: 'cashout_identity_review',
        phase: 'completed',
        partnerId: partner.id,
        adminUserId: req.user.id,
        reason: req.body?.reason,
        details: { status: partner.cashoutIdentityStatus },
      });
      return res.json({
        ok: true,
        partnerId: partner.id,
        cashoutIdentityStatus: partner.cashoutIdentityStatus,
        cashoutIdentityReviewedAt: partner.cashoutIdentityReviewedAt,
      });
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Failed to update cashout identity review', {
        error: error.message,
        code: error.code,
      });
      const status =
        error.code === 'PARTNER_NOT_FOUND'
          ? 404
          : String(error.code || '').includes('STORAGE_UNAVAILABLE')
            ? 503
            : 400;
      return res.status(status).json({
        error: error.message,
        code: error.code || 'PARTNER_CASHOUT_IDENTITY_REVIEW_FAILED',
      });
    }
  });

  adminRouter.post('/ops/reconcile/:id', csrfProtection, async (req, res) => {
    try {
      const request = await strictStore.findOne('partner_cashout_requests', { id: req.params.id });
      if (!request) return res.status(404).json({ error: 'Cashout request not found' });
      const targetStatus = ['approved', 'processing', 'delivered', 'rejected'].includes(
        req.body?.targetStatus
      )
        ? req.body.targetStatus
        : null;
      const reconciliation = await ops.reconcileRequest(request, { targetStatus });
      const persisted = await strictStore.updateOne(
        'partner_cashout_requests',
        { id: request.id },
        {
          $set: {
            reconciliationStatus: reconciliation.ok ? 'ok' : 'failed',
            reconciliationIssues: reconciliation.issues,
            reconciliationRecoveryState: reconciliation.recoveryState || 'none',
            reconciledAt: reconciliation.reconciledAt,
            reconciledBy: req.user.id,
          },
        }
      );
      if (!persisted) throw new Error('Reconciliation result did not persist');
      await ops.recordOpsEvent({
        action: 'cashout_reconciliation',
        phase: 'completed',
        requestId: request.id,
        partnerId: request.partnerId,
        adminUserId: req.user.id,
        reason: req.body?.reason || null,
        details: {
          ok: reconciliation.ok,
          targetStatus,
          recoveryState: reconciliation.recoveryState || 'none',
          issueCodes: reconciliation.issues.map(item => item.code),
        },
      });
      return res.json({ ok: reconciliation.ok, reconciliation });
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Reconciliation endpoint failed', {
        error: error.message,
        code: error.code,
      });
      const status = String(error.code || '').includes('STORAGE_UNAVAILABLE') ? 503 : 500;
      return res.status(status).json({
        error: 'Cashout reconciliation failed',
        code: error.code || 'PARTNER_CASHOUT_RECONCILIATION_ERROR',
      });
    }
  });

  adminRouter.get('/ops/events', async (req, res) => {
    try {
      const filter = {};
      if (req.query.requestId) filter.requestId = String(req.query.requestId);
      if (req.query.partnerId) filter.partnerId = String(req.query.partnerId);
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 500);
      const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        strictStore.findWithOptions('partner_cashout_ops_events', filter, {
          limit,
          skip,
          sort: { createdAt: -1 },
        }),
        strictStore.count('partner_cashout_ops_events', filter),
      ]);
      return res.json({
        items,
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      });
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Failed to list cashout operations events', {
        error: error.message,
        code: error.code,
      });
      return res.status(503).json({
        error: 'Failed to list cashout operations events',
        code: error.code || 'PARTNER_CASHOUT_EVENTS_UNAVAILABLE',
      });
    }
  });
}

function wrapFraudAssessment() {
  if (originalAssessCashout) return;
  originalAssessCashout = partnerAntiAbuse.assessCashout;
  partnerAntiAbuse.assessCashout = async input => {
    const assessment = await originalAssessCashout(input);
    if (!input?.requestId) return assessment;
    const request = await strictStore.findOne('partner_cashout_requests', { id: input.requestId });
    if (!request) return assessment;
    const limits = await ops.evaluateLimits({
      partnerId: request.partnerId,
      denominationGbp: request.denominationGbp,
      requestId: request.id,
    });
    const signals = Array.isArray(assessment.signals) ? [...assessment.signals] : [];
    if (
      limits.requiresManualReview &&
      !signals.some(signal => signal.code === 'HIGH_VALUE_CASHOUT') &&
      limits.reviewReasons.includes('HIGH_VALUE_CASHOUT')
    ) {
      signals.push({
        code: 'HIGH_VALUE_CASHOUT',
        score: 0,
        message: 'Cashout amount meets the configured high-value manual review threshold.',
        evidence: {
          denominationGbp: request.denominationGbp,
          thresholdGbp: limits.config.highValueReviewGbp,
        },
      });
    }
    const next = {
      ...assessment,
      signals,
      requiresManualReview: assessment.requiresManualReview || limits.requiresManualReview,
      cashoutLimits: limits,
    };

    if (next.blockApproval || next.riskLevel === 'high') {
      const previous = await strictStore.findOne('partner_fraud_assessments', {
        requestId: request.id,
      });
      const alreadyHigh = previous?.blockApproval === true || previous?.riskLevel === 'high';
      if (!alreadyHigh) {
        notifyAdmins({
          type: 'system',
          title: 'High-risk partner cashout',
          message: `Cashout ${request.id} has been assessed as high risk and requires attention.`,
          actionUrl: `/admin-cashout-requests.html?request=${request.id}`,
          actionText: 'Review cashout',
          priority: 'high',
          metadata: {
            requestId: request.id,
            partnerId: request.partnerId,
            riskScore: next.score,
          },
        }).catch(() => {});
      }
    }
    return next;
  };
}

function install() {
  if (installed) return;
  const partnerRouter = require('../routes/partner');
  const adminCashoutRouter = require('../routes/admin-cashout-requests');

  insertBeforeRoute(
    partnerRouter,
    buildPartnerSubmissionGuard(),
    layer => layer.route?.path === '/cashout-requests' && layer.route.methods?.post
  );
  insertBeforeRoute(
    adminCashoutRouter,
    buildAdminTransitionGuard(),
    layer => layer.route?.path === '/:id' && layer.route.methods?.patch
  );
  appendAdminOpsRoutes(adminCashoutRouter);
  wrapFraudAssessment();

  installed = true;
  logger.info(
    '[PARTNER-CASHOUT-OPS] Submission, transition, identity, pause and reconciliation guards installed'
  );
}

module.exports = {
  install,
  _test: {
    buildPartnerSubmissionGuard,
    buildAdminTransitionGuard,
    insertBeforeRoute,
    attachTransitionOutcomeAudit,
    decisionPayload,
    errorStatus,
  },
};
