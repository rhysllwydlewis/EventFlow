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
 *   GET    /   - list current user's entries
 *   POST   /   - create a new entry
 *   DELETE /:id - delete an entry
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

const VALID_ENTRY_TYPES = ['meeting', 'event', 'appointment'];
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

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
    const { title, type, date, time, description } = req.body;

    // Validation
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      return res
        .status(400)
        .json({ error: `Title must be at most ${MAX_TITLE_LENGTH} characters` });
    }
    if (!type || !VALID_ENTRY_TYPES.includes(type)) {
      return res
        .status(400)
        .json({ error: `Type must be one of: ${VALID_ENTRY_TYPES.join(', ')}` });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res
        .status(400)
        .json({ error: 'Date is required and must be in YYYY-MM-DD format' });
    }
    if (
      description &&
      typeof description === 'string' &&
      description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return res
        .status(400)
        .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
    }

    const cleanTitle = stripHtml(title.trim());
    const cleanDesc = description ? stripHtml(String(description).trim()) : '';

    const entry = {
      id: uid('ce'),
      userId,
      title: cleanTitle,
      type,
      date,
      time:
        time && typeof time === 'string' && /^\d{2}:\d{2}$/.test(time.trim()) ? time.trim() : null,
      description: cleanDesc.substring(0, MAX_DESCRIPTION_LENGTH),
      createdAt: new Date().toISOString(),
    };

    const entries = await dbUnified.read('customer_calendar_entries');
    entries.push(entry);
    await dbUnified.write('customer_calendar_entries', entries);

    logger.info(`Calendar entry created: ${entry.id} by user ${userId}`);
    res.status(201).json({ ok: true, entry });
  } catch (error) {
    logger.error('Error creating calendar entry:', error);
    res.status(500).json({ error: 'Failed to create calendar entry' });
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

    const entries = await dbUnified.read('customer_calendar_entries');
    const idx = entries.findIndex(e => e.id === entryId && e.userId === userId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    entries.splice(idx, 1);
    await dbUnified.write('customer_calendar_entries', entries);

    res.json({ ok: true });
  } catch (error) {
    logger.error('Error deleting calendar entry:', error);
    res.status(500).json({ error: 'Failed to delete calendar entry' });
  }
});

module.exports = router;
