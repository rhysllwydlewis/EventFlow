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

router.post(
  '/:planId/guests',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    const now = new Date().toISOString();
    const guest = {
      id: uid('guest'),
      planId: req.plan.id,
      userId: req.user.id,
      name: sanitize(name, 200),
      email: sanitize(req.body.email, 200),
      phone: sanitize(req.body.phone, 30),
      invitationStatus: 'invited',
      rsvpStatus: STATUS.has(req.body.rsvpStatus) ? req.body.rsvpStatus : 'pending',
      source: req.body.source || 'manual',
      partySize: Math.max(1, Math.min(20, Number(req.body.partySize) || 1)),
      plusOneAllowed: !!req.body.plusOneAllowed,
      plusOneName: sanitize(req.body.plusOneName, 200),
      childrenCount: Math.max(0, Math.min(10, Number(req.body.childrenCount) || 0)),
      mealChoice: sanitize(req.body.mealChoice, 100),
      dietaryRequirements: sanitize(req.body.dietaryRequirements || req.body.dietary, 500),
      accessibilityRequirements: sanitize(req.body.accessibilityRequirements, 500),
      songRequest: sanitize(req.body.songRequest, 200),
      notes: sanitize(req.body.notes, 1000),
      tableId: req.body.tableId || null,
      tableName: sanitize(req.body.tableName || req.body.table, 100),
      createdAt: now,
      updatedAt: now,
    };
    const guests = getGuestList(req.plan);
    guests.push(guest);
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { [guestPatchTarget(req.plan)]: guests, updatedAt: now } }
    );
    return res.status(201).json({ success: true, guest });
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
    [
      'name',
      'email',
      'phone',
      'plusOneName',
      'mealChoice',
      'songRequest',
      'notes',
      'tableId',
    ].forEach(k => {
      if (req.body[k] !== undefined) {
        guest[k] = sanitize(req.body[k], 200);
      }
    });
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
    guest.updatedAt = now;
    guests[i] = guest;
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { [guestPatchTarget(req.plan)]: guests, updatedAt: now } }
    );
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
    await dbUnified.updateOne(
      'plans',
      { id: req.plan.id },
      { $set: { [guestPatchTarget(req.plan)]: next, updatedAt: new Date().toISOString() } }
    );
    return res.json({ success: true, message: 'Guest removed successfully' });
  }
);

module.exports = router;
