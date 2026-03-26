/**
 * Admin Partner Routes
 * Admin-only endpoints for managing partner accounts and credit adjustments
 *
 * Base path (mounted in routes/index.js): /api/admin/partners
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

// ─── List Partners ────────────────────────────────────────────────────────────

/**
 * GET /api/admin/partners
 * List all partners with user info and credit totals
 */
router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    const partners = await partnerService.listPartners({ search, status });
    const users = await dbUnified.read('users');

    const enriched = await Promise.all(
      partners.map(async p => {
        // Repair missing id: generate one and persist it so action buttons work
        if (!p.id) {
          const newId = uid('prt');
          await dbUnified.updateOne('partners', { refCode: p.refCode }, { $set: { id: newId, updatedAt: new Date().toISOString() } });
          p = { ...p, id: newId };
          logger.info(`Repaired missing partner id → ${newId} (refCode=${p.refCode})`);
        }
        const user = users.find(u => u.id === p.userId);
        const balance = await partnerService.getBalance(p.id);
        const referrals = await partnerService.listReferralsByPartnerId(p.id);
        return {
          id: p.id,
          userId: p.userId,
          refCode: p.refCode,
          status: p.status,
          createdAt: p.createdAt,
          user: user ? { name: user.name, email: user.email, company: user.company } : null,
          credits: {
            balance: balance.balance,
            totalEarned: balance.totalEarned,
            packageBonusTotal: balance.packageBonusTotal,
            subscriptionBonusTotal: balance.subscriptionBonusTotal,
          },
          referralCount: referrals.length,
          qualifiedCount: referrals.filter(r => r.packageQualified || r.subscriptionQualified)
            .length,
        };
      })
    );

    // Apply name/email search after enrichment (requires user data)
    let list = enriched;
    // Exclude soft-deleted partners and any residual orphans (user deleted without soft-delete cascade)
    list = list.filter(p => p.status !== 'deleted' && p.user !== null);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        p =>
          (p.refCode || '').toLowerCase().includes(s) ||
          (p.user?.name || '').toLowerCase().includes(s) ||
          (p.user?.email || '').toLowerCase().includes(s) ||
          (p.user?.company || '').toLowerCase().includes(s)
      );
    }

    res.json({ items: list });
  } catch (err) {
    logger.error('Error listing partners:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Payout Requests ──────────────────────────────────────────────────────────
// NOTE: These routes MUST be defined before router.get('/:id') so that
// the static path segment "payout-requests" is not consumed by the /:id wildcard.

/**
 * GET /api/admin/partners/payout-requests
 * List all partner payout request tickets, newest first.
 * Optionally filter by status query param.
 */
router.get('/payout-requests', async (req, res) => {
  try {
    const { status } = req.query;
    const allTickets = await dbUnified.read('tickets');
    let payoutTickets = allTickets.filter(t => t.category === 'partner_payout');

    if (status) {
      payoutTickets = payoutTickets.filter(t => t.status === status);
    }

    // Enrich with partner user info
    const users = await dbUnified.read('users');
    const enriched = payoutTickets.map(t => {
      const user = users.find(u => u.id === t.senderId);
      return {
        id: t.id,
        partnerId: t.partnerId,
        partnerRefCode: t.partnerRefCode,
        payoutPoints: t.payoutPoints,
        payoutValueGbp: t.payoutValueGbp,
        payoutGiftCardType: t.payoutGiftCardType,
        status: t.status,
        subject: t.subject,
        message: t.message,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        partnerUser: user ? { name: user.name, email: user.email, company: user.company } : null,
        deletedUser: !user,
      };
    });

    enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ items: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Error listing payout requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/partners/payout-requests/:ticketId/status
 * Update the status of a payout request ticket (open/in_progress/resolved/closed).
 */
router.patch('/payout-requests/:ticketId/status', csrfProtection, async (req, res) => {
  try {
    const { status } = req.body || {};
    const ALLOWED = ['open', 'in_progress', 'resolved', 'closed'];
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(', ')}` });
    }

    const allTickets = await dbUnified.read('tickets');
    const ticket = allTickets.find(
      t => t.id === req.params.ticketId && t.category === 'partner_payout'
    );
    if (!ticket) {
      return res.status(404).json({ error: 'Payout request ticket not found' });
    }

    await dbUnified.updateOne(
      'tickets',
      { id: req.params.ticketId },
      { $set: { status, updatedAt: new Date().toISOString() } }
    );

    logger.info(
      `Admin ${req.user.id} updated payout ticket ${req.params.ticketId} status to ${status}`
    );
    res.json({ ok: true, status });
  } catch (err) {
    logger.error('Error updating payout ticket status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Partner Detail ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/partners/:id
 * Get full detail for a partner including referrals and transactions
 */
router.get('/:id', async (req, res) => {
  try {
    const partner = await partnerService.getPartnerById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    const users = await dbUnified.read('users');
    const user = users.find(u => u.id === partner.userId);
    const balance = await partnerService.getBalance(partner.id);
    const referrals = await partnerService.listReferralsByPartnerId(partner.id);

    // Enrich referrals with user names
    const enrichedReferrals = referrals.map(r => {
      const su = users.find(u => u.id === r.supplierUserId);
      return {
        ...r,
        supplierName: su ? su.name || su.email : 'Unknown',
        supplierEmail: su ? su.email : null,
        supplierCompany: su ? su.company || null : null,
      };
    });

    const baseUrl = process.env.BASE_URL || 'https://eventflow.app';
    const refLink = `${baseUrl}/auth?ref=${partner.refCode}&role=supplier`;

    res.json({
      partner: {
        ...partner,
        refLink,
        user: user ? { name: user.name, email: user.email, company: user.company } : null,
      },
      credits: balance,
      referrals: enrichedReferrals.sort(
        (a, b) => new Date(b.supplierCreatedAt) - new Date(a.supplierCreatedAt)
      ),
    });
  } catch (err) {
    logger.error('Error fetching partner detail:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Enable / Disable Partner ─────────────────────────────────────────────────

/**
 * PATCH /api/admin/partners/:id/status
 * Enable or disable a partner account
 */
router.patch('/:id/status', csrfProtection, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ error: 'status must be "active" or "disabled"' });
    }

    const partner = await partnerService.getPartnerById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    if (partner.status === 'deleted') {
      return res.status(400).json({ error: 'Cannot change status of a deleted partner account' });
    }

    await partnerService.setPartnerStatus(req.params.id, status);
    logger.info(`Admin ${req.user.id} set partner ${req.params.id} status to ${status}`);

    res.json({ ok: true, status });
  } catch (err) {
    logger.error('Error updating partner status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Manual Credit Adjustment ─────────────────────────────────────────────────

/**
 * POST /api/admin/partners/:id/credits
 * Apply a manual credit adjustment (positive or negative) with an audit note
 */
router.post('/:id/credits', csrfProtection, async (req, res) => {
  try {
    const { amount, notes } = req.body || {};
    const parsedAmount = parseInt(amount, 10);

    if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
      return res.status(400).json({ error: 'amount must be a non-zero integer' });
    }
    if (!notes || String(notes).trim().length < 3) {
      return res.status(400).json({ error: 'An audit note is required (minimum 3 characters)' });
    }

    const partner = await partnerService.getPartnerById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    const txn = await partnerService.applyAdminAdjustment({
      partnerId: req.params.id,
      amount: parsedAmount,
      notes: String(notes).trim().slice(0, 500),
      adminUserId: req.user.id,
    });

    logger.info(
      `Admin ${req.user.id} applied credit adjustment ${parsedAmount} to partner ${req.params.id}: ${notes}`
    );

    res.json({ ok: true, transaction: txn });
  } catch (err) {
    logger.error('Error applying credit adjustment:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Cashout Orders (Tremendous) ─────────────────────────────────────────────

/**
 * GET /api/admin/partners/cashout-orders
 * List Tremendous cashout orders (all partners), sorted newest first.
 * Query params: partnerId (filter), status (filter), limit (default 100)
 */
router.get('/cashout-orders', async (req, res) => {
  try {
    const { partnerId, status, limit } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10) || 100, 500);

    let orders = (await dbUnified.read('partner_cashout_orders')) || [];

    if (partnerId) {
      orders = orders.filter(o => o.partnerId === partnerId);
    }
    if (status) {
      orders = orders.filter(o => o.status === status);
    }

    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    orders = orders.slice(0, maxLimit);

    // Enrich with partner user info
    const users = await dbUnified.read('users');
    const enriched = orders.map(o => {
      const user = users.find(u => u.id === o.partnerUserId);
      return {
        ...o,
        partnerUser: user ? { name: user.name, email: user.email } : null,
        deletedUser: !user,
      };
    });

    res.json({ items: enriched, total: enriched.length });
  } catch (err) {
    logger.error('Error listing cashout orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
