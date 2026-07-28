/**
 * Admin Cashout Request Routes
 * Admin-only endpoints for managing partner cashout requests
 *
 * Base path (mounted in routes/index.js): /api/admin/cashout-requests
 *
 * Status workflow:
 *   submitted → approved | rejected
 *   approved  → processing → delivered
 *   rejected  releases held points and reverses any interrupted redemption
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
const partnerAntiAbuse = require('../services/partnerAntiAbuseService');

const router = express.Router();

router.use(authRequired, roleRequired('admin'));

const VALID_STATUSES = ['submitted', 'approved', 'rejected', 'processing', 'delivered'];
const VALID_TRANSITIONS = {
  submitted: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['delivered', 'rejected'],
  rejected: [],
  delivered: [],
};

function hasDeliveryEvidence(deliveryDetails) {
  if (!deliveryDetails || typeof deliveryDetails !== 'object') return false;
  return [deliveryDetails.code, deliveryDetails.reference, deliveryDetails.last4].some(value =>
    Boolean(String(value || '').trim())
  );
}

function findCashoutRedeem(transactions, cashoutRequest) {
  const redeemType = partnerService.CREDIT_TYPES.REDEEM;
  const isMatchingRedeem = transaction =>
    transaction &&
    transaction.type === redeemType &&
    transaction.partnerId === cashoutRequest.partnerId &&
    transaction.externalRef === cashoutRequest.id;

  if (cashoutRequest.finalRedeemTxnId) {
    const byStoredId = transactions.find(
      transaction => transaction.id === cashoutRequest.finalRedeemTxnId && isMatchingRedeem(transaction)
    );
    if (byStoredId) return byStoredId;
  }

  return transactions.find(isMatchingRedeem) || null;
}

async function reverseInterruptedRedeem(cashoutRequest, transactions, now) {
  const redeem = findCashoutRedeem(transactions, cashoutRequest);
  if (!redeem) return null;

  const adjustmentType = partnerService.CREDIT_TYPES.ADJUSTMENT || 'ADJUSTMENT';
  const existing = transactions.find(
    transaction =>
      transaction.type === adjustmentType &&
      transaction.partnerId === cashoutRequest.partnerId &&
      transaction.externalRef === redeem.id &&
      transaction.subtype === 'CASHOUT_REDEEM_REVERSAL'
  );
  if (existing) return existing;

  const reversal = {
    id: uid('ptx'),
    partnerId: cashoutRequest.partnerId,
    supplierUserId: null,
    type: adjustmentType,
    subtype: 'CASHOUT_REDEEM_REVERSAL',
    amount: Math.abs(Number(redeem.amount)),
    notes: `Reversal of interrupted cashout redemption ${redeem.id} for request ${cashoutRequest.id}`,
    externalRef: redeem.id,
    createdAt: now,
  };

  if (!Number.isFinite(reversal.amount) || reversal.amount <= 0) {
    const error = new Error('The interrupted cashout redemption amount is invalid.');
    error.code = 'CASHOUT_REDEEM_REVERSAL_INVALID';
    throw error;
  }

  const inserted = await dbUnified.insertOne('partner_credit_transactions', reversal);
  if (!inserted) {
    const error = new Error('Failed to persist the cashout redemption reversal.');
    error.code = 'CASHOUT_REDEEM_REVERSAL_WRITE_FAILED';
    throw error;
  }
  return reversal;
}

async function releaseCashoutHoldOrThrow(cashoutRequest, message) {
  const releaseResult = await partnerService.releaseCashoutHold(
    cashoutRequest.holdTxnId,
    cashoutRequest.partnerId
  );
  if (!releaseResult) {
    const error = new Error(message);
    error.code = 'CASHOUT_HOLD_RELEASE_FAILED';
    throw error;
  }
  return releaseResult;
}

async function persistRiskFields(requestId, riskFields) {
  const persisted = await dbUnified.updateOne(
    'partner_cashout_requests',
    { id: requestId },
    { $set: riskFields }
  );
  if (!persisted) {
    const error = new Error('Cashout fraud risk fields did not persist.');
    error.code = 'PARTNER_CASHOUT_RISK_WRITE_FAILED';
    throw error;
  }
}

async function assessApproval(cashoutRequest, adminInternalNotes, now) {
  const assessment = await partnerAntiAbuse.assessCashout({
    partnerId: cashoutRequest.partnerId,
    requestId: cashoutRequest.id,
    requestedAt: cashoutRequest.createdAt,
  });
  await partnerAntiAbuse.persistAssessment(assessment);

  const riskFields = {
    fraudRiskScore: assessment.score,
    fraudRiskLevel: assessment.riskLevel,
    fraudReviewRequired: assessment.requiresManualReview,
    fraudAssessedAt: assessment.assessedAt,
  };

  if (assessment.blockApproval) {
    await persistRiskFields(cashoutRequest.id, riskFields);
    const error = new Error(
      'High-risk partner cashout blocked. Reject the request or resolve the underlying fraud signals.'
    );
    error.code = 'PARTNER_CASHOUT_HIGH_RISK';
    error.statusCode = 409;
    error.assessment = assessment;
    throw error;
  }

  const reviewNote = String(
    adminInternalNotes ?? cashoutRequest.adminInternalNotes ?? ''
  ).trim();
  if (assessment.requiresManualReview && reviewNote.length < 20) {
    await persistRiskFields(cashoutRequest.id, riskFields);
    const error = new Error(
      'This cashout requires manual review. Add an internal review note of at least 20 characters before approval.'
    );
    error.code = 'PARTNER_CASHOUT_REVIEW_NOTE_REQUIRED';
    error.statusCode = 409;
    error.assessment = assessment;
    throw error;
  }

  return { ...riskFields, fraudReviewedAt: now };
}

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
      requests = requests.filter(item => item.status === status);
    }
    if (partnerId) requests = requests.filter(item => item.partnerId === partnerId);

    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    requests = requests.slice(0, maxLimit);

    const [users, partners] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('partners'),
    ]);
    const enriched = requests.map(item => {
      const partner = partners.find(candidate => candidate.id === item.partnerId);
      const user = users.find(candidate => candidate.id === item.partnerUserId);
      return {
        ...item,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user
          ? { name: user.name, email: user.email, company: user.company }
          : null,
        deletedUser: !user,
        fraudSummary: {
          riskLevel: item.fraudRiskLevel || 'not_assessed',
          riskScore: item.fraudRiskScore ?? null,
          reviewRequired: item.fraudReviewRequired === true,
          reviewedAt: item.fraudReviewedAt || null,
        },
      };
    });

    return res.json({ items: enriched, total: enriched.length });
  } catch (error) {
    logger.error('Error listing cashout requests:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const requests = (await dbUnified.read('partner_cashout_requests')) || [];
    const cashoutRequest = requests.find(item => item.id === req.params.id);
    if (!cashoutRequest) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const [users, partners, transactions, fraudAssessment] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('partners'),
      dbUnified.read('partner_credit_transactions'),
      dbUnified.findOne('partner_fraud_assessments', { requestId: cashoutRequest.id }),
    ]);
    const partner = partners.find(item => item.id === cashoutRequest.partnerId);
    const user = users.find(item => item.id === cashoutRequest.partnerUserId);
    const holdTransaction = cashoutRequest.holdTxnId
      ? transactions.find(item => item.id === cashoutRequest.holdTxnId)
      : null;
    const redeemTransaction = findCashoutRedeem(transactions, cashoutRequest);

    return res.json({
      request: {
        ...cashoutRequest,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user
          ? { name: user.name, email: user.email, company: user.company }
          : null,
      },
      holdTransaction: holdTransaction || null,
      redeemTransaction: redeemTransaction || null,
      fraudAssessment: fraudAssessment || null,
    });
  } catch (error) {
    logger.error('Error fetching cashout request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id', csrfProtection, async (req, res) => {
  try {
    const { status, adminResponseMessage, adminInternalNotes, deliveryDetails } = req.body || {};
    const requests = (await dbUnified.read('partner_cashout_requests')) || [];
    const cashoutRequest = requests.find(item => item.id === req.params.id);
    if (!cashoutRequest) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const now = new Date().toISOString();
    const updates = { updatedAt: now };

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const allowed = VALID_TRANSITIONS[cashoutRequest.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot transition from '${cashoutRequest.status}' to '${status}'. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
        });
      }

      if (status === 'delivered') {
        if (!hasDeliveryEvidence(deliveryDetails)) {
          return res.status(400).json({
            error: 'Delivery evidence is required before a cashout can be marked delivered.',
            code: 'CASHOUT_DELIVERY_EVIDENCE_REQUIRED',
          });
        }
        if (!cashoutRequest.holdTxnId) {
          return res.status(409).json({
            error: 'The cashout has no active points hold and cannot be delivered safely.',
            code: 'CASHOUT_HOLD_MISSING',
          });
        }
        if (
          !Number.isFinite(Number(cashoutRequest.pointsHeld)) ||
          Number(cashoutRequest.pointsHeld) <= 0
        ) {
          return res.status(409).json({
            error: 'The cashout held-points value is invalid.',
            code: 'CASHOUT_POINTS_INVALID',
          });
        }
      }

      updates.status = status;
      updates.adminUserIdApproved = req.user.id;

      if (status === 'approved') {
        Object.assign(updates, await assessApproval(cashoutRequest, adminInternalNotes, now));
        updates.approvedAt = now;
      } else if (status === 'rejected') {
        updates.rejectedAt = now;
      } else if (status === 'processing') {
        updates.processingAt = now;
      } else if (status === 'delivered') {
        updates.deliveredAt = now;
        updates.deliveryDetails = deliveryDetails;
      }

      if (status === 'rejected') {
        const transactions = (await dbUnified.read('partner_credit_transactions')) || [];
        const reversal = await reverseInterruptedRedeem(cashoutRequest, transactions, now);
        if (reversal) updates.finalRedeemReversalTxnId = reversal.id;

        if (cashoutRequest.holdTxnId) {
          await releaseCashoutHoldOrThrow(
            cashoutRequest,
            'Failed to release the cashout hold after rejection.'
          );
          logger.info(
            `Points released for rejected cashout ${cashoutRequest.id}: holdTxn=${cashoutRequest.holdTxnId}`
          );
        }
      }

      if (status === 'delivered') {
        const transactions = (await dbUnified.read('partner_credit_transactions')) || [];
        let existingRedeem = findCashoutRedeem(transactions, cashoutRequest);

        if (existingRedeem) {
          updates.finalRedeemTxnId = existingRedeem.id;
        } else {
          const finalRedeem = {
            id: uid('ptx'),
            partnerId: cashoutRequest.partnerId,
            supplierUserId: null,
            type: partnerService.CREDIT_TYPES.REDEEM,
            amount: -Math.abs(Number(cashoutRequest.pointsHeld)),
            notes: `Cashout delivered: £${cashoutRequest.denominationGbp} via ${cashoutRequest.method} (request ${cashoutRequest.id})`,
            externalRef: cashoutRequest.id,
            createdAt: now,
          };
          const inserted = await dbUnified.insertOne('partner_credit_transactions', finalRedeem);
          if (!inserted) {
            const error = new Error('Failed to persist the final cashout redemption.');
            error.code = 'CASHOUT_REDEEM_WRITE_FAILED';
            throw error;
          }
          existingRedeem = finalRedeem;
          updates.finalRedeemTxnId = finalRedeem.id;
        }

        await releaseCashoutHoldOrThrow(
          cashoutRequest,
          'Failed to release the cashout hold after redemption.'
        );
      }
    }

    if (adminResponseMessage !== undefined) {
      updates.adminResponseMessage =
        String(adminResponseMessage).trim().slice(0, 2000) || null;
    }
    if (adminInternalNotes !== undefined) {
      updates.adminInternalNotes =
        String(adminInternalNotes).trim().slice(0, 2000) || null;
    }

    const updatedRecord = await dbUnified.updateOne(
      'partner_cashout_requests',
      { id: req.params.id },
      { $set: updates }
    );
    if (!updatedRecord) {
      const error = new Error('Failed to update cashout request.');
      error.code = 'CASHOUT_REQUEST_WRITE_FAILED';
      throw error;
    }

    logger.info(
      `Admin ${req.user.id} updated cashout request ${req.params.id}: ${JSON.stringify(updates)}`
    );
    return res.json({ ok: true, request: { ...cashoutRequest, ...updates } });
  } catch (error) {
    logger.error('Error updating cashout request:', error);
    const statusCode = Number(error.statusCode) || 500;
    return res.status(statusCode).json({
      error: statusCode < 500 ? error.message : 'Internal server error',
      code: error.code || 'CASHOUT_UPDATE_FAILED',
      assessment: error.assessment || undefined,
    });
  }
});

router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const requests = (await dbUnified.read('partner_cashout_requests')) || [];
    const cashoutRequest = requests.find(item => item.id === req.params.id);
    if (!cashoutRequest) {
      return res.status(404).json({ error: 'Cashout request not found' });
    }

    const TERMINAL_STATES = ['rejected', 'delivered'];
    if (!TERMINAL_STATES.includes(cashoutRequest.status)) {
      return res.status(409).json({
        error: `Cannot delete a cashout request in "${cashoutRequest.status}" state. Only rejected or delivered requests can be deleted.`,
      });
    }

    const deleted = await dbUnified.deleteOne('partner_cashout_requests', {
      id: req.params.id,
    });
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete cashout request' });
    }

    logger.info(
      `Admin ${req.user.id} deleted cashout request ${req.params.id} (status: ${cashoutRequest.status})`
    );
    return res.json({ ok: true });
  } catch (error) {
    logger.error('Error deleting cashout request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
