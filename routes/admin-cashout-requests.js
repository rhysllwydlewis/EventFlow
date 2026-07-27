/**
 * Admin-only endpoints for managing partner cashout requests.
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
router.use(authRequired, roleRequired('admin'));

const VALID_STATUSES = ['submitted', 'approved', 'rejected', 'processing', 'delivered'];
const VALID_TRANSITIONS = {
  submitted: ['approved', 'rejected'],
  approved: ['processing', 'rejected'],
  processing: ['delivered', 'rejected'],
  rejected: [],
  delivered: [],
};

router.get('/', async (req, res) => {
  try {
    const { status, partnerId, limit } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || 100, 200);
    let requests = (await dbUnified.read('partner_cashout_requests')) || [];

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      requests = requests.filter(request => request.status === status);
    }
    if (partnerId) requests = requests.filter(request => request.partnerId === partnerId);

    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    requests = requests.slice(0, maxLimit);
    const users = await dbUnified.read('users');
    const partners = await dbUnified.read('partners');

    const enriched = requests.map(request => {
      const partner = partners.find(item => item.id === request.partnerId);
      const user = users.find(item => item.id === request.partnerUserId);
      return {
        ...request,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user ? { name: user.name, email: user.email, company: user.company } : null,
        deletedUser: !user,
        fraudSummary: {
          riskLevel: request.fraudRiskLevel || 'not_assessed',
          riskScore: request.fraudRiskScore ?? null,
          reviewRequired: request.fraudReviewRequired === true,
          reviewedAt: request.fraudReviewedAt || null,
        },
      };
    });

    return res.json({ items: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Error listing cashout requests:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const request = await dbUnified.findOne('partner_cashout_requests', { id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Cashout request not found' });

    const [users, partners, txns, fraudAssessment] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('partners'),
      dbUnified.read('partner_credit_transactions'),
      dbUnified.findOne('partner_fraud_assessments', { requestId: request.id }),
    ]);
    const partner = partners.find(item => item.id === request.partnerId);
    const user = users.find(item => item.id === request.partnerUserId);
    const holdTxn = request.holdTxnId ? txns.find(item => item.id === request.holdTxnId) : null;
    const redeemTxn = request.finalRedeemTxnId
      ? txns.find(item => item.id === request.finalRedeemTxnId)
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

router.patch('/:id', csrfProtection, async (req, res) => {
  try {
    const { status, adminResponseMessage, adminInternalNotes, deliveryDetails } = req.body || {};
    const request = await dbUnified.findOne('partner_cashout_requests', { id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Cashout request not found' });

    const now = new Date().toISOString();
    const updates = { updatedAt: now };

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const allowed = VALID_TRANSITIONS[request.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot transition from '${request.status}' to '${status}'. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
        });
      }
      if (status === 'delivered') {
        const evidence = deliveryDetails && typeof deliveryDetails === 'object' ? deliveryDetails : null;
        const hasReference = Boolean(
          evidence &&
            [evidence.code, evidence.reference, evidence.last4].some(value => String(value || '').trim())
        );
        if (!hasReference) {
          return res.status(400).json({
            error: 'Delivery evidence is required before a cashout can be marked delivered.',
            code: 'CASHOUT_DELIVERY_EVIDENCE_REQUIRED',
          });
        }
      }

      updates.status = status;
      updates.adminUserIdApproved = req.user.id;
      if (status === 'approved') updates.approvedAt = now;
      if (status === 'rejected') updates.rejectedAt = now;
      if (status === 'processing') updates.processingAt = now;
      if (status === 'delivered') {
        updates.deliveredAt = now;
        updates.deliveryDetails = deliveryDetails;
      }

      if (status === 'rejected' && request.holdTxnId) {
        await partnerService.releaseCashoutHold(request.holdTxnId, request.partnerId);
      }

      if (status === 'delivered') {
        if (request.holdTxnId) {
          await partnerService.releaseCashoutHold(request.holdTxnId, request.partnerId);
        }
        if (request.finalRedeemTxnId) {
          updates.finalRedeemTxnId = request.finalRedeemTxnId;
        } else {
          const allTxns = (await dbUnified.read('partner_credit_transactions')) || [];
          const existingRedeem = allTxns.find(
            txn =>
              txn.type === partnerService.CREDIT_TYPES.REDEEM &&
              txn.partnerId === request.partnerId &&
              txn.externalRef === request.id
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
            const inserted = await dbUnified.insertOne('partner_credit_transactions', finalRedeem);
            if (!inserted) {
              const error = new Error('Failed to persist the final cashout redemption.');
              error.code = 'CASHOUT_REDEEM_WRITE_FAILED';
              throw error;
            }
            updates.finalRedeemTxnId = finalRedeem.id;
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

    logger.info(`Admin ${req.user.id} updated cashout request ${req.params.id}`);
    return res.json({ ok: true, request: { ...request, ...updates } });
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

router.delete('/:id', csrfProtection, async (req, res) => {
  try {
    const request = await dbUnified.findOne('partner_cashout_requests', { id: req.params.id });
    if (!request) return res.status(404).json({ error: 'Cashout request not found' });
    if (!['rejected', 'delivered'].includes(request.status)) {
      return res.status(409).json({
        error: `Cannot delete a cashout request in "${request.status}" state. Only rejected or delivered requests can be deleted.`,
      });
    }
    const deleted = await dbUnified.deleteOne('partner_cashout_requests', { id: req.params.id });
    if (!deleted) return res.status(500).json({ error: 'Failed to delete cashout request' });
    logger.info(`Admin ${req.user.id} deleted cashout request ${req.params.id}`);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('Error deleting cashout request:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;