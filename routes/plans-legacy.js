/**
 * Plans & Notes Routes (Legacy)
 * Plan management, notes, guest plans, and PDF export endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { writeLimiter } = require('../middleware/rateLimits');
const { stripHtml } = require('../utils/helpers');

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let csrfProtection;
let roleRequired;
let uid;

// Field limits — mirror routes/plans.js for consistency
const MAX_NOTES_LENGTH = 2000;
const MAX_PACKAGES_PER_PLAN = 20;
const MAX_GUESTS_PER_PLAN = 10000;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Plans-legacy routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = ['dbUnified', 'authRequired', 'csrfProtection', 'roleRequired', 'uid'];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Plans-legacy routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  csrfProtection = deps.csrfProtection;
  roleRequired = deps.roleRequired;
  uid = deps.uid;
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

function applyWriteLimiter(req, res, next) {
  return writeLimiter(req, res, next);
}

/**
 * Middleware: Verify plan ownership
 */
function planOwnerOnly(req, res, next) {
  if (!req.userId) {
    return res.status(403).json({ error: 'Not logged in' });
  }
  next();
}

// ---------- Plan Routes ----------

// Deprecation middleware for legacy plan endpoints (Bug 3.4)
function deprecationWarning(req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Sat, 01 Jan 2027 00:00:00 GMT');
  res.setHeader('Link', '</api/v1/me/plans>; rel="successor-version"');
  next();
}

router.get('/plan', deprecationWarning, applyWriteLimiter, applyAuthRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customers only' });
    }
    const plans = await dbUnified.find('plans', { userId: req.user.id });
    const suppliers = (await dbUnified.read('suppliers')).filter(s => s.approved);
    const matched = plans.map(p => suppliers.find(s => s.id === p.supplierId)).filter(Boolean);
    // Featured is a package-level flag (routes/suppliers.js uses the same
    // join), not a field stored on the supplier record itself -- without
    // this, supplierCard() (public/assets/js/app.js) never sees it and the
    // Featured badge silently never renders on plan cards.
    const pkgs = await dbUnified.read('packages');
    const items = matched.map(s => ({
      ...s,
      featuredSupplier: pkgs.some(p => p.supplierId === s.id && p.featured),
    }));
    res.json({ items });
  } catch (error) {
    logger.error('Error reading plan:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/plan',
  deprecationWarning,
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      if (req.user.role !== 'customer') {
        return res.status(403).json({ error: 'Customers only' });
      }
      const { supplierId } = req.body || {};
      if (!supplierId) {
        return res.status(400).json({ error: 'Missing supplierId' });
      }
      const s = await dbUnified.findOne('suppliers', { id: supplierId, approved: true });
      if (!s) {
        return res.status(404).json({ error: 'Supplier not found' });
      }
      const existingPlan = await dbUnified.findOne('plans', { userId: req.user.id, supplierId });
      if (!existingPlan) {
        await dbUnified.insertOne('plans', {
          id: uid('pln'),
          userId: req.user.id,
          supplierId,
          createdAt: new Date().toISOString(),
        });
      }
      res.json({ ok: true });
    } catch (error) {
      logger.error('Error saving plan:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete(
  '/plan/:supplierId',
  deprecationWarning,
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      if (req.user.role !== 'customer') {
        return res.status(403).json({ error: 'Customers only' });
      }
      await dbUnified.deleteOne('plans', {
        userId: req.user.id,
        supplierId: req.params.supplierId,
      });
      res.json({ ok: true });
    } catch (error) {
      logger.error('Error deleting plan:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ---------- Notes Routes ----------

router.get('/notes', applyAuthRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customers only' });
    }
    const n = await dbUnified.findOne('notes', { userId: req.user.id });
    res.json({ text: (n && n.text) || '' });
  } catch (error) {
    logger.error('Error reading notes:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/notes', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Customers only' });
    }
    const existingNote = await dbUnified.findOne('notes', { userId: req.user.id });
    const noteText = stripHtml(String((req.body && req.body.text) || '').trim()).slice(
      0,
      MAX_NOTES_LENGTH
    );
    if (existingNote) {
      await dbUnified.updateOne(
        'notes',
        { userId: req.user.id },
        { $set: { text: noteText, updatedAt: new Date().toISOString() } }
      );
    } else {
      await dbUnified.insertOne('notes', {
        id: uid('nte'),
        userId: req.user.id,
        text: noteText,
        createdAt: new Date().toISOString(),
      });
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('Error saving notes:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Plan Save & Get Routes ----------

router.post(
  '/me/plan/save',
  deprecationWarning,
  applyAuthRequired,
  planOwnerOnly,
  applyCsrfProtection,
  async (req, res) => {
    const { plan } = req.body || {};
    if (!plan) {
      return res.status(400).json({ error: 'Missing plan' });
    }
    let p = await dbUnified.findOne('plans', { userId: req.userId });
    if (!p) {
      p = { id: uid('pln'), userId: req.userId, plan };
      const planDupInserted = await dbUnified.insertOne('plans', p);
      if (!planDupInserted) {
        logger.error('[PLANS-LEGACY] dup insertOne failed');
      }
    } else {
      p.plan = plan;
      await dbUnified.updateOne('plans', { userId: req.userId }, { $set: { plan } });
    }
    res.json({ ok: true, plan: p });
  }
);

router.get(
  '/me/plan',
  deprecationWarning,
  applyWriteLimiter,
  applyAuthRequired,
  planOwnerOnly,
  async (req, res) => {
    try {
      const p = await dbUnified.findOne('plans', { userId: req.userId });
      if (!p) {
        return res.json({ ok: true, plan: null });
      }
      res.json({ ok: true, plan: p.plan });
    } catch (error) {
      logger.error('Error reading saved plan:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ---------- Guest Plan Creation ----------

/**
 * Create a guest plan (no authentication required)
 * POST /api/plans/guest
 * Returns: { ok: true, plan: {...}, token: 'secret-token' }
 */
router.post('/plans/guest', applyWriteLimiter, applyCsrfProtection, async (req, res) => {
  try {
    const { eventType, eventName, location, date, guests, budget, packages } = req.body || {};

    if (!eventType) {
      return res.status(400).json({ error: 'Event type is required' });
    }

    // Generate a secure token for guest plan claiming
    const token = uid('gst'); // guest token

    // Sanitize inputs — mirrors POST /api/me/plans sanitization
    const sanitizedGuests = guests
      ? Math.max(0, Math.min(MAX_GUESTS_PER_PLAN, parseInt(guests, 10) || 0))
      : null;
    let resolvedDate = date || null;
    if (resolvedDate) {
      const dateObj = new Date(resolvedDate);
      if (isNaN(dateObj.getTime())) {
        resolvedDate = null;
      }
    }
    const sanitizedPackages = Array.isArray(packages)
      ? packages
          .slice(0, MAX_PACKAGES_PER_PLAN)
          .map(p => String(p).trim())
          .filter(Boolean)
      : [];

    const newPlan = {
      id: uid('pln'),
      userId: null, // No user yet
      guestToken: token,
      eventType: stripHtml(String(eventType).trim()).slice(0, 100),
      eventName: eventName ? stripHtml(String(eventName).trim()).slice(0, 200) : '',
      location: location ? stripHtml(String(location).trim()).slice(0, 200) : '',
      date: resolvedDate,
      guests: sanitizedGuests,
      budget: budget ? stripHtml(String(budget).trim()).slice(0, 100) : '',
      packages: sanitizedPackages,
      isGuestPlan: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newLegacyPlanInserted = await dbUnified.insertOne('plans', newPlan);
    if (!newLegacyPlanInserted) {
      logger.error('[PLANS-LEGACY] newPlan insertOne failed', { planId: newPlan.id });
      return res.status(500).json({ error: 'Failed to create plan. Please try again.' });
    }

    res.json({
      ok: true,
      plan: newPlan,
      token, // Frontend stores this to claim later
    });
  } catch (error) {
    logger.error('Error creating guest plan:', error);
    res.status(500).json({ error: 'Failed to create guest plan' });
  }
});

// ---------- Claim Guest Plan ----------

/**
 * Claim a guest plan and attach to authenticated user
 * POST /api/me/plans/claim
 * Body: { token: 'guest-token' }
 */
router.post(
  '/me/plans/claim',
  applyAuthRequired,
  applyRoleRequired('customer'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { token } = req.body || {};

      if (!token) {
        return res.status(400).json({ error: 'Guest plan token is required' });
      }

      const guestPlan = await dbUnified.findOne('plans', { guestToken: token, isGuestPlan: true });

      if (!guestPlan) {
        return res.status(404).json({ error: 'Guest plan not found or already claimed' });
      }

      // Check if user already has a plan (targeted findOne — no full scan)
      const existingUserPlan = await dbUnified.findOne('plans', { userId: req.user.id });
      if (existingUserPlan) {
        return res.status(400).json({
          error: 'You already have a plan. Guest plan cannot be claimed.',
          existingPlanId: existingUserPlan.id,
        });
      }

      // Attach plan to user
      const claimedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'plans',
        { id: guestPlan.id },
        { $set: { userId: req.user.id, isGuestPlan: false, claimedAt } }
      );

      res.json({
        ok: true,
        plan: { ...guestPlan, userId: req.user.id, isGuestPlan: false, claimedAt },
        message: 'Plan successfully claimed!',
      });
    } catch (error) {
      logger.error('Error claiming guest plan:', error);
      res.status(500).json({ error: 'Failed to claim guest plan' });
    }
  }
);

// ---------- PDF Export ----------

router.get('/plan/export/pdf', applyAuthRequired, planOwnerOnly, async (req, res) => {
  try {
    const p = await dbUnified.findOne('plans', { userId: req.userId });
    if (!p) {
      return res.status(400).json({ error: 'No plan saved' });
    }

    // Load only the suppliers referenced in this user's plan (avoids full collection scan)
    const supIds = (p.plan && p.plan.suppliers ? p.plan.suppliers : []).map(s => s.id);
    const supplierDocs = supIds.length
      ? await Promise.all(supIds.map(id => dbUnified.findOne('suppliers', { id })))
      : [];
    const suppliers = supplierDocs.filter(Boolean);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=event_plan.pdf');

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(22).text('EventFlow — Event Plan', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.fontSize(16).text('Event Summary', { underline: true });
    doc.fontSize(12).text(JSON.stringify(p.plan.summary || {}, null, 2));
    doc.moveDown();

    doc.fontSize(16).text('Timeline', { underline: true });
    doc.fontSize(12).text(JSON.stringify(p.plan.timeline || [], null, 2));
    doc.moveDown();

    doc.fontSize(16).text('Suppliers', { underline: true });
    suppliers.forEach(s => {
      doc.fontSize(14).text(s.name);
      doc.fontSize(12).text(s.category);
      doc.moveDown();
    });

    doc.fontSize(16).text('Notes', { underline: true });
    doc.fontSize(12).text(p.plan.notes || 'None');
    doc.moveDown();

    doc.end();
  } catch (error) {
    logger.error('Error generating PDF export:', error);
    // Only send error response if headers not already sent (PDF streaming may have started)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
