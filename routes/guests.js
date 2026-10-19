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

const MAX_WRITE_ATTEMPTS = 5;

/**
 * Changes a plan's guest list without losing anyone else's change.
 *
 * Every route here reads the whole list, edits it and writes it back, so two requests at once
 * (two tabs, an import while an edit saves) used to overwrite each other. The write names the
 * `updatedAt` the edit started from, and every plan write moves it on, so a stale write matches
 * nothing. The edit is then redone against the fresh plan, which is why `mutate` must be a pure
 * function of (guests, plan): it returns `{ guests, extra?, ...result }` to save, or
 * `{ status, error }` to refuse. Resolves to the mutate result with `saved: true`, a refusal, or
 * `{ failed: true }` (the database did not take the write) / `{ conflict: true }` (still moving
 * after several tries).
 */
async function changeGuests(req, mutate) {
  let plan = req.plan;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const outcome = mutate(getGuestList(plan), plan);
    if (outcome.error) {
      return outcome;
    }
    const stamp = plan.updatedAt || '';
    let now = new Date().toISOString();
    if (stamp && now <= stamp) {
      now = new Date(Date.parse(stamp) + 1).toISOString();
    }
    const stampFilter = stamp
      ? { updatedAt: stamp }
      : { updatedAt: { $in: [null, '', undefined] } };
    const saved = await dbUnified.updateOne(
      'plans',
      { id: plan.id, userId: req.user.id, ...stampFilter },
      { $set: { [guestPatchTarget(plan)]: outcome.guests, ...outcome.extra, updatedAt: now } }
    );
    if (saved) {
      return { ...outcome, saved: true };
    }
    // updateOne also answers false when the database call failed, which is not a conflict.
    let current;
    try {
      current = await dbUnified.findOne('plans', { id: plan.id, userId: req.user.id });
    } catch (error) {
      logger.error('changeGuests: could not re-read the plan', error);
      return { failed: true };
    }
    if (!current) {
      return { status: 404, error: 'Plan not found or access denied' };
    }
    if ((current.updatedAt || '') === stamp) {
      return { failed: true };
    }
    plan = current;
  }
  return { conflict: true };
}

/** Answers a change that did not save with the right error; true when it did, so the route stops. */
function respondIfUnsaved(res, req, outcome) {
  if (outcome.saved) {
    return false;
  }
  if (outcome.error) {
    res.status(outcome.status).json({ error: outcome.error });
  } else if (outcome.conflict) {
    logger.warn('guest list kept changing, gave up', { planId: req.plan.id });
    res.status(409).json({
      error: 'Your guest list is being changed somewhere else. Try again in a moment.',
    });
  } else {
    logger.error('guest list change was not saved', { planId: req.plan.id });
    res.status(500).json({ error: 'Failed to save guests' });
  }
  return true;
}

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

/** True when `fields` has a name that is still something once tags are stripped. */
const hasName = fields =>
  Boolean(fields) && typeof fields.name === 'string' && Boolean(sanitize(fields.name, 200));

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
    source: (typeof fields.source === 'string' && sanitize(fields.source, 50)) || 'manual',
    partySize: Math.max(1, Math.min(20, Number(fields.partySize) || 1)),
    plusOneAllowed: Boolean(fields.plusOneAllowed),
    plusOneName: sanitize(fields.plusOneName, 200),
    childrenCount: Math.max(0, Math.min(10, Number(fields.childrenCount) || 0)),
    mealChoice: sanitize(fields.mealChoice, 100),
    dietaryRequirements: sanitize(fields.dietaryRequirements || fields.dietary, 500),
    accessibilityRequirements: sanitize(fields.accessibilityRequirements, 500),
    songRequest: sanitize(fields.songRequest, 200),
    notes: sanitize(fields.notes, 1000),
    tableId: (typeof fields.tableId === 'string' && sanitize(fields.tableId, 200)) || null,
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
    if (!hasName(req.body)) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    const outcome = await changeGuests(req, (guests, plan) => {
      const guest = buildGuest(plan, req.user, req.body);
      return { guests: guests.concat(guest), guest };
    });
    if (respondIfUnsaved(res, req, outcome)) {
      return undefined;
    }
    const { guest } = outcome;
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
    const skipped = [];
    rows.forEach((row, index) => {
      if (!hasName(row)) {
        skipped.push({ index, error: 'Guest name is required' });
      }
    });
    if (skipped.length === rows.length) {
      return res.status(201).json({ success: true, guests: [], skipped });
    }
    const outcome = await changeGuests(req, (guests, plan) => {
      const added = rows.filter(hasName).map(row => buildGuest(plan, req.user, row));
      return { guests: guests.concat(added), added };
    });
    if (respondIfUnsaved(res, req, outcome)) {
      return undefined;
    }
    const added = outcome.added;
    return res.status(201).json({ success: true, guests: added, skipped });
  }
);

/** The guest with the fields in `body` applied (and their seat freed if they no longer attend). */
const patchedGuest = (existing, body) => {
  const guest = { ...existing };
  ['name', 'email', 'phone', 'plusOneName', 'mealChoice', 'songRequest', 'tableId'].forEach(k => {
    if (body[k] !== undefined) {
      guest[k] = sanitize(body[k], 200);
    }
  });
  // Same limit as on create, so saving a guest never shortens notes that were already saved.
  if (body.notes !== undefined) {
    guest.notes = sanitize(body.notes, 1000);
  }
  if (body.table !== undefined || body.tableName !== undefined) {
    guest.tableName = sanitize(body.tableName || body.table, 100);
  }
  if (body.dietary !== undefined || body.dietaryRequirements !== undefined) {
    guest.dietaryRequirements = sanitize(body.dietaryRequirements || body.dietary, 500);
  }
  if (body.accessibilityRequirements !== undefined) {
    guest.accessibilityRequirements = sanitize(body.accessibilityRequirements, 500);
  }
  if (body.rsvpStatus !== undefined && STATUS.has(body.rsvpStatus)) {
    guest.rsvpStatus = body.rsvpStatus;
  }
  if (body.partySize !== undefined) {
    guest.partySize = Math.max(1, Math.min(20, Number(body.partySize) || 1));
  }
  if (body.childrenCount !== undefined) {
    guest.childrenCount = Math.max(0, Math.min(10, Number(body.childrenCount) || 0));
  }
  // Only attending guests can hold a seat; free it when a guest declines or goes back to pending.
  const losesSeat = guest.rsvpStatus !== 'attending' && isSeated(guest);
  if (losesSeat) {
    guest.tableId = null;
    guest.tableName = null;
    guest.table = null;
  }
  guest.updatedAt = new Date().toISOString();
  return { guest, losesSeat };
};

router.patch(
  '/:planId/guests/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    const outcome = await changeGuests(req, (guests, plan) => {
      const i = guests.findIndex(g => g.id === req.params.id);
      if (i < 0) {
        return { status: 404, error: 'Guest not found' };
      }
      const { guest, losesSeat } = patchedGuest(guests[i], req.body);
      const next = guests.slice();
      next[i] = guest;
      const extra = {};
      if (losesSeat && Array.isArray(plan.tables)) {
        extra.tables = tablesWithoutGuest(plan, guest.id);
      }
      return { guests: next, extra, guest };
    });
    if (respondIfUnsaved(res, req, outcome)) {
      return undefined;
    }
    const { guest } = outcome;
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
    const outcome = await changeGuests(req, (guests, plan) => {
      const next = guests.filter(g => g.id !== req.params.id);
      if (next.length === guests.length) {
        return { status: 404, error: 'Guest not found' };
      }
      const extra = Array.isArray(plan.tables)
        ? { tables: tablesWithoutGuest(plan, req.params.id) }
        : {};
      return { guests: next, extra };
    });
    if (respondIfUnsaved(res, req, outcome)) {
      return undefined;
    }
    return res.json({ success: true, message: 'Guest removed successfully' });
  }
);

module.exports = router;
