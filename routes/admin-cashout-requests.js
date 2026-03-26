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
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
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
      };
    });

    res.json({ items: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Error listing cashout requests:', err);
    res.status(500).json({ error: 'Internal server error' });
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

    const users = await dbUnified.read('users');
    const partners = await dbUnified.read('partners');
    const partner = partners.find(p => p.id === request.partnerId);
    const user = users.find(u => u.id === request.partnerUserId);

    // Also retrieve hold and redeem transaction details for audit
    const txns = (await dbUnified.read('partner_credit_transactions')) || [];
    const holdTxn = request.holdTxnId ? txns.find(t => t.id === request.holdTxnId) : null;
    const redeemTxn = request.finalRedeemTxnId
      ? txns.find(t => t.id === request.finalRedeemTxnId)
      : null;

    res.json({
      request: {
        ...request,
        partnerRefCode: partner ? partner.refCode : null,
        partnerUser: user ? { name: user.name, email: user.email, company: user.company } : null,
      },
      holdTransaction: holdTxn || null,
      redeemTransaction: redeemTxn || null,
    });
  } catch (err) {
    logger.error('Error fetching cashout request:', err);
    res.status(500).json({ error: 'Internal server error' });
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
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const allowed = VALID_TRANSITIONS[request.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Cannot transition from '${request.status}' to '${status}'. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal state)'}`,
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
        if (deliveryDetails) {
          updates.deliveryDetails = deliveryDetails;
        }
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
        // Finalise the cashout: release the hold first, then insert a permanent REDEEM.
        // Net effect on available balance: hold release (+N) then redeem (-N) = 0 net change
        // from the held state, which is correct — points were already "reserved".
        if (request.holdTxnId) {
          await partnerService.releaseCashoutHold(request.holdTxnId, request.partnerId);
        }
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
        await dbUnified.insertOne('partner_credit_transactions', finalRedeem);

        updates.finalRedeemTxnId = finalRedeem.id;
        logger.info(
          `Cashout delivered: ${request.id} — finalRedeemTxn=${finalRedeem.id}`
        );
      }
    }

    if (adminResponseMessage !== undefined) {
      updates.adminResponseMessage = String(adminResponseMessage).trim().slice(0, 2000) || null;
    }
    if (adminInternalNotes !== undefined) {
      updates.adminInternalNotes = String(adminInternalNotes).trim().slice(0, 2000) || null;
    }

    await dbUnified.updateOne(
      'partner_cashout_requests',
      { id: req.params.id },
      { $set: updates }
    );

    logger.info(
      `Admin ${req.user.id} updated cashout request ${req.params.id}: ${JSON.stringify(updates)}`
    );

    const updated = { ...request, ...updates };
    res.json({ ok: true, request: updated });
  } catch (err) {
    logger.error('Error updating cashout request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
