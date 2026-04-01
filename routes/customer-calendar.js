/**
 * Customer Calendar Entries Routes
 *
 * Personal calendar entries for customer dashboards.
 * Customers can create meetings, events, and appointments on their own calendar.
 *
 * Mounted at:
 *   /api/v1/me/calendar-entries  (canonical)
 *   /api/me/calendar-entries     (backward compat)
 *
 * Routes:
 *   GET    /      - list current user's entries
 *   POST   /      - create a new entry
 *   PUT    /:id   - update an existing entry (owner only)
 *   DELETE /:id   - delete an entry (owner only)
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { stripHtml } = require('../utils/helpers');
const { withLock } = require('../utils/asyncMutex');

const VALID_ENTRY_TYPES = ['meeting', 'event', 'appointment'];
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Validate and sanitise customer calendar entry fields.
 * Returns { data, errors }.
 */
function validateEntryBody(body) {
  const errors = [];
  const data = {};

  const title = body.title;
  if (!title || typeof title !== 'string' || !title.trim()) {
    errors.push('Title is required');
  } else if (title.trim().length > MAX_TITLE_LENGTH) {
    errors.push(`Title must be at most ${MAX_TITLE_LENGTH} characters`);
  } else {
    data.title = stripHtml(title.trim());
  }

  const type = body.type;
  if (!type || !VALID_ENTRY_TYPES.includes(type)) {
    errors.push(`Type must be one of: ${VALID_ENTRY_TYPES.join(', ')}`);
  } else {
    data.type = type;
  }

  const date = body.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('Date is required and must be in YYYY-MM-DD format');
  } else {
    data.date = date;
  }

  const time = body.time;
  if (time !== undefined && time !== null) {
    if (typeof time === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time.trim())) {
      data.time = time.trim();
    } else if (time !== '') {
      errors.push('time must be in HH:MM format (24-hour)');
    } else {
      data.time = null;
    }
  }

  const description = body.description;
  if (description !== undefined) {
    if (typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else {
      data.description = description ? stripHtml(String(description).trim()).substring(0, MAX_DESCRIPTION_LENGTH) : '';
    }
  }

  return { data, errors };
}

/**
 * GET /api/me/calendar-entries
 * List current user's personal calendar entries.
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const entries = await dbUnified.read('customer_calendar_entries');
    const userEntries = entries.filter(e => e.userId === userId);
    res.json({ ok: true, entries: userEntries });
  } catch (error) {
    logger.error('Error fetching calendar entries:', error);
    res.status(500).json({ error: 'Failed to fetch calendar entries' });
  }
});

/**
 * POST /api/me/calendar-entries
 * Create a new personal calendar entry.
 */
router.post('/', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, errors } = validateEntryBody(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

    const entry = {
      id: uid('ce'),
      userId,
      title: data.title,
      type: data.type,
      date: data.date,
      time: data.time !== undefined ? data.time : null,
      description: data.description !== undefined ? data.description : '',
      createdAt: new Date().toISOString(),
    };

    await withLock('customer_calendar_entries', async () => {
      const entries = await dbUnified.read('customer_calendar_entries');
      entries.push(entry);
      await dbUnified.write('customer_calendar_entries', entries);
    });

    logger.info(`Calendar entry created: ${entry.id} by user ${userId}`);
    res.status(201).json({ ok: true, entry });
  } catch (error) {
    logger.error('Error creating calendar entry:', error);
    res.status(500).json({ error: 'Failed to create calendar entry' });
  }
});

/**
 * PUT /api/me/calendar-entries/:id
 * Update an existing personal calendar entry (owner only).
 */
router.put('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = req.params.id;
    const { data, errors } = validateEntryBody(req.body);
    if (errors.length) {
      return res.status(400).json({ error: errors[0] });
    }

    let earlyExit = null;
    let updatedEntry = null;

    await withLock('customer_calendar_entries', async () => {
      const entries = await dbUnified.read('customer_calendar_entries');
      const idx = entries.findIndex(e => e.id === entryId && e.userId === userId);

      if (idx === -1) {
        earlyExit = { status: 404, body: { error: 'Entry not found' } };
        return;
      }

      entries[idx] = {
        ...entries[idx],
        title: data.title,
        type: data.type,
        date: data.date,
        time: data.time !== undefined ? data.time : entries[idx].time,
        description: data.description !== undefined ? data.description : entries[idx].description,
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.write('customer_calendar_entries', entries);
      updatedEntry = entries[idx];
    });

    if (earlyExit) {
      return res.status(earlyExit.status).json(earlyExit.body);
    }

    logger.info(`Calendar entry updated: ${entryId} by user ${userId}`);
    res.json({ ok: true, entry: updatedEntry });
  } catch (error) {
    logger.error('Error updating calendar entry:', error);
    res.status(500).json({ error: 'Failed to update calendar entry' });
  }
});

/**
 * DELETE /api/me/calendar-entries/:id
 * Delete a personal calendar entry (owner only).
 */
router.delete('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const entryId = req.params.id;
    let found = false;

    await withLock('customer_calendar_entries', async () => {
      const entries = await dbUnified.read('customer_calendar_entries');
      const idx = entries.findIndex(e => e.id === entryId && e.userId === userId);
      if (idx === -1) {
        return;
      }
      found = true;
      entries.splice(idx, 1);
      await dbUnified.write('customer_calendar_entries', entries);
    });

    if (!found) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    logger.error('Error deleting calendar entry:', error);
    res.status(500).json({ error: 'Failed to delete calendar entry' });
  }
});

module.exports = router;

