/**
 * Admin External Contacts — API Routes
 * CRUD endpoints for admins to manage external contact submissions.
 * Mounted at: /api/v1/admin/external-contacts
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { notificationLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const VALID_STATUSES = new Set(['new', 'in_review', 'replied', 'archived']);
const MAX_NOTE = 2000;

function esc(val, max = 500) {
  if (typeof val !== 'string') {
    return '';
  }
  return val.trim().slice(0, max);
}

// ── GET /api/v1/admin/external-contacts ──────────────────────────────────────
router.get('/', authRequired, roleRequired('admin'), notificationLimiter, async (req, res) => {
  try {
    const {
      source,
      status,
      search,
      limit: rawLimit = 50,
      skip: rawSkip = 0,
      sort: rawSort = 'createdAt:desc',
    } = req.query;

    let all = (await dbUnified.read('external_contacts').catch(() => [])) || [];

    // Filters
    if (source) {
      all = all.filter(c => c.source === source);
    }
    if (status) {
      all = all.filter(c => c.status === status);
    }
    if (search) {
      const s = search.toLowerCase();
      all = all.filter(
        c =>
          (c.name || '').toLowerCase().includes(s) ||
          (c.email || '').toLowerCase().includes(s) ||
          (c.subject || '').toLowerCase().includes(s) ||
          (c.message || '').toLowerCase().includes(s)
      );
    }

    // Sort — field validated against allowlist to prevent internal field exposure
    const SORT_FIELDS = new Set([
      'createdAt',
      'receivedAt',
      'updatedAt',
      'status',
      'source',
      'name',
      'email',
    ]);
    const [rawSortField, rawSortDir] = rawSort.split(':');
    const sortField = SORT_FIELDS.has(rawSortField) ? rawSortField : 'createdAt';
    const sortDir = rawSortDir === 'asc' ? 'asc' : 'desc';
    all.sort((a, b) => {
      const va = a[sortField] || '';
      const vb = b[sortField] || '';
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
    });

    const total = all.length;
    const limit = Math.min(Number(rawLimit) || 50, 200);
    const skip = Math.max(Number(rawSkip) || 0, 0);
    const items = all.slice(skip, skip + limit);

    // Summary counts
    const summary = {
      total,
      new: all.filter(c => c.status === 'new').length,
      in_review: all.filter(c => c.status === 'in_review').length,
      replied: all.filter(c => c.status === 'replied').length,
      archived: all.filter(c => c.status === 'archived').length,
      vexi: all.filter(c => c.source === 'vexi').length,
      chlo: all.filter(c => c.source === 'chlo').length,
    };

    res.json({ ok: true, items, total, summary });
  } catch (err) {
    logger.error('[admin-ext-contacts] list error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list contacts', items: [] });
  }
});

// ── GET /api/v1/admin/external-contacts/:id ───────────────────────────────────
router.get('/:id', authRequired, roleRequired('admin'), notificationLimiter, async (req, res) => {
  try {
    const contact = await dbUnified.findOne('external_contacts', { id: req.params.id });
    if (!contact) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    // Mark as read on first open
    if (!contact.readAt) {
      await dbUnified.updateOne(
        'external_contacts',
        { id: req.params.id },
        {
          $set: { readAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        }
      );
      contact.readAt = new Date().toISOString();
    }
    res.json({ ok: true, contact });
  } catch (err) {
    logger.error('[admin-ext-contacts] get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to load contact' });
  }
});

// ── PATCH /api/v1/admin/external-contacts/:id ─────────────────────────────────
router.patch('/:id', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const { status, notes } = req.body || {};
    const updates = { updatedAt: new Date().toISOString() };

    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) {
        return res.status(400).json({ ok: false, error: 'Invalid status' });
      }
      updates.status = status;
      if (status === 'archived') {
        updates.archivedAt = new Date().toISOString();
      }
      if (status === 'replied') {
        updates.repliedAt = new Date().toISOString();
      }
    }

    // Inline notes (plain text stored on the record, not a thread)
    if (notes !== undefined) {
      updates.adminNotes = esc(notes, 5000);
    }

    await dbUnified.updateOne('external_contacts', { id: req.params.id }, { $set: updates });
    res.json({ ok: true });
  } catch (err) {
    logger.error('[admin-ext-contacts] patch error:', err.message);
    res.status(500).json({ ok: false });
  }
});

// ── POST /api/v1/admin/external-contacts/:id/notes ────────────────────────────
router.post('/:id/notes', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const body = esc(req.body?.body || '', MAX_NOTE);
    if (!body) {
      return res.status(400).json({ ok: false, error: 'Note body is required' });
    }

    const note = {
      id: crypto.randomUUID(),
      authorUserId: req.user.id,
      body,
      createdAt: new Date().toISOString(),
    };

    await dbUnified.updateOne(
      'external_contacts',
      { id: req.params.id },
      {
        $push: { notes: note },
        $set: { updatedAt: new Date().toISOString() },
      }
    );
    res.status(201).json({ ok: true, note });
  } catch (err) {
    logger.error('[admin-ext-contacts] add-note error:', err.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
