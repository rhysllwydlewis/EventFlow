/**
 * Supplier Admin Routes
 * Admin-only supplier management endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const {
  VERIFICATION_STATES,
  normaliseState,
  canTransition,
} = require('../utils/supplierVerificationStateMachine');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
let supplierIsProActive;
let AI_ENABLED;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Supplier Admin routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'csrfProtection',
    'supplierIsProActive',
    'AI_ENABLED',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Supplier Admin routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  supplierIsProActive = deps.supplierIsProActive;
  AI_ENABLED = deps.AI_ENABLED;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

/**
 * GET /api/admin/suppliers
 * List all suppliers with Pro status
 */
router.get('/suppliers', applyAuthRequired, applyRoleRequired('admin'), async (_req, res) => {
  try {
    const raw = await dbUnified.read('suppliers');
    const items = await Promise.all(
      raw.map(async s => ({
        ...s,
        isPro: await supplierIsProActive(s),
        proExpiresAt: s.proExpiresAt || null,
      }))
    );
    res.json({ items });
  } catch (error) {
    logger.error('Error reading suppliers for admin:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/suppliers/pending-verification
 * Get suppliers awaiting verification
 */
router.get(
  '/suppliers/pending-verification',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (_req, res) => {
    try {
      const suppliers = (await dbUnified.read('suppliers')) || [];
      const pending = suppliers.filter(
        s =>
          !s.verified &&
          (!s.verificationStatus ||
            s.verificationStatus === 'pending' ||
            s.verificationStatus === VERIFICATION_STATES.UNVERIFIED ||
            s.verificationStatus === VERIFICATION_STATES.PENDING_REVIEW)
      );

      res.json({
        suppliers: pending.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          location: s.location,
          ownerUserId: s.ownerUserId,
          createdAt: s.createdAt,
          verificationStatus: normaliseState(s.verificationStatus, s.verified),
          submittedAt: s.verificationSubmittedAt || null,
        })),
        count: pending.length,
      });
    } catch (error) {
      logger.error('Error fetching pending verification suppliers:', error);
      res.status(500).json({ suppliers: [], count: 0, error: 'Failed to fetch pending suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/approve
 * Approve a supplier (state machine enforced)
 */
router.post(
  '/suppliers/:id/approve',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Not found' });
      }

      const currentState = normaliseState(s.verificationStatus, s.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.APPROVED, 'admin');
      if (!check.allowed) {
        return res.status(409).json({ error: check.reason });
      }

      const now = new Date().toISOString();
      const updates = {
        approved: true,
        verified: true,
        verificationStatus: VERIFICATION_STATES.APPROVED,
        verifiedAt: now,
        verifiedBy: req.user.id,
        verificationNotes: (req.body && req.body.notes) || s.verificationNotes || '',
        updatedAt: now,
      };

      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: updates });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_APPROVED,
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, notes: updates.verificationNotes },
      });

      res.json({ ok: true, supplier: { ...s, ...updates } });
    } catch (error) {
      logger.error('Error approving supplier:', error);
      res.status(500).json({ error: 'Failed to approve supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/reject
 * Reject a supplier verification (state machine enforced)
 */
router.post(
  '/suppliers/:id/reject',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Not found' });
      }

      const currentState = normaliseState(s.verificationStatus, s.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.REJECTED, 'admin');
      if (!check.allowed) {
        return res.status(409).json({ error: check.reason });
      }

      const reason = (req.body && req.body.reason) || '';
      if (!reason) {
        return res.status(400).json({ error: 'A rejection reason is required' });
      }

      const now = new Date().toISOString();
      const updates = {
        approved: false,
        verified: false,
        verificationStatus: VERIFICATION_STATES.REJECTED,
        verifiedAt: null,
        verifiedBy: null,
        verificationNotes: reason,
        rejectedAt: now,
        rejectedBy: req.user.id,
        updatedAt: now,
      };

      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: updates });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_REJECTED,
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, reason },
      });

      res.json({ ok: true, supplier: { ...s, ...updates } });
    } catch (error) {
      logger.error('Error rejecting supplier:', error);
      res.status(500).json({ error: 'Failed to reject supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/request-changes
 * Request changes from a supplier before approval (state machine enforced)
 * Body: { reason: string }
 */
router.post(
  '/suppliers/:id/request-changes',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Not found' });
      }

      const currentState = normaliseState(s.verificationStatus, s.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.NEEDS_CHANGES, 'admin');
      if (!check.allowed) {
        return res.status(409).json({ error: check.reason });
      }

      const reason = (req.body && req.body.reason) || '';
      if (!reason) {
        return res.status(400).json({ error: 'A reason for requesting changes is required' });
      }

      const now = new Date().toISOString();
      const updates = {
        verificationStatus: VERIFICATION_STATES.NEEDS_CHANGES,
        verified: false,
        verificationNotes: reason,
        changesRequestedAt: now,
        changesRequestedBy: req.user.id,
        updatedAt: now,
      };

      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: updates });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_NEEDS_CHANGES,
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, reason },
      });

      res.json({ ok: true, supplier: { ...s, ...updates } });
    } catch (error) {
      logger.error('Error requesting changes from supplier:', error);
      res.status(500).json({ error: 'Failed to request changes' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/suspend
 * Suspend a previously-approved supplier (state machine enforced)
 * Body: { reason: string }
 */
router.post(
  '/suppliers/:id/suspend',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Not found' });
      }

      const currentState = normaliseState(s.verificationStatus, s.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.SUSPENDED, 'admin');
      if (!check.allowed) {
        return res.status(409).json({ error: check.reason });
      }

      const reason = (req.body && req.body.reason) || '';
      if (!reason) {
        return res.status(400).json({ error: 'A suspension reason is required' });
      }

      const now = new Date().toISOString();
      const updates = {
        verificationStatus: VERIFICATION_STATES.SUSPENDED,
        verified: false,
        approved: false,
        verificationNotes: reason,
        suspendedAt: now,
        suspendedBy: req.user.id,
        updatedAt: now,
      };

      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: updates });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_SUSPENDED,
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, reason },
      });

      res.json({ ok: true, supplier: { ...s, ...updates } });
    } catch (error) {
      logger.error('Error suspending supplier:', error);
      res.status(500).json({ error: 'Failed to suspend supplier' });
    }
  }
);

/**
 * GET /api/admin/suppliers/:id/audit
 * Retrieve verification audit trail for a specific supplier
 */
router.get(
  '/suppliers/:id/audit',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const suppliers = await dbUnified.read('suppliers');
      const s = suppliers.find(sup => sup.id === supplierId);
      if (!s) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Read audit log entries for this supplier
      let auditEntries = [];
      try {
        const allAudit = (await dbUnified.read('audit_logs')) || [];
        auditEntries = allAudit
          .filter(
            entry =>
              (entry.targetId === supplierId ||
                (entry.resource && entry.resource.id === supplierId)) &&
              (entry.targetType === 'supplier' ||
                (entry.resource && entry.resource.type === 'supplier'))
          )
          .sort(
            (a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt)
          );
      } catch (_err) {
        // Audit log collection may not exist yet – return empty list
      }

      res.json({
        supplierId,
        supplierName: s.name,
        currentState: normaliseState(s.verificationStatus, s.verified),
        audit: auditEntries.map(entry => ({
          id: entry._id || entry.id,
          action: entry.action,
          actor: entry.adminEmail || (entry.actor && entry.actor.email) || 'system',
          details: entry.details || {},
          timestamp: entry.timestamp || entry.createdAt,
        })),
      });
    } catch (error) {
      logger.error('Error fetching supplier audit:', error);
      res.status(500).json({ error: 'Failed to fetch audit trail' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/pro
 * Manage Pro status (cancel or set duration)
 */
router.post(
  '/suppliers/:id/pro',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { mode, duration } = req.body || {};
    const all = await dbUnified.read('suppliers');
    const s = all.find(sup => sup.id === req.params.id);
    if (!s) {
      return res.status(404).json({ error: 'Not found' });
    }

    const now = Date.now();
    const proUpdates = {};

    if (mode === 'cancel') {
      proUpdates.isPro = false;
      proUpdates.proExpiresAt = null;
    } else if (mode === 'duration') {
      let ms = 0;
      switch (duration) {
        case '1d':
          ms = 1 * 24 * 60 * 60 * 1000;
          break;
        case '7d':
          ms = 7 * 24 * 60 * 60 * 1000;
          break;
        case '1m':
          ms = 30 * 24 * 60 * 60 * 1000;
          break;
        case '1y':
          ms = 365 * 24 * 60 * 60 * 1000;
          break;
        default:
          return res.status(400).json({ error: 'Invalid duration' });
      }
      proUpdates.isPro = true;
      proUpdates.proExpiresAt = new Date(now + ms).toISOString();
    } else {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    // Optionally mirror Pro flag to the owning user, if present.
    try {
      if (s.ownerUserId) {
        await dbUnified.updateOne(
          'users',
          { id: s.ownerUserId },
          { $set: { isPro: !!proUpdates.isPro } }
        );
      }
    } catch (_e) {
      // ignore errors from user store
    }

    await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: proUpdates });
    const updatedSupplier = { ...s, ...proUpdates };

    const active = await supplierIsProActive(updatedSupplier);
    res.json({
      ok: true,
      supplier: {
        ...updatedSupplier,
        isPro: active,
        proExpiresAt: updatedSupplier.proExpiresAt || null,
      },
    });
  }
);

/**
 * PUT /api/admin/suppliers/:id
 * Update supplier details (admin only)
 */
router.put(
  '/suppliers/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === id);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const now = new Date().toISOString();
    const supplierUpdates = {};

    // Update allowed fields
    const fields = [
      'name',
      'category',
      'location',
      'price_display',
      'website',
      'email',
      'phone',
      'maxGuests',
      'description_short',
      'description_long',
      'blurb',
      'amenities',
      'tags',
    ];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        supplierUpdates[field] = req.body[field];
      }
    }
    if (typeof req.body.approved === 'boolean') {
      supplierUpdates.approved = req.body.approved;
    }
    if (typeof req.body.verified === 'boolean') {
      supplierUpdates.verified = req.body.verified;
    }

    supplierUpdates.updatedAt = now;

    await dbUnified.updateOne('suppliers', { id }, { $set: supplierUpdates });

    res.json({ ok: true, supplier: { ...supplier, ...supplierUpdates } });
  }
);

/**
 * POST /api/admin/suppliers/:supplierId/badges/:badgeId
 * Award a badge to a supplier
 */
router.post(
  '/suppliers/:supplierId/badges/:badgeId',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId, badgeId } = req.params;

      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === supplierId);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const badges = supplier.badges || [];
      if (!badges.includes(badgeId)) {
        badges.push(badgeId);
        await dbUnified.updateOne('suppliers', { id: supplierId }, { $set: { badges } });
      }

      res.json({ success: true, supplier: { ...supplier, badges } });
    } catch (error) {
      logger.error('Error awarding badge:', error);
      res.status(500).json({ error: 'Failed to award badge' });
    }
  }
);

/**
 * DELETE /api/admin/suppliers/:supplierId/badges/:badgeId
 * Remove a badge from a supplier
 */
router.delete(
  '/suppliers/:supplierId/badges/:badgeId',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId, badgeId } = req.params;

      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === supplierId);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const badges = (supplier.badges || []).filter(b => b !== badgeId);
      await dbUnified.updateOne('suppliers', { id: supplierId }, { $set: { badges } });

      res.json({ success: true, supplier: { ...supplier, badges } });
    } catch (error) {
      logger.error('Error removing badge:', error);
      res.status(500).json({ error: 'Failed to remove badge' });
    }
  }
);

/**
 * POST /api/admin/suppliers/smart-tags
 * Auto-categorization and scoring for all suppliers
 */
router.post(
  '/suppliers/smart-tags',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const all = await dbUnified.read('suppliers');
    const now = new Date().toISOString();
    const updated = [];

    all.forEach(s => {
      const tags = [];
      if (s.category) {
        tags.push(s.category);
      }
      if (Array.isArray(s.amenities)) {
        s.amenities.slice(0, 3).forEach(a => tags.push(a));
      }
      if (s.location) {
        tags.push(s.location.split(',')[0].trim());
      }

      let score = 40;
      if (Array.isArray(s.photos) && s.photos.length) {
        score += 20;
      }
      if ((s.description_short || '').length > 40) {
        score += 15;
      }
      if ((s.description_long || '').length > 80) {
        score += 15;
      }
      if (Array.isArray(s.amenities) && s.amenities.length >= 3) {
        score += 10;
      }
      if (score > 100) {
        score = 100;
      }

      s.aiTags = tags;
      s.aiScore = score;
      s.aiUpdatedAt = now;
      updated.push({ id: s.id, aiTags: tags, aiScore: score });
    });

    await Promise.all(
      all.map(s =>
        dbUnified.updateOne(
          'suppliers',
          { id: s.id },
          {
            $set: { aiTags: s.aiTags, aiScore: s.aiScore, aiUpdatedAt: now },
          }
        )
      )
    );
    res.json({ ok: true, items: updated, aiEnabled: AI_ENABLED });
  }
);

/**
 * POST /api/admin/badges/evaluate
 * Evaluate and award badges to all suppliers
 */
router.post(
  '/badges/evaluate',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const badgeManagement = require('../utils/badgeManagement');
      const results = await badgeManagement.evaluateAllSupplierBadges();
      res.json({
        success: true,
        message: 'Badge evaluation completed',
        results,
      });
    } catch (error) {
      logger.error('Error evaluating badges:', error);
      res.status(500).json({ error: 'Failed to evaluate badges' });
    }
  }
);

/**
 * POST /api/admin/badges/init
 * Initialize default badges in the database
 */
router.post(
  '/badges/init',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const badgeManagement = require('../utils/badgeManagement');
      await badgeManagement.initializeDefaultBadges();
      res.json({
        success: true,
        message: 'Default badges initialized',
      });
    } catch (error) {
      logger.error('Error initializing badges:', error);
      res.status(500).json({ error: 'Failed to initialize badges' });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
