/**
 * Public Calendar Routes
 *
 * Shared public calendar that can be viewed by anyone (authenticated or not)
 * but may only be written to by authorised publisher suppliers and admins.
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const {
  authRequired,
  userExtractionMiddleware,
  requireApprovedSupplier,
  requireVerifiedUser,
} = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { canPublishPublicCalendar } = require('../utils/calendarPermissions');
const {
  EVENT_STATUSES,
  EVENT_TYPES,
  PRICE_TYPES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_CATEGORY_LENGTH,
  MAX_URL_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_MEDIUM_TEXT_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_EMAIL_LENGTH,
} = require('../models/PublicCalendarEvent');
const { stripHtml } = require('../utils/helpers');
const { withLock } = require('../utils/asyncMutex');

const REPORT_REASONS = [
  'Incorrect information',
  'Spam or advertising',
  'Event no longer exists',
  'Inappropriate content',
  'Duplicate event',
  'Other',
];
const REPORT_STATUSES = ['open', 'reviewed', 'dismissed', 'actioned'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFilterDate(str, endOfDay = false) {
  const trimmed = String(str || '').trim();
  const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const normalized = isBareDate
    ? `${trimmed}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00Z'}`
    : trimmed;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function isAllowedUrl(str) {
  if (!str) {
    return true;
  }
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function makeSlug(input) {
  const base = stripHtml(String(input || 'event'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'event';
}

function eventStatus(event) {
  return event && EVENT_STATUSES.includes(event.status) ? event.status : 'published';
}

function eventTypeFor(event) {
  if (event && EVENT_TYPES.includes(event.eventType)) {
    return event.eventType;
  }
  return event?.category || 'Other';
}

function imageFor(event) {
  return event?.featuredImageUrl || event?.imageUrl || '';
}

function bookingUrlFor(event) {
  return event?.externalBookingUrl || event?.externalUrl || '';
}

function locationSummary(event) {
  const parts = [event?.venueName, event?.townCity, event?.county, event?.postcode].filter(Boolean);
  return parts.length
    ? parts.join(', ')
    : event?.location || (event?.isOnline ? 'Online event' : '');
}

function isDeletedPublicCalendarEvent(event) {
  return (
    event?.deleted === true ||
    event?.isDeleted === true ||
    event?.deletedAt ||
    event?.status === 'deleted'
  );
}

async function readActivePublicCalendarEvents() {
  return (await dbUnified.read('public_calendar_events'))
    .filter(event => !isDeletedPublicCalendarEvent(event))
    .map(normalizeEvent);
}

function normalizeEvent(event) {
  if (!event) {
    return event;
  }
  const normalized = {
    ...event,
    status: eventStatus(event),
    eventType: eventTypeFor(event),
    featuredImageUrl: imageFor(event),
    externalBookingUrl: bookingUrlFor(event),
    location: event.location || locationSummary(event),
    priceType: PRICE_TYPES.includes(event.priceType) ? event.priceType : 'unknown',
    bookingRequired: event.bookingRequired === true,
  };
  if (!normalized.slug) {
    normalized.slug = `${makeSlug(normalized.title)}-${String(normalized.id || '')
      .replace(/^pce_/, '')
      .slice(-8)}`;
  }
  return normalized;
}

function canSeeEvent(user, event) {
  const status = eventStatus(event);
  if (status === 'published' || status === 'cancelled') {
    return true;
  }
  if (!user) {
    return false;
  }
  return user.role === 'admin' || event.createdByUserId === user.id;
}

function sanitiseText(value, max) {
  return stripHtml(String(value || '').trim()).slice(0, max);
}

function validateUrlField(body, data, errors, field) {
  if (body[field] === undefined) {
    return;
  }
  const url = String(body[field] || '').trim();
  if (!isAllowedUrl(url)) {
    errors.push(`${field} must be a valid http or https URL`);
  } else {
    data[field] = url ? url.slice(0, MAX_URL_LENGTH) : '';
  }
}

function validateEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getSupplierForUser(user) {
  if (!user || user.role !== 'supplier') {
    return null;
  }
  return dbUnified.findOne('suppliers', { ownerUserId: user.id });
}

async function requirePublisher(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated', message: 'Please log in.' });
  }
  if (req.user.role === 'admin') {
    return next();
  }
  if (req.user.role !== 'supplier') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only authorised publisher suppliers and admins may modify public calendar events.',
    });
  }
  try {
    const supplier = await getSupplierForUser(req.user);
    if (!supplier) {
      return res
        .status(403)
        .json({ error: 'Forbidden', message: 'No supplier profile found for your account.' });
    }
    if (!canPublishPublicCalendar(supplier)) {
      const denied = supplier.publicCalendarPublisherOverride === false;
      return res.status(403).json({
        error: 'Forbidden',
        message: denied
          ? 'Calendar publishing has been disabled for this supplier account by an administrator.'
          : 'Your supplier category does not currently include shared calendar publishing. Event Planner and Wedding Fayre suppliers can publish by default.',
      });
    }
    req.supplierDoc = supplier;
    return next();
  } catch (err) {
    logger.error('requirePublisher: error fetching supplier', err);
    return res.status(500).json({ error: 'Server error during permission check' });
  }
}

async function requiresPublicCalendarApproval() {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    return settings.features?.requirePublicCalendarApproval === true;
  } catch (err) {
    logger.warn('Failed to read public calendar approval setting; defaulting to auto-publish', err);
    return false;
  }
}

function validateEventBody(body, { partial = false, existing = null, user = null } = {}) {
  const source = { ...(existing || {}), ...(body || {}) };
  const errors = [];
  const data = {};

  if (!partial || body.title !== undefined) {
    if (!source.title || !String(source.title).trim()) {
      errors.push('title is required');
    } else {
      data.title = sanitiseText(source.title, MAX_TITLE_LENGTH);
    }
  }

  let validatedStartDate = null;
  if (!partial || body.startDate !== undefined) {
    if (!source.startDate) {
      errors.push('startDate is required');
    } else {
      const d = new Date(source.startDate);
      if (isNaN(d.getTime())) {
        errors.push('startDate must be a valid ISO date');
      } else {
        validatedStartDate = d;
        data.startDate = d.toISOString();
      }
    }
  } else if (source.startDate) {
    const d = new Date(source.startDate);
    if (!isNaN(d.getTime())) {
      validatedStartDate = d;
    }
  }

  if (
    body.endDate !== undefined ||
    (!partial && source.endDate) ||
    (partial && body.startDate !== undefined && source.endDate)
  ) {
    if (!source.endDate) {
      data.endDate = '';
    } else {
      const d = new Date(source.endDate);
      if (isNaN(d.getTime())) {
        errors.push('endDate must be a valid ISO date');
      } else if (validatedStartDate && d < validatedStartDate) {
        errors.push('endDate must be on or after startDate');
      } else {
        data.endDate = d.toISOString();
      }
    }
  }

  const textFields = [
    ['description', MAX_DESCRIPTION_LENGTH],
    ['location', MAX_LOCATION_LENGTH],
    ['category', MAX_CATEGORY_LENGTH],
    ['venueName', MAX_SHORT_TEXT_LENGTH],
    ['addressLine1', MAX_SHORT_TEXT_LENGTH],
    ['addressLine2', MAX_SHORT_TEXT_LENGTH],
    ['townCity', MAX_SHORT_TEXT_LENGTH],
    ['county', MAX_SHORT_TEXT_LENGTH],
    ['postcode', 20],
    ['organiserName', MAX_SHORT_TEXT_LENGTH],
    ['contactPhone', MAX_PHONE_LENGTH],
    ['accessibilityNotes', MAX_MEDIUM_TEXT_LENGTH],
    ['parkingInfo', MAX_MEDIUM_TEXT_LENGTH],
    ['ageSuitability', MAX_SHORT_TEXT_LENGTH],
    ['cancelledReason', MAX_MEDIUM_TEXT_LENGTH],
  ];
  textFields.forEach(([field, max]) => {
    if (body[field] !== undefined) {
      data[field] = sanitiseText(body[field], max);
    }
  });

  if (body.category !== undefined) {
    data.category = data.category.toLowerCase();
  }
  if (body.eventType !== undefined) {
    const eventType = sanitiseText(body.eventType, MAX_CATEGORY_LENGTH);
    if (eventType && !EVENT_TYPES.includes(eventType)) {
      errors.push('eventType is not supported');
    } else {
      data.eventType = eventType || 'Other';
    }
  }
  if (body.priceType !== undefined) {
    const priceType = sanitiseText(body.priceType, 20).toLowerCase();
    if (priceType && !PRICE_TYPES.includes(priceType)) {
      errors.push('priceType is not supported');
    } else {
      data.priceType = priceType || 'unknown';
    }
  }
  if (body.status !== undefined) {
    const status = sanitiseText(body.status, 40);
    if (!EVENT_STATUSES.includes(status)) {
      errors.push('status is not supported');
    } else if (
      status === 'cancelled' ||
      user?.role === 'admin' ||
      status === 'draft' ||
      status === 'published'
    ) {
      data.status = status;
      if (status === 'published' && !existing?.publishedAt) {
        data.publishedAt = new Date().toISOString();
      }
      if (status === 'cancelled' && existing?.status !== 'cancelled') {
        data.cancelledAt = new Date().toISOString();
      }
    } else {
      errors.push('status change is not permitted');
    }
  }

  ['imageUrl', 'featuredImageUrl', 'externalUrl', 'externalBookingUrl', 'onlineUrl'].forEach(
    field => validateUrlField(body, data, errors, field)
  );

  if (body.galleryImageUrls !== undefined) {
    const urls = Array.isArray(body.galleryImageUrls) ? body.galleryImageUrls : [];
    const cleaned = [];
    urls.slice(0, 12).forEach(urlValue => {
      const url = String(urlValue || '').trim();
      if (url && !isAllowedUrl(url)) {
        errors.push('galleryImageUrls must contain only valid http or https URLs');
      } else if (url) {
        cleaned.push(url.slice(0, MAX_URL_LENGTH));
      }
    });
    data.galleryImageUrls = cleaned;
  }

  if (body.contactEmail !== undefined) {
    const email = sanitiseText(body.contactEmail, MAX_EMAIL_LENGTH);
    if (!validateEmail(email)) {
      errors.push('contactEmail must be a valid email address');
    } else {
      data.contactEmail = email;
    }
  }
  if (body.isOnline !== undefined) {
    data.isOnline = body.isOnline === true || body.isOnline === 'true';
  }
  if (body.bookingRequired !== undefined) {
    data.bookingRequired = body.bookingRequired === true || body.bookingRequired === 'true';
  }
  if (body.capacity !== undefined && body.capacity !== '') {
    const n = Number(body.capacity);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) {
      errors.push('capacity must be a positive integer');
    } else {
      data.capacity = n;
    }
  }
  if (body.ticketPrice !== undefined && body.ticketPrice !== '') {
    const n = Number(body.ticketPrice);
    if (!Number.isFinite(n) || n < 0 || n > 1000000) {
      errors.push('ticketPrice must be a positive number');
    } else {
      data.ticketPrice = Math.round(n * 100) / 100;
    }
  }

  return { data, errors };
}

function escapeIcs(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsDate(iso) {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function absoluteEventUrl(req, event) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host') || 'event-flow.co.uk';
  return `${proto}://${host}/events/${encodeURIComponent(normalizeEvent(event).slug)}`;
}

// ─── Core event routes ───────────────────────────────────────────────────────

router.get('/events', apiLimiter, userExtractionMiddleware, async (req, res) => {
  try {
    let events = await readActivePublicCalendarEvents();
    const now = new Date();
    const includePast = String(req.query.includePast || '').toLowerCase() === 'true';
    const requestedStatus = req.query.status ? String(req.query.status).trim() : '';

    if (req.user?.role === 'admin') {
      if (requestedStatus && requestedStatus !== 'all') {
        events = events.filter(e => eventStatus(e) === requestedStatus);
      }
    } else if (req.user?.role === 'supplier' && requestedStatus) {
      events = events.filter(e => e.createdByUserId === req.user.id);
      if (requestedStatus !== 'all') {
        events = events.filter(e => eventStatus(e) === requestedStatus);
      }
    } else {
      events = events.filter(e => eventStatus(e) === 'published');
    }

    if (!includePast) {
      events = events.filter(e => new Date(e.endDate || e.startDate) >= now);
    }
    if (req.query.category) {
      const cat = String(req.query.category).trim().toLowerCase();
      events = events.filter(e => (e.category || '').toLowerCase() === cat);
    }
    if (req.query.eventType) {
      const type = String(req.query.eventType).trim().toLowerCase();
      events = events.filter(e => (e.eventType || '').toLowerCase() === type);
    }
    if (req.query.location) {
      const loc = String(req.query.location).trim().toLowerCase();
      events = events.filter(e => locationSummary(e).toLowerCase().includes(loc));
    }
    if (req.query.county) {
      const county = String(req.query.county).trim().toLowerCase();
      events = events.filter(e => (e.county || '').toLowerCase().includes(county));
    }
    if (req.query.postcode) {
      const postcode = String(req.query.postcode).trim().toLowerCase();
      events = events.filter(e => (e.postcode || '').toLowerCase().includes(postcode));
    }
    if (req.query.q) {
      const q = String(req.query.q).trim().toLowerCase();
      events = events.filter(e =>
        [e.title, e.description, e.organiserName, locationSummary(e)]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    if (req.query.startDate) {
      const from = parseFilterDate(String(req.query.startDate));
      if (from) {
        events = events.filter(e => new Date(e.startDate) >= from);
      }
    }
    if (req.query.endDate) {
      const to = parseFilterDate(String(req.query.endDate), true);
      if (to) {
        events = events.filter(e => new Date(e.startDate) <= to);
      }
    }

    events.sort((a, b) => {
      if (a.isFeatured !== b.isFeatured) {
        return a.isFeatured ? -1 : 1;
      }
      return new Date(a.startDate) - new Date(b.startDate);
    });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const total = events.length;
    const page = events.slice(offset, offset + limit);

    const savedSet = new Set();
    const saveCountMap = new Map();
    if (req.user) {
      const saves = await dbUnified.read('public_calendar_saves');
      saves.filter(s => s.userId === req.user.id).forEach(s => savedSet.add(s.eventId));
      if (req.user.role === 'admin') {
        saves.forEach(save => {
          saveCountMap.set(save.eventId, (saveCountMap.get(save.eventId) || 0) + 1);
        });
      }
    }

    res.json({
      ok: true,
      events: page.map(e => ({
        ...e,
        savedByMe: savedSet.has(e.id),
        ...(req.user?.role === 'admin' ? { savesCount: saveCountMap.get(e.id) || 0 } : {}),
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error('GET /public-calendar/events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

router.get('/events/saved', authRequired, apiLimiter, async (req, res) => {
  try {
    const saves = await dbUnified.read('public_calendar_saves');
    const userSaves = saves.filter(s => s.userId === req.user.id);
    const events = await readActivePublicCalendarEvents();
    const eventMap = new Map(events.map(e => [e.id, e]));
    const staleSaveKeys = new Set();
    const savedEvents = userSaves
      .map(s => {
        const ev = eventMap.get(s.eventId);
        if (!ev || !['published', 'cancelled'].includes(eventStatus(ev))) {
          staleSaveKeys.add(`${s.userId}:${s.eventId}`);
          return null;
        }
        return { ...ev, savedAt: s.savedAt, savedByMe: true };
      })
      .filter(Boolean);

    if (staleSaveKeys.size > 0) {
      // Remove stale saves with targeted deleteOne calls — avoids wiping the collection
      for (const key of staleSaveKeys) {
        const [userId, eventId] = key.split(':');
        await dbUnified.deleteMany('public_calendar_saves', { userId, eventId });
      }
      logger.info(
        `Cleaned ${staleSaveKeys.size} stale public calendar save(s) for user ${req.user.id}`
      );
    }

    res.json({ ok: true, events: savedEvents, count: savedEvents.length });
  } catch (err) {
    logger.error('GET /public-calendar/events/saved error:', err);
    res.status(500).json({ error: 'Failed to fetch saved events' });
  }
});

router.get('/events/:id/ics', apiLimiter, userExtractionMiddleware, async (req, res) => {
  try {
    const events = await readActivePublicCalendarEvents();
    const event = events.find(e => e.id === req.params.id || e.slug === req.params.id);
    if (!event || !canSeeEvent(req.user, event)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (eventStatus(event) === 'cancelled') {
      event.title = `CANCELLED: ${event.title}`;
    }
    const end = event.endDate || event.startDate;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//EventFlow//Public Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${escapeIcs(event.id)}@event-flow.co.uk`,
      `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(event.startDate)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeIcs(event.title)}`,
      `DESCRIPTION:${escapeIcs(event.description || '')}`,
      `LOCATION:${escapeIcs(locationSummary(event))}`,
      `URL:${escapeIcs(absoluteEventUrl(req, event))}`,
    ];
    if (event.organiserName || event.contactEmail) {
      lines.push(
        `ORGANIZER${event.contactEmail ? `;CN=${escapeIcs(event.organiserName || 'EventFlow supplier')}:mailto:${escapeIcs(event.contactEmail)}` : `:${escapeIcs(event.organiserName)}`}`
      );
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${makeSlug(event.title)}.ics"`);
    res.send(`${lines.join('\r\n')}\r\n`);
  } catch (err) {
    logger.error('GET /public-calendar/events/:id/ics error:', err);
    res.status(500).json({ error: 'Failed to export event' });
  }
});

router.get('/events/:id', apiLimiter, userExtractionMiddleware, async (req, res) => {
  try {
    const events = await readActivePublicCalendarEvents();
    const event = events.find(e => e.id === req.params.id || e.slug === req.params.id);
    if (!event || !canSeeEvent(req.user, event)) {
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

router.post(
  '/events',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  requireApprovedSupplier,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      const { data, errors } = validateEventBody(req.body, { user: req.user });
      if (errors.length) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
      const now = new Date().toISOString();
      const eventId = uid('pce');
      const manualApprovalRequired =
        req.user.role !== 'admin' && (await requiresPublicCalendarApproval());
      const status = manualApprovalRequired ? 'pending_review' : data.status || 'published';
      if (manualApprovalRequired) {
        delete data.publishedAt;
      }
      const event = normalizeEvent({
        id: eventId,
        ...data,
        status,
        publishedAt: status === 'published' ? now : data.publishedAt || null,
        slug: `${makeSlug(data.title)}-${eventId.replace(/^pce_/, '').slice(-8)}`,
        createdByUserId: req.user.id,
        supplierId: req.supplierDoc ? req.supplierDoc.id : null,
        organiserName: data.organiserName || req.supplierDoc?.name || '',
        createdAt: now,
        updatedAt: now,
      });
      const eventSaved = await dbUnified.insertOne('public_calendar_events', event);
      if (!eventSaved) {
        logger.error('[PUBLIC-CAL] event insertOne failed', { eventId: event.id });
        return res.status(500).json({ error: 'Failed to create event. Please try again.' });
      }
      logger.info(`Public calendar event created: ${event.id} by user ${req.user.id}`);
      res.status(201).json({ ok: true, event });
    } catch (err) {
      logger.error('POST /public-calendar/events error:', err);
      res.status(500).json({ error: 'Failed to create event' });
    }
  }
);

router.put(
  '/events/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  requireApprovedSupplier,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      // Find event by id or slug — $or object filter lets MongoDB use both indexes
      const rawEvent = await dbUnified.findOne('public_calendar_events', {
        $or: [{ id: req.params.id }, { slug: req.params.id }],
      });
      if (!rawEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const existing = normalizeEvent(rawEvent);
      if (req.user.role !== 'admin' && existing.createdByUserId !== req.user.id) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only edit your own public calendar events.',
        });
      }
      const { data, errors } = validateEventBody(req.body, {
        partial: true,
        existing,
        user: req.user,
      });
      if (errors.length) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
      const updatedEvent = normalizeEvent({
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
        updatedByUserId: req.user.id,
      });
      if (data.title && data.title !== existing.title && !existing.slug) {
        updatedEvent.slug = `${makeSlug(data.title)}-${String(existing.id).replace(/^pce_/, '').slice(-8)}`;
      }
      await dbUnified.updateOne(
        'public_calendar_events',
        { id: existing.id },
        { $set: updatedEvent }
      );
      logger.info(
        `Public calendar event updated: ${updatedEvent.id} by user ${req.user.id}${req.user.role === 'admin' ? ' [admin]' : ''}`
      );
      res.json({ ok: true, event: updatedEvent });
    } catch (err) {
      logger.error('PUT /public-calendar/events/:id error:', err);
      res.status(500).json({ error: 'Failed to update event' });
    }
  }
);

router.delete(
  '/events/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  requireApprovedSupplier,
  csrfProtection,
  requirePublisher,
  async (req, res) => {
    try {
      let earlyExit = null;
      let cascadeCount = 0;
      await withLock('public_calendar_events', async () => {
        const events = await dbUnified.read('public_calendar_events');
        const idx = events.findIndex(e => e.id === req.params.id || e.slug === req.params.id);
        if (idx === -1) {
          earlyExit = { status: 404, body: { error: 'Event not found' } };
          return;
        }
        const existing = events[idx];
        if (req.user.role !== 'admin' && existing.createdByUserId !== req.user.id) {
          earlyExit = {
            status: 403,
            body: {
              error: 'Forbidden',
              message: 'You can only delete your own public calendar events.',
            },
          };
          return;
        }
        await dbUnified.deleteOne('public_calendar_events', { id: existing.id });
        cascadeCount = await dbUnified.deleteMany('public_calendar_saves', {
          eventId: existing.id,
        });
      });
      if (earlyExit) {
        return res.status(earlyExit.status).json(earlyExit.body);
      }
      logger.info(
        `Public calendar event deleted: ${req.params.id} by user ${req.user.id}; ${cascadeCount} save(s) cascaded`
      );
      res.json({ ok: true, message: 'Event deleted' });
    } catch (err) {
      logger.error('DELETE /public-calendar/events/:id error:', err);
      res.status(500).json({ error: 'Failed to delete event' });
    }
  }
);

router.post(
  '/events/:id/save',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const allEvents = await readActivePublicCalendarEvents();
      const event = allEvents.find(e => e.id === req.params.id || e.slug === req.params.id);
      if (!event || eventStatus(event) !== 'published') {
        return res.status(404).json({ error: 'Event not found' });
      }
      const alreadySaved = await dbUnified.findOne('public_calendar_saves', {
        userId: req.user.id,
        eventId: event.id,
      });
      if (alreadySaved) {
        return res.json({ ok: true, message: 'Already saved', save: alreadySaved });
      }
      const newSave = {
        id: uid('pcs'),
        userId: req.user.id,
        eventId: event.id,
        savedAt: new Date().toISOString(),
      };
      const saveSaved = await dbUnified.insertOne('public_calendar_saves', newSave);
      if (!saveSaved) {
        logger.error('[PUBLIC-CAL] save insertOne failed');
        return res.status(500).json({ error: 'Failed to save event. Please try again.' });
      }
      res.status(201).json({ ok: true, message: 'Saved to your planning calendar', save: newSave });
    } catch (err) {
      logger.error('POST /public-calendar/events/:id/save error:', err);
      res.status(500).json({ error: 'Failed to save event' });
    }
  }
);

router.delete(
  '/events/:id/save',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const allEvents = await readActivePublicCalendarEvents();
      const event = allEvents.find(e => e.id === req.params.id || e.slug === req.params.id);
      const eventId = event ? event.id : req.params.id;
      const deleted = await dbUnified.deleteOne('public_calendar_saves', {
        userId: req.user.id,
        eventId: eventId,
      });
      if (!deleted) {
        return res.status(404).json({ error: 'Save record not found' });
      }
      res.json({ ok: true, message: 'Event removed from your calendar' });
    } catch (err) {
      logger.error('DELETE /public-calendar/events/:id/save error:', err);
      res.status(500).json({ error: 'Failed to remove saved event' });
    }
  }
);

// ─── Publishing access request workflow ──────────────────────────────────────

router.get('/publisher-request', apiLimiter, authRequired, async (req, res) => {
  try {
    const supplier = await getSupplierForUser(req.user);
    if (!supplier) {
      return res.status(403).json({ error: 'Supplier profile required' });
    }
    const requests = await dbUnified.read('public_calendar_publisher_requests');
    const supplierRequests = requests
      .filter(r => r.supplierId === supplier.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({
      ok: true,
      supplier,
      canPublish: canPublishPublicCalendar(supplier),
      requests: supplierRequests,
    });
  } catch (err) {
    logger.error('GET /public-calendar/publisher-request error:', err);
    res.status(500).json({ error: 'Failed to fetch request status' });
  }
});

router.post(
  '/publisher-request',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const supplier = await getSupplierForUser(req.user);
      if (!supplier) {
        return res.status(403).json({ error: 'Supplier profile required' });
      }
      if (canPublishPublicCalendar(supplier)) {
        return res.status(400).json({ error: 'Supplier already has calendar publishing access' });
      }
      const reason = sanitiseText(req.body.reason, MAX_MEDIUM_TEXT_LENGTH);
      if (!reason) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: ['reason is required'] });
      }
      const supportingUrl = String(req.body.supportingUrl || '').trim();
      if (supportingUrl && !isAllowedUrl(supportingUrl)) {
        return res.status(400).json({
          error: 'Validation failed',
          details: ['supportingUrl must be a valid http or https URL'],
        });
      }
      let requestDoc = null;
      let duplicate = null;
      await withLock('public_calendar_publisher_requests', async () => {
        const requests = await dbUnified.read('public_calendar_publisher_requests');
        duplicate = requests.find(r => r.supplierId === supplier.id && r.status === 'pending');
        if (duplicate) {
          return;
        }
        const now = new Date().toISOString();
        requestDoc = {
          id: uid('pcpr'),
          supplierId: supplier.id,
          supplierName: supplier.name,
          supplierCategory: supplier.category,
          requesterUserId: req.user.id,
          reason,
          eventTypes: sanitiseText(req.body.eventTypes, MAX_MEDIUM_TEXT_LENGTH),
          exampleEventTitle: sanitiseText(req.body.exampleEventTitle, MAX_TITLE_LENGTH),
          expectedFrequency: sanitiseText(req.body.expectedFrequency, 80),
          supportingUrl: supportingUrl.slice(0, MAX_URL_LENGTH),
          notes: sanitiseText(req.body.notes, MAX_MEDIUM_TEXT_LENGTH),
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        const reqInserted = await dbUnified.insertOne(
          'public_calendar_publisher_requests',
          requestDoc
        );
        if (!reqInserted) {
          logger.error('[PUBLIC-CAL] publisher request insertOne failed', {
            supplierId: supplier.id,
          });
          throw new Error('Failed to save publishing request');
        }
      });
      if (duplicate) {
        return res.status(409).json({
          error: 'A pending calendar publishing request already exists',
          request: duplicate,
        });
      }
      res.status(201).json({ ok: true, request: requestDoc });
    } catch (err) {
      logger.error('POST /public-calendar/publisher-request error:', err);
      res.status(500).json({ error: 'Failed to submit publishing request' });
    }
  }
);

router.get('/publisher-requests', apiLimiter, authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }
  try {
    let requests = await dbUnified.read('public_calendar_publisher_requests');
    if (req.query.status) {
      requests = requests.filter(r => r.status === req.query.status);
    }
    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, requests, total: requests.length });
  } catch (err) {
    logger.error('GET /public-calendar/publisher-requests error:', err);
    res.status(500).json({ error: 'Failed to fetch publishing requests' });
  }
});

router.post(
  '/publisher-requests/:id/:action',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin required' });
    }
    const action = req.params.action;
    if (!['approve', 'reject', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported request action' });
    }
    try {
      const existingRequest = await dbUnified.findOne('public_calendar_publisher_requests', {
        id: req.params.id,
      });
      let updatedRequest = null;
      if (existingRequest) {
        const now = new Date().toISOString();
        const status =
          action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled';
        const updateFields = {
          status,
          adminReason: sanitiseText(req.body.reason, MAX_MEDIUM_TEXT_LENGTH),
          actionedByAdminUserId: req.user.id,
          actionedAt: now,
          updatedAt: now,
        };
        await dbUnified.updateOne(
          'public_calendar_publisher_requests',
          { id: req.params.id },
          { $set: updateFields }
        );
        updatedRequest = { ...existingRequest, ...updateFields };
      }
      if (!updatedRequest) {
        return res.status(404).json({ error: 'Publishing request not found' });
      }
      if (action === 'approve') {
        await dbUnified.updateOne(
          'suppliers',
          { id: updatedRequest.supplierId },
          { $set: { publicCalendarPublisherOverride: true, updatedAt: new Date().toISOString() } }
        );
      }
      res.json({ ok: true, request: updatedRequest });
    } catch (err) {
      logger.error('POST /public-calendar/publisher-requests/:id/:action error:', err);
      res.status(500).json({ error: 'Failed to update publishing request' });
    }
  }
);

// ─── Reporting ───────────────────────────────────────────────────────────────

router.post(
  '/events/:id/report',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const events = await readActivePublicCalendarEvents();
      const event = events.find(e => e.id === req.params.id || e.slug === req.params.id);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }
      const reason = sanitiseText(req.body.reason, 80);
      if (!REPORT_REASONS.includes(reason)) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: ['reason is not supported'] });
      }
      const now = new Date().toISOString();
      const reportId = uid('pcer');
      const notes = sanitiseText(req.body.notes, MAX_MEDIUM_TEXT_LENGTH);
      const ticketSubject = `Public event report: ${event.title}`.slice(0, 180);
      const ticketMessage = [
        `A user reported a public calendar event.`,
        ``,
        `Event: ${event.title}`,
        `Event ID: ${event.id}`,
        `Reason: ${reason}`,
        notes ? `Notes: ${notes}` : '',
        `Event URL: /events/${event.slug || event.id}`,
      ]
        .filter(Boolean)
        .join('\n');
      const ticket = {
        id: uid(),
        senderId: req.user.id,
        senderType: req.user.role === 'supplier' ? 'supplier' : 'customer',
        senderName: req.user.name || req.user.firstName || req.user.email || 'EventFlow user',
        senderEmail: req.user.email || '',
        subject: ticketSubject,
        message: ticketMessage,
        status: 'open',
        priority: 'medium',
        accountTier: 'standard',
        prioritySource: 'system',
        assignedTo: null,
        lastReplyAt: now,
        lastReplyBy: req.user.role === 'supplier' ? 'supplier' : 'customer',
        responses: [],
        source: 'public_calendar_report',
        relatedReportId: reportId,
        relatedEventId: event.id,
        createdAt: now,
        updatedAt: now,
      };
      const calTicketInserted = await dbUnified.insertOne('tickets', ticket);
      if (!calTicketInserted) {
        logger.error('[PUBLIC-CAL] ticket insertOne failed', { ticketId: ticket.id });
        return res.status(500).json({ error: 'Failed to submit ticket. Please try again.' });
      }
      res.status(201).json({
        ok: true,
        ticketId: ticket.id,
        report: {
          id: reportId,
          eventId: event.id,
          reporterUserId: req.user.id,
          reason,
          notes,
          status: 'open',
          createdAt: now,
          ticketId: ticket.id,
        },
      });
    } catch (err) {
      logger.error('POST /public-calendar/events/:id/report error:', err);
      res.status(500).json({ error: 'Failed to report event' });
    }
  }
);

router.get('/reports', apiLimiter, authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' });
  }
  try {
    let reports = await dbUnified.read('public_calendar_event_reports');
    if (req.query.status && REPORT_STATUSES.includes(req.query.status)) {
      reports = reports.filter(r => r.status === req.query.status);
    }
    const events = await readActivePublicCalendarEvents();
    const eventMap = new Map(events.map(event => [event.id, event]));
    const enrichedReports = reports.map(report => {
      const event = eventMap.get(report.eventId);
      return event
        ? { ...report, eventTitle: event.title, eventSlug: event.slug, eventStatus: event.status }
        : report;
    });
    res.json({ ok: true, reports: enrichedReports, total: enrichedReports.length });
  } catch (err) {
    logger.error('GET /public-calendar/reports error:', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

router.put(
  '/reports/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin required' });
    }
    const status = sanitiseText(req.body.status, 40);
    if (!REPORT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Unsupported report status' });
    }
    try {
      const existingReport = await dbUnified.findOne('public_calendar_event_reports', {
        id: req.params.id,
      });
      let updated = null;
      if (existingReport) {
        const reportUpdates = {
          status,
          adminNotes: sanitiseText(req.body.adminNotes, MAX_MEDIUM_TEXT_LENGTH),
          reviewedByAdminUserId: req.user.id,
          reviewedAt: new Date().toISOString(),
        };
        await dbUnified.updateOne(
          'public_calendar_event_reports',
          { id: req.params.id },
          { $set: reportUpdates }
        );
        updated = { ...existingReport, ...reportUpdates };
      }
      if (!updated) {
        return res.status(404).json({ error: 'Report not found' });
      }
      res.json({ ok: true, report: updated });
    } catch (err) {
      logger.error('PUT /public-calendar/reports/:id error:', err);
      res.status(500).json({ error: 'Failed to update report' });
    }
  }
);

module.exports = router;
