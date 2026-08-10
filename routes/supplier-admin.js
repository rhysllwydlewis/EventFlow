/**
 * Supplier Admin Routes
 * Admin-only supplier management endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const postmark = require('../utils/postmark');
const {
  VERIFICATION_STATES,
  normaliseState,
  canTransition,
} = require('../utils/supplierVerificationStateMachine');
const catalogCache = require('../services/catalogCache');
const { sanitiseText } = require('../utils/sanitise');
const {
  buildSupplierProGrantUpdate,
  buildSupplierProRevokeUpdate,
} = require('../utils/supplierProGrant');
const router = express.Router();
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
 * Send a verification status notification email to the supplier.
 * Errors are caught and logged — they must never break the API response.
 *
 * @param {{ email: string, name: string }} supplier
 * @param {'approved'|'rejected'|'needs_changes'|'suspended'} action
 * @param {string} [notes] - Optional reason / notes for the supplier
 */
async function sendVerificationEmail(supplier, action, notes) {
  if (!supplier.email) {
    return;
  }

  const BASE_URL = process.env.BASE_URL || process.env.APP_BASE_URL || 'https://event-flow.co.uk';
  const supplierName = supplier.name || 'Supplier';
  const dashboardUrl = `${BASE_URL}/dashboard-supplier`;
  const supportEmail = 'support@event-flow.co.uk';

  // Per-status configuration for the supplier-verification-status.html template
  const statusConfig = {
    approved: {
      subject: 'Your EventFlow supplier profile has been approved',
      statusTitle: 'Your profile has been approved',
      statusMessage:
        'Great news — your supplier profile has been reviewed and approved. ' +
        'You can now appear in search results, receive enquiries, and accept bookings on EventFlow.',
      headerGradient: 'linear-gradient(135deg,#065F46 0%,#059669 100%)',
      ctaGradient: 'linear-gradient(135deg,#059669,#10B981)',
      ctaText: 'Go to Your Dashboard',
    },
    rejected: {
      subject: 'Your EventFlow supplier application — update required',
      statusTitle: 'Your application could not be approved at this time',
      statusMessage:
        'Thank you for applying to join EventFlow. Unfortunately, after review, we’re unable to approve your profile in its current form. ' +
        'You may update your profile and resubmit for review at any time.',
      headerGradient: 'linear-gradient(135deg,#7C3AED 0%,#8B5CF6 100%)',
      ctaGradient: 'linear-gradient(135deg,#7C3AED,#8B5CF6)',
      ctaText: 'Update Your Profile',
    },
    needs_changes: {
      subject: 'Action required: your EventFlow supplier profile needs changes',
      statusTitle: 'A few changes are needed before approval',
      statusMessage:
        'We have reviewed your supplier profile and need some updates before we can approve it. ' +
        'Please log in, make the changes noted below, and resubmit for review.',
      headerGradient: 'linear-gradient(135deg,#B45309 0%,#D97706 100%)',
      ctaGradient: 'linear-gradient(135deg,#D97706,#F59E0B)',
      ctaText: 'Update Your Profile',
    },
    suspended: {
      subject: 'Your EventFlow supplier account has been suspended',
      statusTitle: 'Your supplier account has been suspended',
      statusMessage:
        'Your EventFlow supplier account has been temporarily suspended and is not currently visible to customers. ' +
        'If you believe this is in error, please contact our support team.',
      headerGradient: 'linear-gradient(135deg,#DC2626 0%,#EF4444 100%)',
      ctaGradient: 'linear-gradient(135deg,#DC2626,#EF4444)',
      ctaText: 'Contact Support',
    },
  };

  const config = statusConfig[action];
  if (!config) {
    return;
  }

  // Build optional notes section safely — notes are plain text escaped by postmark.js
  // notesSection is listed as an allowed HTML key so we construct safe markup here
  let notesSection = '';
  if (notes && typeof notes === 'string' && notes.trim()) {
    // Escape the notes text before embedding in HTML
    const escapeHtml = t =>
      t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const escapedNotes = escapeHtml(notes.trim());
    notesSection = `<table class="notes-box" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;border:1px solid #E5E7EB;border-radius:10px;background-color:#F9FAFB;">
      <tr>
        <td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.06em;">Note from our team</p>
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.65;white-space:pre-wrap;">${escapedNotes}</p>
        </td>
      </tr>
    </table>`;
  }

  try {
    await postmark.sendMail({
      to: supplier.email,
      from: postmark.FROM_HELLO,
      subject: config.subject,
      template: 'supplier-verification-status',
      templateData: {
        name: supplierName,
        statusTitle: config.statusTitle,
        statusMessage: config.statusMessage,
        headerGradient: config.headerGradient,
        ctaGradient: config.ctaGradient,
        ctaText: config.ctaText,
        notesSection,
        dashboardUrl,
        supportEmail,
      },
      tags: ['supplier-verification', action, 'transactional'],
      messageStream: 'outbound',
    });
  } catch (emailErr) {
    logger.warn('Failed to send verification status email to supplier:', {
      supplierId: supplier.id,
      action,
      error: emailErr.message,
    });
  }
}
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
  writeLimiter,
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
        verificationNotes: sanitiseText((req.body && req.body.notes) || s.verificationNotes || ''),
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

      // Non-blocking email notification to supplier
      sendVerificationEmail(s, 'approved', updates.verificationNotes).catch(emailErr => {
        logger.warn('Verification email delivery failed', { error: emailErr.message });
      });

      // Bust catalog cache so JadeAssist sees the updated approval state immediately
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

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
  writeLimiter,
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

      const rejectionNotes = sanitiseText((req.body && (req.body.notes || req.body.reason)) || '');
      if (!rejectionNotes) {
        return res.status(400).json({ error: 'A rejection reason is required' });
      }

      const now = new Date().toISOString();
      const newRejectionCount = (s.verificationRejectionCount || 0) + 1;
      const updates = {
        approved: false,
        verified: false,
        verificationStatus: VERIFICATION_STATES.REJECTED,
        verifiedAt: null,
        verifiedBy: null,
        verificationNotes: rejectionNotes,
        rejectedAt: now,
        rejectedBy: req.user.id,
        verificationRejectionCount: newRejectionCount,
        updatedAt: now,
      };

      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: updates });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_REJECTED,
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, reason: rejectionNotes },
      });

      // Non-blocking email notification to supplier
      sendVerificationEmail(s, 'rejected', rejectionNotes).catch(emailErr => {
        logger.warn('Verification email delivery failed', { error: emailErr.message });
      });

      // Bust catalog cache — rejected supplier must no longer appear
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

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
  writeLimiter,
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

      const reason = sanitiseText((req.body && req.body.reason) || '');
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

      // Non-blocking email notification to supplier
      sendVerificationEmail(s, 'needs_changes', reason).catch(emailErr => {
        logger.warn('Verification email delivery failed', { error: emailErr.message });
      });

      // Bust catalog cache — status changed, keep listing fresh
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

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
  writeLimiter,
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

      const reason = sanitiseText((req.body && req.body.reason) || '');
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

      // Non-blocking email notification to supplier
      sendVerificationEmail(s, 'suspended', reason).catch(emailErr => {
        logger.warn('Verification email delivery failed', { error: emailErr.message });
      });

      // Bust catalog cache — suspended supplier must not appear in results
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

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
  apiLimiter,
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
 * Manage Pro status (cancel or set duration). Writes the same complete
 * field set as routes/admin.js's identical endpoint and
 * routes/admin-user-management.js's /suppliers/:id/subscription — see
 * utils/supplierProGrant.js for why that consistency matters.
 */
router.post(
  '/suppliers/:id/pro',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { mode, duration, tier } = req.body || {};
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Not found' });
      }

      const now = Date.now();
      let proUpdates;

      if (mode === 'cancel') {
        proUpdates = buildSupplierProRevokeUpdate({ revokedBy: req.user.id });
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
        proUpdates = buildSupplierProGrantUpdate({
          tier: tier === 'pro_plus' ? 'pro_plus' : 'pro',
          expiresAt: new Date(now + ms).toISOString(),
          grantedBy: req.user.id,
        });
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

      // Bust catalog cache — Pro status affects sort order in listings
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

      const active = await supplierIsProActive(updatedSupplier);
      res.json({
        ok: true,
        supplier: {
          ...updatedSupplier,
          isPro: active,
          proExpiresAt: updatedSupplier.proExpiresAt || null,
        },
      });
    } catch (error) {
      logger.error('Error updating supplier Pro status', {
        error: error.message,
        id: req.params.id,
      });
      res.status(500).json({ error: 'Failed to update supplier Pro status' });
    }
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
    try {
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
      // Verified and approved are managed by the verification state machine endpoints
      // (approve, reject, request-changes, suspend). Reject any attempt to set them directly.
      if ('verified' in req.body || 'approved' in req.body) {
        return res.status(400).json({
          error:
            'verified and approved cannot be set directly. Use the /approve, /reject, /request-changes, or /suspend endpoints.',
        });
      }

      supplierUpdates.updatedAt = now;

      await dbUnified.updateOne('suppliers', { id }, { $set: supplierUpdates });

      // Bust catalog cache — profile data changed
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

      res.json({ ok: true, supplier: { ...supplier, ...supplierUpdates } });
    } catch (error) {
      logger.error('Error updating supplier:', { error: error.message, id: req.params.id });
      res.status(500).json({ error: error.message || 'Failed to update supplier' });
    }
  }
);

/**
 * PUT /api/admin/suppliers/:id/completed-events
 * Set the completedEvents count for a supplier (required for Expert badge)
 * Body: { count: number }
 */
router.put(
  '/suppliers/:id/completed-events',
  writeLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const count = parseInt(req.body.count, 10);
      if (isNaN(count) || count < 0) {
        return res.status(400).json({ error: 'Invalid count' });
      }

      const all = await dbUnified.read('suppliers');
      const supplier = all.find(s => s.id === req.params.id);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      await dbUnified.updateOne(
        'suppliers',
        { id: req.params.id },
        { $set: { completedEvents: count, updatedAt: new Date().toISOString() } }
      );

      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
        targetType: 'supplier',
        targetId: req.params.id,
        details: { field: 'completedEvents', value: count },
      });

      res.json({ success: true, completedEvents: count });
    } catch (error) {
      logger.error('Error updating completedEvents:', error);
      res.status(500).json({ error: 'Failed to update' });
    }
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
      if (Array.isArray(s.photosGallery) && s.photosGallery.length) {
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
      const results = await badgeManagement.evaluateAllSupplierBadges({ trigger: 'manual' });
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

/**
 * PUT /api/admin/suppliers/:id/calendar-override
 * Set or clear the public-calendar publisher override for a supplier.
 *
 * Body: { override: true | false | null }
 *   true  → supplier can publish regardless of category
 *   false → supplier cannot publish regardless of category
 *   null  → derive from category (default behaviour)
 */
router.put(
  '/suppliers/:id/calendar-override',
  writeLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const s = all.find(sup => sup.id === req.params.id);
      if (!s) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const { override } = req.body;
      if (override !== true && override !== false && override !== null) {
        return res.status(400).json({
          error: 'override must be true, false, or null',
        });
      }

      const now = new Date().toISOString();
      await dbUnified.updateOne(
        'suppliers',
        { id: req.params.id },
        { $set: { publicCalendarPublisherOverride: override, updatedAt: now } }
      );

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'SUPPLIER_CALENDAR_OVERRIDE_UPDATED',
        targetType: 'supplier',
        targetId: s.id,
        details: { name: s.name, override },
      });

      res.json({
        ok: true,
        supplierId: s.id,
        publicCalendarPublisherOverride: override,
      });
    } catch (error) {
      logger.error('Error updating calendar override:', error);
      res.status(500).json({ error: 'Failed to update calendar override' });
    }
  }
);

/**
 * GET /api/admin/suppliers/directory-health
 * Diagnostic endpoint: surfaces why supplier-role users may not appear in the public
 * supplier directory (which requires approved=true on the supplier profile record).
 *
 * Returns four groups:
 *   - noProfile      : users with role=supplier that have no supplier profile at all
 *   - notApproved    : supplier profiles that exist but are not yet approved
 *   - orphaned       : supplier profiles that have no ownerUserId (so cannot be linked to a user)
 *   - missingName    : supplier profiles that have neither `name` nor `businessName`
 *
 * Each entry includes a human-readable `excludedReason` field to aid triage.
 */
router.get(
  '/suppliers/directory-health',
  applyAuthRequired,
  applyRoleRequired('admin'),
  apiLimiter,
  async (_req, res) => {
    try {
      const [allUsers, allSuppliers] = await Promise.all([
        dbUnified.read('users'),
        dbUnified.read('suppliers'),
      ]);

      const supplierUsers = (allUsers || []).filter(u => u.role === 'supplier');
      const supplierProfiles = allSuppliers || [];

      // Index profiles by ownerUserId for O(1) lookup
      const profilesByOwner = new Map();
      for (const s of supplierProfiles) {
        if (s.ownerUserId) {
          if (!profilesByOwner.has(s.ownerUserId)) {
            profilesByOwner.set(s.ownerUserId, []);
          }
          profilesByOwner.get(s.ownerUserId).push(s);
        }
      }

      // Group 1: supplier-role users with no profile at all
      const noProfile = supplierUsers
        .filter(u => !profilesByOwner.has(u.id))
        .map(u => ({
          userId: u.id,
          email: u.email,
          excludedReason: 'No supplier profile record found for this user',
        }));

      // Group 2: profiles that exist but are not approved
      const notApproved = supplierProfiles
        .filter(s => s.ownerUserId && s.approved !== true)
        .map(s => ({
          supplierId: s.id,
          ownerUserId: s.ownerUserId,
          name: s.name,
          verificationStatus: s.verificationStatus || 'unverified',
          verified: s.verified || false,
          approved: s.approved || false,
          excludedReason: `approved=${s.approved ?? 'undefined'} — profile must have approved=true to appear in directory`,
        }));

      // Group 3: profiles with no ownerUserId (orphaned)
      const orphaned = supplierProfiles
        .filter(s => !s.ownerUserId)
        .map(s => ({
          supplierId: s.id,
          name: s.name || s.businessName,
          createdAt: s.createdAt,
          excludedReason:
            'ownerUserId is missing — profile is orphaned and cannot be linked to a user account',
        }));

      // Group 4: profiles with neither name nor businessName (will be invisible in search)
      const missingName = supplierProfiles
        .filter(s => !s.name && !s.businessName)
        .map(s => ({
          supplierId: s.id,
          ownerUserId: s.ownerUserId || null,
          createdAt: s.createdAt,
          excludedReason:
            'Neither `name` nor `businessName` is set — supplier will have no visible title in search results',
        }));

      res.json({
        ok: true,
        summary: {
          supplierUsers: supplierUsers.length,
          supplierProfiles: supplierProfiles.length,
          noProfile: noProfile.length,
          notApproved: notApproved.length,
          orphaned: orphaned.length,
          missingName: missingName.length,
        },
        noProfile,
        notApproved,
        orphaned,
        missingName,
      });
    } catch (error) {
      logger.error('Error generating supplier directory health report:', error);
      res.status(500).json({ error: 'Failed to generate directory health report' });
    }
  }
);

/**
 * GET /api/admin/suppliers/:id/visibility-diagnostics
 * Admin-only diagnostic endpoint: returns a structured JSON explanation of
 * why a specific supplier is or isn't publicly visible in the directory/search.
 *
 * Checks:
 *   - approved flag
 *   - verificationStatus
 *   - status / published
 *   - ownerUserId present
 *   - required listing fields (name / businessName, category, location)
 *   - duplicate ownerUserId (more than one profile for the same user)
 *   - search filter compliance (approved AND status=published)
 *
 * Non-destructive read-only endpoint.
 */
router.get(
  '/suppliers/:id/visibility-diagnostics',
  apiLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const allSuppliers = await dbUnified.read('suppliers');

      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // ── Visibility checks ───────────────────────────────────────────────
      const checks = {};
      const exclusionReasons = [];
      const inclusions = [];

      // 1. approved flag
      checks.approved = supplier.approved === true;
      if (!checks.approved) {
        exclusionReasons.push(
          `approved=${supplier.approved ?? 'undefined'} — must be true to appear in public directory`
        );
      } else {
        inclusions.push('approved=true ✓');
      }

      // 2. verificationStatus
      checks.verificationStatus = supplier.verificationStatus || 'unverified';
      const blockedStatuses = ['rejected', 'suspended', 'blocked'];
      if (blockedStatuses.includes(checks.verificationStatus)) {
        exclusionReasons.push(
          `verificationStatus="${checks.verificationStatus}" — suppliers with this status are excluded from public listings`
        );
      }

      // 3. status / published (supplier.service.js requires status==='published')
      checks.status = supplier.status || 'draft';
      if (checks.status !== 'published') {
        exclusionReasons.push(
          `status="${checks.status}" — supplier.service.js public search requires status==="published" (searchService.js does not apply this filter)`
        );
      } else {
        inclusions.push('status=published ✓');
      }

      // 4. ownerUserId present
      checks.hasOwnerUserId = Boolean(supplier.ownerUserId);
      if (!checks.hasOwnerUserId) {
        exclusionReasons.push(
          'ownerUserId is missing — orphaned profile cannot be linked to a user account'
        );
      } else {
        inclusions.push('ownerUserId present ✓');
      }

      // 5. Required listing fields
      const hasName = Boolean(supplier.name || supplier.businessName);
      checks.hasName = hasName;
      if (!hasName) {
        exclusionReasons.push(
          'Neither name nor businessName is set — supplier will appear untitled in search results'
        );
      } else {
        inclusions.push(`name="${supplier.name || supplier.businessName}" ✓`);
      }

      checks.hasCategory = Boolean(supplier.category);
      if (!checks.hasCategory) {
        exclusionReasons.push(
          'category is missing — search filters will not return this supplier for category queries'
        );
      }

      checks.hasLocation = Boolean(supplier.location);
      if (!checks.hasLocation) {
        exclusionReasons.push(
          'location is missing — distance/location-based search will not surface this supplier'
        );
      }

      // 6. Duplicate ownerUserId check
      const duplicates = supplier.ownerUserId
        ? allSuppliers.filter(s => s.ownerUserId === supplier.ownerUserId && s.id !== supplierId)
        : [];
      checks.duplicateOwnerUserId = duplicates.length > 0;
      if (checks.duplicateOwnerUserId) {
        exclusionReasons.push(
          `ownerUserId "${supplier.ownerUserId}" has ${duplicates.length} other profile(s): ${duplicates.map(d => d.id).join(', ')} — duplicate profiles can cause inconsistent search results`
        );
      }

      // 7. Overall public visibility verdict
      // searchService.js filters: s.approved === true
      // supplier.service.js filters: s.approved === true && s.status === 'published'
      checks.visibleInSearchService = checks.approved;
      checks.visibleInSupplierService = checks.approved && checks.status === 'published';

      // Tri-state verdict: VISIBLE / PARTIALLY_VISIBLE / EXCLUDED
      //   VISIBLE           — passes all checks (shown by both services)
      //   PARTIALLY_VISIBLE — approved but status≠published; visible in searchService.js but
      //                       not in supplier.service.js public search
      //   EXCLUDED          — not approved (invisible to both services)
      let verdict;
      if (checks.visibleInSearchService && checks.visibleInSupplierService) {
        verdict = 'VISIBLE';
      } else if (checks.visibleInSearchService && !checks.visibleInSupplierService) {
        verdict = 'PARTIALLY_VISIBLE';
      } else {
        verdict = 'EXCLUDED';
      }

      res.json({
        ok: true,
        supplierId,
        supplierName: supplier.name || supplier.businessName || null,
        verdict,
        visibilityRules: {
          searchServiceJs: checks.visibleInSearchService
            ? 'INCLUDED (approved=true)'
            : 'EXCLUDED (approved must be true)',
          supplierServiceJs: checks.visibleInSupplierService
            ? 'INCLUDED (approved=true AND status=published)'
            : 'EXCLUDED (requires approved=true AND status=published)',
        },
        checks,
        exclusionReasons,
        inclusions,
        rawFields: {
          approved: supplier.approved,
          verificationStatus: supplier.verificationStatus,
          status: supplier.status,
          ownerUserId: supplier.ownerUserId,
          name: supplier.name,
          businessName: supplier.businessName,
          category: supplier.category,
          location: supplier.location,
        },
      });
    } catch (error) {
      logger.error('Error generating supplier visibility diagnostics:', error);
      res.status(500).json({ error: 'Failed to generate visibility diagnostics' });
    }
  }
);

// ── Action Prompt admin endpoints ─────────────────────────────────────────

// Lazy-load so we don't create a circular dep at module initialisation time
function getActionPromptService() {
  return require('../services/actionPromptService');
}

/**
 * GET /api/admin/suppliers/:id/action-prompts/diagnostics
 * Returns a plain-English diagnostics snapshot for the admin: global settings,
 * user prefs, current outstanding actions, cadence state, and optional warnings.
 */
router.get(
  '/suppliers/:id/action-prompts/diagnostics',
  apiLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const [allSuppliers, allUsers, allPackages, settings] = await Promise.all([
        dbUnified.read('suppliers'),
        dbUnified.read('users'),
        dbUnified.read('packages'),
        dbUnified.read('settings'),
      ]);

      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const user = allUsers.find(u => u.id === supplier.ownerUserId);
      const actionPromptSettings = settings?.emailAutomation?.actionPrompts || {};
      const {
        computeFullReport,
        evaluateCadence,
        missingProfileFields: computeMissingProfileFields,
      } = getActionPromptService();

      // Global state
      const globalEnabled = actionPromptSettings.enabled === true;
      const promptTypes = actionPromptSettings.promptTypes || {};
      const globalToggles = {
        missingPackages: promptTypes.missingPackages !== false,
        incompleteProfile: promptTypes.incompleteProfile !== false,
        missingPhotos: promptTypes.missingPhotos !== false,
      };

      // User state
      const userVerified = user ? user.verified === true : false;
      const userEmailPrefs = user?.emailPrefs?.actionPrompts || {};
      const userPrefsEnabled = userEmailPrefs.enabled !== false;
      const userPerTypePrefs = {
        missingPackages: userEmailPrefs.missingPackages !== false,
        incompleteProfile: userEmailPrefs.incompleteProfile !== false,
        missingPhotos: userEmailPrefs.missingPhotos !== false,
      };

      // Outstanding actions — always compute using a synthetic all-prefs-enabled user when
      // no real user is linked, so the admin can see what the supplier's state looks like
      // even if the user account is missing. actionsBasedOnSyntheticUser flag distinguishes this.
      const reportUser = user || {
        emailPrefs: {
          actionPrompts: {
            enabled: true,
            missingPackages: true,
            incompleteProfile: true,
            missingPhotos: true,
          },
        },
      };
      const report = computeFullReport(supplier, allPackages, settings || {}, reportUser);
      const outstandingActions = report.outstanding;
      const completedActions = report.completed;
      const ragStatus = report.ragStatus;
      const completionPercent = report.completionPercent;
      const actionsBasedOnSyntheticUser = !user;

      // Cadence state
      const cadenceState = user?.actionPromptState || null;
      let cadenceEval = null;
      if (outstandingActions.length > 0) {
        cadenceEval = evaluateCadence(cadenceState, new Date());
      }

      // Warnings
      const warnings = [];
      const unsubscribeSecret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || null;
      if (!unsubscribeSecret && process.env.NODE_ENV === 'production') {
        warnings.push(
          'UNSUBSCRIBE_SECRET (or JWT_SECRET) is not set — unsubscribe links are disabled in production. Emails will not include an unsubscribe link.'
        );
      }
      if (!globalEnabled) {
        warnings.push('Global action-prompt emails are disabled. No reminders will be sent.');
      }
      if (!userVerified) {
        warnings.push('Supplier user email is not verified. They are excluded from all sends.');
      }
      if (user && !userPrefsEnabled) {
        warnings.push('This supplier has disabled action-prompt reminders in their settings.');
      }

      // Profile completeness detail
      const missingProfileFields = computeMissingProfileFields(supplier);

      // Last run info (global)
      const lastRun = actionPromptSettings.lastRun || null;

      // Debug summary text (for "Copy debug summary" button)
      const debugLines = [
        `=== Action Prompt Diagnostics: ${supplier.name || supplierId} ===`,
        `Generated: ${new Date().toISOString()}`,
        '',
        `Global enabled: ${globalEnabled}`,
        `Global prompt-type toggles: missingPackages=${globalToggles.missingPackages}, incompleteProfile=${globalToggles.incompleteProfile}, missingPhotos=${globalToggles.missingPhotos}`,
        '',
        `Supplier: ${supplier.name || 'N/A'} (${supplierId})`,
        `Owner user: ${user ? `${user.email} (${user.id})` : 'NO USER LINKED'}`,
        `User verified: ${userVerified}`,
        `User prefs enabled: ${userPrefsEnabled}`,
        `User per-type prefs: missingPackages=${userPerTypePrefs.missingPackages}, incompleteProfile=${userPerTypePrefs.incompleteProfile}, missingPhotos=${userPerTypePrefs.missingPhotos}`,
        '',
        `Outstanding actions (${outstandingActions.length}): ${outstandingActions.map(a => a.key).join(', ') || 'none'}`,
        `Completed actions (${completedActions.length}): ${completedActions.map(a => a.key).join(', ') || 'none'}`,
        `RAG status: ${ragStatus} (${completionPercent}% complete)`,
        missingProfileFields.length > 0
          ? `Missing profile fields: ${missingProfileFields.join(', ')}`
          : 'Profile fields: all present',
        '',
        `Cadence state: ${cadenceState ? `stage=${cadenceState.cadence}, dailySends=${cadenceState.sendCountDaily ?? 0}, weeklySends=${cadenceState.sendCountWeekly ?? 0}, monthlySends=${cadenceState.sendCountMonthly ?? 0}` : 'none (not yet initialised)'}`,
        cadenceState?.lastSentAt
          ? `Last sent at: ${cadenceState.lastSentAt}`
          : 'Last sent at: never',
        cadenceState?.nextSendAt ? `Next send at: ${cadenceState.nextSendAt}` : '',
        cadenceState?.firstOutstandingAt
          ? `First outstanding at: ${cadenceState.firstOutstandingAt}`
          : '',
        cadenceEval ? `Would send now: ${cadenceEval.shouldSend}` : '',
        '',
        lastRun
          ? `Last global run: ${lastRun.finishedAt} — scanned=${lastRun.scanned}, sent=${lastRun.sent}, errors=${lastRun.errors}`
          : 'Last global run: no run recorded yet',
        warnings.length > 0 ? `\nWarnings:\n  - ${warnings.join('\n  - ')}` : '',
      ]
        .filter(l => l !== undefined)
        .join('\n');

      res.json({
        ok: true,
        supplierId,
        supplierName: supplier.name || null,
        global: {
          enabled: globalEnabled,
          promptTypes: globalToggles,
        },
        user: user
          ? {
              id: user.id,
              email: user.email,
              verified: userVerified,
              emailPrefsEnabled: userPrefsEnabled,
              emailPrefsPerType: userPerTypePrefs,
            }
          : null,
        actions: {
          outstanding: outstandingActions,
          completed: completedActions,
          ragStatus,
          completionPercent,
          missingProfileFields,
          basedOnSyntheticUser: actionsBasedOnSyntheticUser,
        },
        cadence: {
          state: cadenceState,
          wouldSendNow: cadenceEval ? cadenceEval.shouldSend : false,
        },
        lastRun,
        warnings,
        debugSummary: debugLines,
      });
    } catch (error) {
      logger.error('Error generating action-prompt diagnostics:', error);
      res.status(500).json({ error: 'Failed to generate action-prompt diagnostics' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/action-prompts/reset-cadence
 * Clears the actionPromptState for the supplier's user account.
 * After this, the cadence restarts from the beginning (daily stage) the next time
 * they have outstanding actions.
 */
router.post(
  '/suppliers/:id/action-prompts/reset-cadence',
  writeLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const allSuppliers = await dbUnified.read('suppliers');
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const allUsers = await dbUnified.read('users');
      const user = allUsers.find(u => u.id === supplier.ownerUserId);
      if (!user) {
        return res.status(404).json({ error: 'No user linked to this supplier' });
      }

      await dbUnified.updateOne('users', { id: user.id }, { $set: { actionPromptState: null } });

      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'ACTION_PROMPT_CADENCE_RESET',
        targetType: 'user',
        targetId: user.id,
        details: { supplierId },
      });

      res.json({ ok: true, message: 'Cadence state reset. Will reinitialise on next run.' });
    } catch (error) {
      logger.error('Error resetting action-prompt cadence:', error);
      res.status(500).json({ error: 'Failed to reset cadence' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/action-prompts/set-enabled
 * Body: { enabled: boolean }
 * Sets the supplier user's emailPrefs.actionPrompts.enabled flag.
 */
router.post(
  '/suppliers/:id/action-prompts/set-enabled',
  writeLimiter,
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }

      const allSuppliers = await dbUnified.read('suppliers');
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const allUsers = await dbUnified.read('users');
      const user = allUsers.find(u => u.id === supplier.ownerUserId);
      if (!user) {
        return res.status(404).json({ error: 'No user linked to this supplier' });
      }

      const updatedPrefs = {
        ...(user.emailPrefs || {}),
        actionPrompts: {
          ...(user.emailPrefs?.actionPrompts || {}),
          enabled,
        },
      };

      await dbUnified.updateOne('users', { id: user.id }, { $set: { emailPrefs: updatedPrefs } });

      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: enabled ? 'ACTION_PROMPT_ENABLED' : 'ACTION_PROMPT_DISABLED',
        targetType: 'user',
        targetId: user.id,
        details: { supplierId, enabled },
      });

      res.json({
        ok: true,
        message: enabled
          ? 'Action-prompt reminders enabled for this supplier.'
          : 'Action-prompt reminders disabled for this supplier.',
        enabled,
      });
    } catch (error) {
      logger.error('Error updating action-prompt enabled state:', error);
      res.status(500).json({ error: 'Failed to update action-prompt setting' });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
