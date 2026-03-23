/**
 * Public Calendar Routes
 *
 * Provides a shared public calendar that all users can read.
 * Suppliers with category 'Event Planner' or 'Wedding Fayre' (or an admin override)
 * can create, update, and delete events they own.
 *
 * Routes (mounted at /api/v1/public-calendar and /api/public-calendar):
 *   GET    /                     – list events (unauthenticated)
 *   POST   /                     – create event (publisher supplier only)
 *   PUT    /:id                  – update event (publisher supplier + owner only)
 *   DELETE /:id                  – delete event (publisher supplier + owner only)
 *   POST   /:id/save             – customer saves event to their own calendar
 *   DELETE /:id/save             – customer removes saved event from their calendar
 */

'use strict';

const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const { uid } = require('../store');
const { stripHtml } = require('../utils/helpers');
const logger = require('../utils/logger');
const { canPublishPublicCalendar } = require('../utils/calendarPermissions');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Middleware: require the authenticated user to be a supplier with publishing rights.
 * Attaches `req.publisherSupplier` on success.
 */
async function requirePublisher(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Publishing rights required' });
    }

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === req.user.id && s.approved);

    if (!supplier) {
      return res.status(403).json({ error: 'Approved supplier profile required' });
    }

    if (!canPublishPublicCalendar(supplier)) {
      return res.status(403).json({
        error: 'Publishing rights required',
        message:
          'Only Event Planner and Wedding Fayre suppliers may publish to the public calendar.',
      });
    }

    req.publisherSupplier = supplier;
    next();
  } catch (err) {
    logger.error('[public-calendar] requirePublisher error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Sanitise user-supplied event fields.
 * @param {Object} body - Request body.
 * @returns {Object} Sanitised event fields.
 */
function sanitiseEventFields(body) {
  return {
    title: stripHtml(String(body.title || '').trim()).slice(0, 200),
    description: stripHtml(String(body.description || '').trim()).slice(0, 2000),
    startDate: String(body.startDate || '').trim(),
    endDate: String(body.endDate || '').trim(),
    location: stripHtml(String(body.location || '').trim()).slice(0, 300),
    url: String(body.url || '')
      .trim()
      .slice(0, 500),
    category: stripHtml(String(body.category || '').trim()).slice(0, 100),
  };
}

/**
 * Basic ISO-8601 date/datetime validation.
 * @param {string} value
 * @returns {boolean}
 */
function isValidDate(value) {
  if (!value) {
    return false;
  }
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/public-calendar
 * List all public calendar events. No authentication required.
 * Query params: location (partial match), category, from (ISO date), to (ISO date)
 */
router.get('/', apiLimiter, async (req, res) => {
  try {
    let events = (await dbUnified.read('publicCalendarEvents')) || [];

    const { location, category, from, to } = req.query;

    if (location) {
      const loc = String(location).toLowerCase();
      events = events.filter(e => (e.location || '').toLowerCase().includes(loc));
    }

    if (category) {
      const cat = String(category).toLowerCase();
      events = events.filter(e => (e.category || '').toLowerCase() === cat);
    }

    if (from && isValidDate(from)) {
      const fromDate = new Date(from);
      events = events.filter(e => e.startDate && new Date(e.startDate) >= fromDate);
    }

    if (to && isValidDate(to)) {
      const toDate = new Date(to);
      events = events.filter(e => e.startDate && new Date(e.startDate) <= toDate);
    }

    // Sort chronologically
    events.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    res.json({ ok: true, events, count: events.length });
  } catch (err) {
    logger.error('[public-calendar] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

/**
 * POST /api/public-calendar
 * Create a public calendar event. Requires publisher supplier authentication.
 * Body: { title, description, startDate, endDate, location, url, category }
 */
router.post('/', writeLimiter, authRequired, requirePublisher, csrfProtection, async (req, res) => {
  try {
    const fields = sanitiseEventFields(req.body);

    if (!fields.title) {
      return res.status(400).json({ error: 'Event title is required' });
    }
    if (!fields.startDate || !isValidDate(fields.startDate)) {
      return res.status(400).json({ error: 'A valid startDate is required' });
    }
    if (fields.endDate && !isValidDate(fields.endDate)) {
      return res.status(400).json({ error: 'endDate must be a valid date if provided' });
    }
    if (fields.url && !/^https?:\/\//i.test(fields.url)) {
      return res.status(400).json({ error: 'url must start with http:// or https://' });
    }

    const event = {
      id: uid('pce'),
      ...fields,
      supplierId: req.publisherSupplier.id,
      createdByUserId: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbUnified.insertOne('publicCalendarEvents', event);

    logger.info(`[public-calendar] Event created: ${event.id} by supplier ${event.supplierId}`);
    res.status(201).json({ ok: true, event });
  } catch (err) {
    logger.error('[public-calendar] POST / error:', err);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

/**
 * PUT /api/public-calendar/:id
 * Update a public calendar event. Requires publisher supplier authentication + ownership.
 */
router.put(
  '/:id',
  writeLimiter,
  authRequired,
  requirePublisher,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const events = (await dbUnified.read('publicCalendarEvents')) || [];
      const event = events.find(e => e.id === id);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Ownership check: only the supplier who created the event may edit it.
      if (event.supplierId !== req.publisherSupplier.id) {
        return res.status(403).json({ error: 'You may only edit your own events' });
      }

      const fields = sanitiseEventFields(req.body);

      if (fields.title !== undefined && !fields.title) {
        return res.status(400).json({ error: 'Event title cannot be empty' });
      }
      if (fields.startDate && !isValidDate(fields.startDate)) {
        return res.status(400).json({ error: 'startDate must be a valid date' });
      }
      if (fields.endDate && !isValidDate(fields.endDate)) {
        return res.status(400).json({ error: 'endDate must be a valid date if provided' });
      }
      if (fields.url && !/^https?:\/\//i.test(fields.url)) {
        return res.status(400).json({ error: 'url must start with http:// or https://' });
      }

      // Only update fields that were actually supplied (non-empty strings).
      const updates = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value !== '') {
          updates[key] = value;
        }
      }
      updates.updatedAt = new Date().toISOString();

      await dbUnified.updateOne('publicCalendarEvents', { id }, { $set: updates });

      logger.info(`[public-calendar] Event updated: ${id} by supplier ${req.publisherSupplier.id}`);
      res.json({ ok: true, event: { ...event, ...updates } });
    } catch (err) {
      logger.error('[public-calendar] PUT /:id error:', err);
      res.status(500).json({ error: 'Failed to update calendar event' });
    }
  }
);

/**
 * DELETE /api/public-calendar/:id
 * Delete a public calendar event. Requires publisher supplier authentication + ownership.
 */
router.delete(
  '/:id',
  writeLimiter,
  authRequired,
  requirePublisher,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const events = (await dbUnified.read('publicCalendarEvents')) || [];
      const event = events.find(e => e.id === id);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Ownership check: only the supplier who created the event may delete it.
      if (event.supplierId !== req.publisherSupplier.id) {
        return res.status(403).json({ error: 'You may only delete your own events' });
      }

      await dbUnified.deleteOne('publicCalendarEvents', { id });

      // Also remove any customer saves referencing this event.
      const saves = (await dbUnified.read('publicCalendarSaves')) || [];
      const relatedSaves = saves.filter(s => s.eventId === id);
      for (const save of relatedSaves) {
        await dbUnified.deleteOne('publicCalendarSaves', { id: save.id });
      }

      logger.info(`[public-calendar] Event deleted: ${id} by supplier ${req.publisherSupplier.id}`);
      res.json({ ok: true });
    } catch (err) {
      logger.error('[public-calendar] DELETE /:id error:', err);
      res.status(500).json({ error: 'Failed to delete calendar event' });
    }
  }
);

/**
 * POST /api/public-calendar/:id/save
 * Customer saves a public calendar event to their personal dashboard calendar.
 * Duplicate saves are handled gracefully (idempotent).
 */
router.post('/:id/save', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customers can save events to their calendar' });
    }

    const { id } = req.params;
    const events = (await dbUnified.read('publicCalendarEvents')) || [];
    const event = events.find(e => e.id === id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const saves = (await dbUnified.read('publicCalendarSaves')) || [];
    const alreadySaved = saves.some(s => s.userId === req.user.id && s.eventId === id);

    if (alreadySaved) {
      return res.json({ ok: true, alreadySaved: true });
    }

    await dbUnified.insertOne('publicCalendarSaves', {
      id: uid('pcs'),
      userId: req.user.id,
      eventId: id,
      savedAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, alreadySaved: false });
  } catch (err) {
    logger.error('[public-calendar] POST /:id/save error:', err);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

/**
 * DELETE /api/public-calendar/:id/save
 * Customer removes a previously saved public calendar event.
 */
router.delete('/:id/save', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customers can manage their saved events' });
    }

    const { id } = req.params;
    await dbUnified.deleteOne('publicCalendarSaves', { userId: req.user.id, eventId: id });

    res.json({ ok: true });
  } catch (err) {
    logger.error('[public-calendar] DELETE /:id/save error:', err);
    res.status(500).json({ error: 'Failed to remove saved event' });
  }
});

/**
 * GET /api/public-calendar/saved
 * List the current customer's saved public calendar events.
 */
router.get('/saved', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customers have saved events' });
    }

    const saves = (await dbUnified.read('publicCalendarSaves')) || [];
    const userSaves = saves.filter(s => s.userId === req.user.id);

    const events = (await dbUnified.read('publicCalendarEvents')) || [];
    const savedEvents = userSaves.map(s => events.find(e => e.id === s.eventId)).filter(Boolean);

    res.json({ ok: true, events: savedEvents, count: savedEvents.length });
  } catch (err) {
    logger.error('[public-calendar] GET /saved error:', err);
    res.status(500).json({ error: 'Failed to fetch saved events' });
  }
});

module.exports = router;
