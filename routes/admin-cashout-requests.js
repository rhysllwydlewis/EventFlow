/**
 * Admin Cashout Request Routes
 * Admin-only endpoints for managing partner cashout requests
 *
 * Base path (mounted in routes/index.js): /api/admin/cashout-requests
 *
 * Status workflow:
 *   submitted → approved | rejected
 *   approved  → processing → delivered
 *   rejected  releases held points back to partner
 *   delivered finalises the hold as a permanent redemption
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const partnerService = require('../services/partnerService');

const router = express.Router();

// All routes require admin authentication
router.use(authRequired, roleRequired('admin'));

/** Allowed status transitions */
const VALID_STATUSES = ['submitted', 'approved', 'rejected', 'processing', 'delivered'];
const VALID_TRANSITIONS = {
  submitted: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['delivered', 'rejected'],
  // terminal states cannot be changed
  rejected: [],
  delivered: [],
};

function hasDeliveryEvidence(deliveryDetails) {
  if (!deliveryDetails || typeof deliveryDetails !== 'object') return false;
  return [deliveryDetails.code, deliveryDetails.reference, deliveryDetails.last4].some(value =>
    Boolean(String(value || '').trim())
  );
}

// ─── List Cashout Requests ────────────────────────────────────────────────────

/**
 * GET /api/admin/cashout-requests
 * List all partner cashout requests.
 * Query params: status, partnerId, limit (max 200)
 */
router.get('/', async (req, res) => {
  try {
    const { status, partnerId, limit } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || 100, 200);

    let requests = (await dbUnified.read('partner_cashout_requests')) || [];

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      requests = requests.filter(r => r.status === status);
    }
    if (partnerId) {
      requests = requests.filter(r => r.partnerId === partnerId);
    }

    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    requests = requests.slice(0, maxLimit);

    // Enrich with partner user info
    const users = await dbUnified.read('users');
    const partners = await dbUnified.read('partners');

    const enriched = requests.map(r => {
      const partner = partners.find(p => p.id === r.partnerId);
      const user = users.find(u => u.id === r.partnerUserId);
      return {
        ...r,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user ? { name: user.name, email: user.email, company: user.company } : null,
        deletedUser: !user,
        fraudSummary: {
          riskLevel: r.fraudRiskLevel || 'not_assessed',
          riskScore: r.fraudRiskScore ?? null,
          reviewRequired: r.fraudReviewRequired === true,
          reviewedAt: r.fraudReviewedAt || null,
        },
      };
    });

    return res.json({ items: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Error listing cashout requests:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get Cashout Request Detail ───────────────────────────────────────────────

/**
 * GET /api/admin/cashout-requests/:id
 * Get full detail of a single cashout request.
 */
router.get('/:id', async (req, res) => {
  try {
    const all = (await dbUnified.read('partner_cashout_requests')) || [];
    const request = all.find(r => r.id === req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const [users, partners, txns, fraudAssessment] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('partners'),
      dbUnified.read('partner_credit_transactions'),
      dbUnified.findOne('partner_fraud_assessments', { requestId: request.id }),
    ]);
    const partner = partners.find(p => p.id === request.partnerId);
    const user = users.find(u => u.id === request.partnerUserId);

    // Also retrieve hold and redeem transaction details for audit
    const holdTxn = request.holdTxnId ? txns.find(t => t.id === request.holdTxnId) : null;
    const redeemTxn = request.finalRedeemTxnId
      ? txns.find(t => t.id === request.finalRedeemTxnId)
      : null;

    return res.json({
      request: {
        ...request,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user ? { name: user.name, email: user.email, company: user.company } : null,
      },
      holdTransaction: holdTxn || null,
      redeemTransaction: redeemTxn || null,
      fraudAssessment: fraudAssessment || null,
    });
  } catch (err) {
    logger.error('Error fetching cashout request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update Cashout Request ───────────────────────────────────────────────────

/**
 * PATCH /api/admin/cashout-requests/:id
 * Update a cashout request status and/or add admin notes.
 *
 * Body:
 *   status              – new status (must be a valid transition)
 *   adminResponseMessage – optional message visible to partner
 *   adminInternalNotes  – optional internal notes (not shown to partner)
 *   deliveryDetails     – optional { code, reference, last4, ... } (required when status=delivered)
 */
router.patch('/:id', csrfProtection, async (req, res) => {
  try {
    const { status, adminResponseMessage, adminInternalNotes, deliveryDetails } = req.body || {};

    const all = (await dbUnified.read('partner_cashout_requests')) || [];
    const request = all.find(r => r.id === req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const now = new Date().toISOString();
    const updates = { updatedAt: now };

    // Status transition
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const allowed = VALID_TRANSITIONS[request.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot transition from '${request.status}' to '${status}'. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
        });
      }
      if (status === 'delivered' && !hasDeliveryEvidence(deliveryDetails)) {
        return res.status(400).json({
          error: 'Delivery evidence is required before a cashout can be marked delivered.',
          code: 'CASHOUT_DELIVERY_EVIDENCE_REQUIRED',
        });
      }

      updates.status = status;
      updates.adminUserIdApproved = req.user.id;

      if (status === 'approved') {
        updates.approvedAt = now;
      } else if (status === 'rejected') {
        updates.rejectedAt = now;
      } else if (status === 'processing') {
        updates.processingAt = now;
      } else if (status === 'delivered') {
        updates.deliveredAt = now;
        updates.deliveryDetails = deliveryDetails;
      }

      // Side-effects for terminal transitions
      if (status === 'rejected') {
        // Release held points back to partner
        if (request.holdTxnId) {
          const releaseResult = await partnerService.releaseCashoutHold(
            request.holdTxnId,
            request.partnerId
          );
          if (releaseResult) {
            logger.info(
              `Points released for rejected cashout ${request.id}: holdTxn=${request.holdTxnId}`
            );
          }
        }
      } else if (status === 'delivered') {
        // Finalise the permanent debit before releasing the temporary hold. A retry can
        // then recover an interrupted delivery without briefly restoring spendable points.
        if (request.finalRedeemTxnId) {
          updates.finalRedeemTxnId = request.finalRedeemTxnId;
        } else {
          const allTxns = (await dbUnified.read('partner_credit_transactions')) || [];
          const existingRedeem = allTxns.find(
            t =>
              t.type === partnerService.CREDIT_TYPES.REDEEM &&
              t.partnerId === request.partnerId &&
              t.externalRef === request.id
          );
          if (existingRedeem) {
            updates.finalRedeemTxnId = existingRedeem.id;
          } else {
            const finalRedeem = {
              id: uid('ptx'),
              partnerId: request.partnerId,
              supplierUserId: null,
              type: partnerService.CREDIT_TYPES.REDEEM,
              amount: -Math.abs(request.pointsHeld),
              notes: `Cashout delivered: £${request.denominationGbp} via ${request.method} (request ${request.id})`,
              externalRef: request.id,
              createdAt: now,
            };
            const cashoutTxInserted = await dbUnified.insertOne(
              'partner_credit_transactions',
              finalRedeem
            );
            if (!cashoutTxInserted) {
              const error = new Error('Failed to persist the final cashout redemption.');
              error.code = 'CASHOUT_REDEEM_WRITE_FAILED';
              throw error;
            }
            updates.finalRedeemTxnId = finalRedeem.id;
          }
        }

        if (request.holdTxnId) {
          const releaseResult = await partnerService.releaseCashoutHold(
            request.holdTxnId,
            request.partnerId
          );
          if (!releaseResult) {
            const error = new Error('Failed to release the cashout hold after redemption.');
            error.code = 'CASHOUT_HOLD_RELEASE_FAILED';
            throw error;
          }
        }
      }
    }

    if (adminResponseMessage !== undefined) {
      updates.adminResponseMessage = String(adminResponseMessage).trim().slice(0, 2000) || null;
    }
    if (adminInternalNotes !== undefined) {
      updates.adminInternalNotes = String(adminInternalNotes).trim().slice(0, 2000) || null;
    }

    const updatedRecord = await dbUnified.updateOne(
      'partner_cashout_requests',
      { id: req.params.id },
      { $set: updates }
    );
    if (!updatedRecord) {
      return res.status(500).json({ error: 'Failed to update cashout request' });
    }

    logger.info(
      `Admin ${req.user.id} updated cashout request ${req.params.id}: ${JSON.stringify(updates)}`
    );

    const updated = { ...request, ...updates };
    return res.json({ ok: true, request: updated });
  } catch (err) {
    logger.error('Error updating cashout request:', err);
    const statusCode = Number(err.statusCode) || 500;
    return res.status(statusCode).json({
      error: statusCode < 500 ? err.message : 'Internal server error',
      code: err.code || 'CASHOUT_UPDATE_FAILED',
      assessment: err.assessment || undefined,
    });
  }
});

// ─── Delete Cashout Request ───────────────────────────────────────────────────

/**
 * DELETE /api/admin/cashout-requests/:id
 * Permanently delete a cashout request record.
 * Only allowed for requests in terminal states (rejected or delivered).
 */
router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const all = (await dbUnified.read('partner_cashout_requests')) || [];
    const request = all.find(r => r.id === req.params.id);
    if (!request) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const TERMINAL_STATES = ['rejected', 'delivered'];
    if (!TERMINAL_STATES.includes(request.status)) {
      return res.status(409).json({
        error: `Cannot delete a cashout request in "${request.status}" state. Only rejected or delivered requests can be deleted.`,
      });
    }

    const deleted = await dbUnified.deleteOne('partner_cashout_requests', { id: req.params.id });
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete cashout request' });
    }

    logger.info(
      `Admin ${req.user.id} deleted cashout request ${req.params.id} (status: ${request.status})`
    );

    return res.json({ ok: true });
  } catch (err) {
    logger.error('Error deleting cashout request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
