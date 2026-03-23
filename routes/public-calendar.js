/**
 * Public Calendar Routes
 *
 * Shared public calendar that can be viewed by anyone (authenticated or not)
 * but may only be written to by authorised publisher suppliers.
 *
 * Permission model:
 *   - GET  (read)                  → open to all
 *   - POST / PUT / DELETE (write)  → requires auth + publisher rights
 *       Publisher = supplier whose category is 'Event Planner' or 'Wedding Fayre'
 *                   OR has publicCalendarPublisherOverride === true
 *                   OR is an admin (role === 'admin')
 *   - Ownership enforcement:
 *       Publisher may only update/delete their OWN events (createdByUserId matches).
 *       Admin may update/delete any event.
 *
 * Mounted at:
 *   /api/v1/public-calendar  (canonical)
 *   /api/public-calendar     (backward compat)
 *
 * Routes:
 *   GET    /events                      - list public events (filterable)
 *   GET    /events/:id                  - single event
 *   POST   /events                      - create (publisher/admin)
 *   PUT    /events/:id                  - update (publisher/admin + owner)
 *   DELETE /events/:id                  - delete (publisher/admin + owner)
 *   POST   /events/:id/save             - customer saves event to dashboard calendar
 *   DELETE /events/:id/save             - customer removes saved event
 *   GET    /events/saved                - list current user's saved public events
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authRequired, userExtractionMiddleware } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { canPublishPublicCalendar } = require('../utils/calendarPermissions');
const {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_CATEGORY_LENGTH,
  MAX_URL_LENGTH,
} = require('../models/PublicCalendarEvent');
const { stripHtml } = require('../utils/helpers');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Middleware: authenticate, then check the user is a publisher or admin.
 * Attaches req.supplierDoc if the user is a supplier.
 */
async function requirePublisher(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated', message: 'Please log in.' });
  }

  // Admins can always write
  if (req.user.role === 'admin') {
    return next();
  }

  if (req.user.role !== 'supplier') {
    return res.status(403).json({
      error: 'Forbidden',
      message:
        'Only publisher suppliers (Event Planner / Wedding Fayre) may modify public calendar events.',
    });
  }

  // Find supplier profile for this user
  try {
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

    if (!supplier) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'No supplier profile found for your account.',
      });
    }

    if (!canPublishPublicCalendar(supplier)) {
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Your supplier type does not have public calendar publishing rights. Only Event Planner and Wedding Fayre suppliers may publish.',
      });
    }

    req.supplierDoc = supplier;
    return next();
  } catch (err) {
    logger.error('requirePublisher: error fetching supplier', err);
    return res.status(500).json({ error: 'Server error during permission check' });
  }
}

/**
 * Validate and sanitise event fields from the request body.
 * Returns { data, errors } where data is the cleaned object.
 */
function validateEventBody(body) {
  const errors = [];
  const data = {};

  // title (required)
  if (!body.title || !String(body.title).trim()) {
    errors.push('title is required');
  } else {
    data.title = stripHtml(String(body.title).trim()).slice(0, MAX_TITLE_LENGTH);
  }

  // startDate (required, must be valid ISO date)
  let validatedStartDate = null;
  if (!body.startDate) {
    errors.push('startDate is required');
  } else {
    const d = new Date(body.startDate);
    if (isNaN(d.getTime())) {
      errors.push('startDate must be a valid ISO date');
    } else {
      validatedStartDate = d;
      data.startDate = d.toISOString();
    }
  }

  // endDate (optional but must be valid if provided)
  if (body.endDate) {
    const d = new Date(body.endDate);
    if (isNaN(d.getTime())) {
      errors.push('endDate must be a valid ISO date');
    } else {
      // endDate must be >= startDate
      if (validatedStartDate && d < validatedStartDate) {
        errors.push('endDate must be on or after startDate');
      } else {
        data.endDate = d.toISOString();
      }
    }
  }

  if (body.description !== undefined) {
    data.description = stripHtml(String(body.description)).slice(0, MAX_DESCRIPTION_LENGTH);
  }
  if (body.location !== undefined) {
    data.location = stripHtml(String(body.location).trim()).slice(0, MAX_LOCATION_LENGTH);
  }
  if (body.category !== undefined) {
    data.category = stripHtml(String(body.category).trim()).slice(0, MAX_CATEGORY_LENGTH);
  }
  if (body.imageUrl !== undefined) {
    const url = String(body.imageUrl).trim();
    data.imageUrl = url ? url.slice(0, MAX_URL_LENGTH) : '';
  }
  if (body.externalUrl !== undefined) {
    const url = String(body.externalUrl).trim();
    data.externalUrl = url ? url.slice(0, MAX_URL_LENGTH) : '';
  }

  return { data, errors };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /events
 * List public calendar events.
 * Query params: startDate, endDate, category, location, limit, offset
 */
router.get('/events', apiLimiter, userExtractionMiddleware, async (req, res) => {
  try {
    let events = await dbUnified.read('public_calendar_events');

    // Filters
    if (req.query.category) {
      const cat = String(req.query.category).trim().toLowerCase();
      events = events.filter(e => e.category && e.category.toLowerCase() === cat);
    }
    if (req.query.location) {
      const loc = String(req.query.location).trim().toLowerCase();
      events = events.filter(e => e.location && e.location.toLowerCase().includes(loc));
    }
    if (req.query.startDate) {
      const from = new Date(req.query.startDate);
      if (!isNaN(from.getTime())) {
        events = events.filter(e => new Date(e.startDate) >= from);
      }
    }
    if (req.query.endDate) {
      const to = new Date(req.query.endDate);
      if (!isNaN(to.getTime())) {
        events = events.filter(e => new Date(e.startDate) <= to);
      }
    }

    // Sort by startDate ascending
    events.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // Pagination
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const total = events.length;
    const page = events.slice(offset, offset + limit);

    // For each event, check if the current user has saved it
    const savedSet = new Set();
    if (req.user) {
      const saves = await dbUnified.read('public_calendar_saves');
      saves.filter(s => s.userId === req.user.id).forEach(s => savedSet.add(s.eventId));
    }

    const result = page.map(e => ({
      ...e,
      savedByMe: savedSet.has(e.id),
    }));

    res.json({ ok: true, events: result, total, limit, offset });
  } catch (err) {
    logger.error('GET /public-calendar/events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /events/saved
 * List public events saved by the current authenticated user.
 */
router.get('/events/saved', authRequired, apiLimiter, async (req, res) => {
  try {
    const saves = await dbUnified.read('public_calendar_saves');
    const userSaves = saves.filter(s => s.userId === req.user.id);

    const events = await dbUnified.read('public_calendar_events');
    const savedEvents = userSaves
      .map(s => {
        const ev = events.find(e => e.id === s.eventId);
        if (!ev) {
          return null;
        }
        return { ...ev, savedAt: s.savedAt, savedByMe: true };
      })
      .filter(Boolean);

    res.json({ ok: true, events: savedEvents, count: savedEvents.length });
  } catch (err) {
    logger.error('GET /public-calendar/events/saved error:', err);
    res.status(500).json({ error: 'Failed to fetch saved events' });
  }
});

/**
 * GET /events/:id
 * Single public calendar event.
 */
router.get('/events/:id', apiLimiter, userExtractionMiddleware, async (req, res) => {
  try {
    const events = await dbUnified.read('public_calendar_events');
    const event = events.find(e => e.id === req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    let savedByMe = false;
    if (req.user) {
      const saves = await dbUnified.read('public_calendar_saves');
      savedByMe = saves.some(s => s.userId === req.user.id && s.eventId === event.id);
    }

    res.json({ ok: true, event: { ...event, savedByMe } });
  } catch (err) {
    logger.error('GET /public-calendar/events/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

/**
 * POST /events
 * Create a new public calendar event.
 * Requires publisher or admin rights.
 */
router.post(
  '/events',
  writeLimiter,
  authRequired,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      const { data, errors } = validateEventBody(req.body);
      if (errors.length) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }

      const now = new Date().toISOString();
      const event = {
        id: uid('pce'),
        ...data,
        createdByUserId: req.user.id,
        supplierId: req.supplierDoc ? req.supplierDoc.id : null,
        createdAt: now,
        updatedAt: now,
      };

      const events = await dbUnified.read('public_calendar_events');
      events.push(event);
      await dbUnified.write('public_calendar_events', events);

      logger.info(`Public calendar event created: ${event.id} by user ${req.user.id}`);
      res.status(201).json({ ok: true, event });
    } catch (err) {
      logger.error('POST /public-calendar/events error:', err);
      res.status(500).json({ error: 'Failed to create event' });
    }
  }
);

/**
 * PUT /events/:id
 * Update a public calendar event.
 * Requires publisher/admin rights AND ownership (unless admin).
 */
router.put(
  '/events/:id',
  writeLimiter,
  authRequired,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      const events = await dbUnified.read('public_calendar_events');
      const idx = events.findIndex(e => e.id === req.params.id);

      if (idx === -1) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const existing = events[idx];

      // Ownership check — admin can skip
      if (req.user.role !== 'admin' && existing.createdByUserId !== req.user.id) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only edit your own public calendar events.',
        });
      }

      const { data, errors } = validateEventBody({ ...existing, ...req.body });
      if (errors.length) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }

      events[idx] = {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.write('public_calendar_events', events);

      res.json({ ok: true, event: events[idx] });
    } catch (err) {
      logger.error('PUT /public-calendar/events/:id error:', err);
      res.status(500).json({ error: 'Failed to update event' });
    }
  }
);

/**
 * DELETE /events/:id
 * Delete a public calendar event.
 * Requires publisher/admin rights AND ownership (unless admin).
 */
router.delete(
  '/events/:id',
  writeLimiter,
  authRequired,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      const events = await dbUnified.read('public_calendar_events');
      const idx = events.findIndex(e => e.id === req.params.id);

      if (idx === -1) {
        return res.status(404).json({ error: 'Event not found' });
      }

      const existing = events[idx];

      // Ownership check — admin can skip
      if (req.user.role !== 'admin' && existing.createdByUserId !== req.user.id) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only delete your own public calendar events.',
        });
      }

      const updatedEvents = events.filter(e => e.id !== req.params.id);
      await dbUnified.write('public_calendar_events', updatedEvents);

      // Also remove all saves for this event
      const saves = await dbUnified.read('public_calendar_saves');
      const updatedSaves = saves.filter(s => s.eventId !== req.params.id);
      await dbUnified.write('public_calendar_saves', updatedSaves);

      logger.info(`Public calendar event deleted: ${req.params.id} by user ${req.user.id}`);
      res.json({ ok: true, message: 'Event deleted' });
    } catch (err) {
      logger.error('DELETE /public-calendar/events/:id error:', err);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  }
);

/**
 * POST /events/:id/save
 * Customer (or any authenticated user) saves a public event to their calendar.
 * Idempotent — saving an already-saved event returns 200 without duplication.
 */
router.post('/events/:id/save', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const events = await dbUnified.read('public_calendar_events');
    const event = events.find(e => e.id === req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const saves = await dbUnified.read('public_calendar_saves');
    const existing = saves.find(s => s.userId === req.user.id && s.eventId === req.params.id);

    if (existing) {
      return res.json({ ok: true, message: 'Already saved', save: existing });
    }

    const save = {
      id: uid('pcs'),
      userId: req.user.id,
      eventId: req.params.id,
      savedAt: new Date().toISOString(),
    };
    saves.push(save);
    await dbUnified.write('public_calendar_saves', saves);

    res.status(201).json({ ok: true, save });
  } catch (err) {
    logger.error('POST /public-calendar/events/:id/save error:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

/**
 * DELETE /events/:id/save
 * Remove a previously saved public event from the user's calendar.
 */
router.delete('/events/:id/save', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const saves = await dbUnified.read('public_calendar_saves');
    const updated = saves.filter(s => !(s.userId === req.user.id && s.eventId === req.params.id));

    if (updated.length === saves.length) {
      return res.status(404).json({ error: 'Save record not found' });
    }

    await dbUnified.write('public_calendar_saves', updated);
    res.json({ ok: true, message: 'Event removed from your calendar' });
  } catch (err) {
    logger.error('DELETE /public-calendar/events/:id/save error:', err);
    res.status(500).json({ error: 'Failed to remove saved event' });
  }
});

module.exports = router;
