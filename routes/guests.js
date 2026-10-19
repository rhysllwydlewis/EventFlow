'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, requireVerifiedUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { stripHtml } = require('../utils/helpers');

const router = express.Router();
const STATUS = new Set(['pending', 'attending', 'declined', 'maybe']);

const sanitize = (v, n = 200) =>
  v === null || v === undefined ? null : stripHtml(String(v)).trim().slice(0, n);
const normalize = v =>
  String(v || '')
    .toLowerCase()
    .trim();
const getGuestList = plan =>
  Array.isArray(plan.guestList) ? plan.guestList : Array.isArray(plan.guests) ? plan.guests : [];
const guestPatchTarget = plan => (Array.isArray(plan.guests) ? 'guests' : 'guestList');
const isSeated = guest => Boolean(guest.tableId || guest.tableName || guest.table);

/** Copy of the plan's tables with one guest removed from every seat list. */
const tablesWithoutGuest = (plan, guestId) =>
  (Array.isArray(plan.tables) ? plan.tables : []).map(table => ({
    ...table,
    guestIds: (table.guestIds || []).filter(id => id !== guestId),
  }));

async function verifyPlanOwnership(req, res, next) {
  try {
    const { planId } = req.params;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === planId && p.userId === req.user.id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found or access denied' });
    }
    req.plan = plan;
    return next();
  } catch (error) {
    logger.error('verifyPlanOwnership:', error);
    return res.status(500).json({ error: 'Failed to verify plan access' });
  }
}

router.get('/:planId/guests', authRequired, verifyPlanOwnership, (req, res) => {
  const guests = getGuestList(req.plan);
  return res.json({ success: true, guests, count: guests.length });
});

router.get('/:planId/rsvp-summary', authRequired, verifyPlanOwnership, (req, res) => {
  const guests = getGuestList(req.plan);
  const attending = guests.filter(g => g.rsvpStatus === 'attending');
  const declined = guests.filter(g => g.rsvpStatus === 'declined');
  const pending = guests.filter(g => !g.rsvpStatus || g.rsvpStatus === 'pending');
  const responsesReceived = guests.filter(g => g.rsvpStatus && g.rsvpStatus !== 'pending').length;
  const summary = {
    totalGuests: guests.length,
    responsesReceived,
    attending: attending.length,
    declined: declined.length,
    pending: pending.length,
    partySizeTotal: attending.reduce((s, g) => s + (Number(g.partySize) || 1), 0),
    dietaryRequirementCount: guests.filter(g => normalize(g.dietaryRequirements || g.dietary))
      .length,
    unseatedAttending: attending.filter(g => !(g.tableId || g.tableName || g.table)).length,
  };
  return res.json({ success: true, summary });
});

router.get('/:planId/guests/export.csv', authRequired, verifyPlanOwnership, (req, res) => {
  const rows = getGuestList(req.plan);
  const headers = [
    'Name',
    'Email',
    'Phone',
    'RSVP Status',
    'Party Size',
    'Plus One Name',
    'Children Count',
    'Meal Choice',
    'Dietary Requirements',
    'Accessibility Requirements',
    'Song Request',
    'Notes',
    'Table',
    'Source',
    'Submitted At',
    'Updated At',
  ];
  const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const lines = [headers.join(',')].concat(
    rows.map(g =>
      [
        g.name,
        g.email,
        g.phone,
        g.rsvpStatus,
        g.partySize,
        g.plusOneName,
        g.childrenCount,
        g.mealChoice,
        g.dietaryRequirements || g.dietary,
        g.accessibilityRequirements,
        g.songRequest,
        g.notes,
        g.tableName || g.table,
        g.source,
        g.rsvpSubmittedAt,
        g.updatedAt,
      ]
        .map(esc)
        .join(',')
    )
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="guests-${req.plan.id}.csv"`);
  return res.status(200).send(lines.join('\n'));
});

/** Most guests one bulk import may add. */
const MAX_BULK_GUESTS = 500;

/** A new guest record from request fields, sanitised the same way wherever guests are created. */
const buildGuest = (plan, user, fields) => {
  const now = new Date().toISOString();
  return {
    id: uid('guest'),
    planId: plan.id,
    userId: user.id,
    name: sanitize(fields.name, 200),
    email: sanitize(fields.email, 200),
    phone: sanitize(fields.phone, 30),
    invitationStatus: 'invited',
    rsvpStatus: STATUS.has(fields.rsvpStatus) ? fields.rsvpStatus : 'pending',
    source: fields.source || 'manual',
    partySize: Math.max(1, Math.min(20, Number(fields.partySize) || 1)),
    plusOneAllowed: Boolean(fields.plusOneAllowed),
    plusOneName: sanitize(fields.plusOneName, 200),
    childrenCount: Math.max(0, Math.min(10, Number(fields.childrenCount) || 0)),
    mealChoice: sanitize(fields.mealChoice, 100),
    dietaryRequirements: sanitize(fields.dietaryRequirements || fields.dietary, 500),
    accessibilityRequirements: sanitize(fields.accessibilityRequirements, 500),
    songRequest: sanitize(fields.songRequest, 200),
    notes: sanitize(fields.notes, 1000),
    tableId: fields.tableId || null,
    tableName: sanitize(fields.tableName || fields.table, 100),
    createdAt: now,
    updatedAt: now,
  };
};

router.post(
  '/:planId/guests',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    if (!req.body.name) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    const guest = buildGuest(req.plan, req.user, req.body);
    const guests = getGuestList(req.plan);
    guests.push(guest);
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { [guestPatchTarget(req.plan)]: guests, updatedAt: guest.createdAt } }
    );
    return res.status(201).json({ success: true, guest });
  }
);

/**
 * POST /:planId/guests/bulk  { guests: [{ name, email, ... }] }
 * Adds many guests in one write (an import used to need one request per guest). Rows without a
 * name are skipped and reported by position; the rest are added.
 */
router.post(
  '/:planId/guests/bulk',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    const rows = req.body.guests;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'guests must be a non-empty array' });
    }
    if (rows.length > MAX_BULK_GUESTS) {
      return res
        .status(400)
        .json({ error: `You can import up to ${MAX_BULK_GUESTS} guests at a time` });
    }
    const added = [];
    const skipped = [];
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object' || !row.name || !sanitize(row.name, 200)) {
        skipped.push({ index, error: 'Guest name is required' });
        return;
      }
      added.push(buildGuest(req.plan, req.user, row));
    });
    if (added.length) {
      const guests = getGuestList(req.plan).concat(added);
      await dbUnified.updateOne(
        'plans',
        { id: req.plan.id },
        {
          $set: {
            [guestPatchTarget(req.plan)]: guests,
            updatedAt: new Date().toISOString(),
          },
        }
      );
    }
    return res.status(201).json({ success: true, guests: added, skipped });
  }
);

router.patch(
  '/:planId/guests/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    const guests = getGuestList(req.plan);
    const i = guests.findIndex(g => g.id === req.params.id);
    if (i < 0) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    const guest = { ...guests[i] };
    const now = new Date().toISOString();
    ['name', 'email', 'phone', 'plusOneName', 'mealChoice', 'songRequest', 'tableId'].forEach(k => {
      if (req.body[k] !== undefined) {
        guest[k] = sanitize(req.body[k], 200);
      }
    });
    // Same limit as on create, so saving a guest never shortens notes that were already saved.
    if (req.body.notes !== undefined) {
      guest.notes = sanitize(req.body.notes, 1000);
    }
    if (req.body.table !== undefined || req.body.tableName !== undefined) {
      guest.tableName = sanitize(req.body.tableName || req.body.table, 100);
    }
    if (req.body.dietary !== undefined || req.body.dietaryRequirements !== undefined) {
      guest.dietaryRequirements = sanitize(req.body.dietaryRequirements || req.body.dietary, 500);
    }
    if (req.body.accessibilityRequirements !== undefined) {
      guest.accessibilityRequirements = sanitize(req.body.accessibilityRequirements, 500);
    }
    if (req.body.rsvpStatus !== undefined && STATUS.has(req.body.rsvpStatus)) {
      guest.rsvpStatus = req.body.rsvpStatus;
    }
    if (req.body.partySize !== undefined) {
      guest.partySize = Math.max(1, Math.min(20, Number(req.body.partySize) || 1));
    }
    if (req.body.childrenCount !== undefined) {
      guest.childrenCount = Math.max(0, Math.min(10, Number(req.body.childrenCount) || 0));
    }
    // Only attending guests can hold a seat; free it when a guest declines or goes back to pending.
    const losesSeat = guest.rsvpStatus !== 'attending' && isSeated(guest);
    if (losesSeat) {
      guest.tableId = null;
      guest.tableName = null;
      guest.table = null;
    }
    guest.updatedAt = now;
    guests[i] = guest;
    const update = { [guestPatchTarget(req.plan)]: guests, updatedAt: now };
    if (losesSeat && Array.isArray(req.plan.tables)) {
      update.tables = tablesWithoutGuest(req.plan, guest.id);
    }
    await dbUnified.updateOne('plans', { id: req.plan.id }, { $set: update });
    return res.json({ success: true, guest });
  }
);

router.delete(
  '/:planId/guests/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    const guests = getGuestList(req.plan);
    const next = guests.filter(g => g.id !== req.params.id);
    if (next.length === guests.length) {
      return res.status(404).json({ error: 'Guest not found' });
    }
    const update = { [guestPatchTarget(req.plan)]: next, updatedAt: new Date().toISOString() };
    if (Array.isArray(req.plan.tables)) {
      update.tables = tablesWithoutGuest(req.plan, req.params.id);
    }
    await dbUnified.updateOne('plans', { id: req.plan.id }, { $set: update });
    return res.json({ success: true, message: 'Guest removed successfully' });
  }
);

module.exports = router;
