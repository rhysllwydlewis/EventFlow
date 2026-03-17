/**
 * Miscellaneous Routes
 * Various utility endpoints including venues, captcha, settings, maintenance, and CSP reporting
 */

'use strict';

const express = require('express');
const validator = require('validator');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { uid } = require('../store');
const { createChallenge } = require('altcha-lib');
const router = express.Router();

// Input length limits for contact form fields
const CONTACT_MAX_NAME_LENGTH = 100;
const CONTACT_MAX_EMAIL_LENGTH = 200;
const CONTACT_MAX_MESSAGE_LENGTH = 2000;
const CONTACT_MAX_SUBJECT_LENGTH = 200;

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let csrfProtection;
let writeLimiter;
let geocoding;
let verifyAltcha;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Misc routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'csrfProtection',
    'writeLimiter',
    'geocoding',
    'verifyAltcha',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Misc routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  csrfProtection = deps.csrfProtection;
  writeLimiter = deps.writeLimiter;
  geocoding = deps.geocoding;
  verifyAltcha = deps.verifyAltcha;
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

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

// ---------- Venues Proximity Search ----------

router.get('/venues/near', async (req, res) => {
  try {
    const { location, radiusMiles = 10 } = req.query;

    // Get all approved Venues category suppliers
    let venues = (await dbUnified.read('suppliers')).filter(
      s => s.approved && s.category === 'Venues'
    );

    // If no location provided, return all venues
    if (!location || location.trim() === '') {
      // Add distance as null for all venues
      venues = venues.map(v => ({ ...v, distance: null }));

      return res.json({
        venues,
        total: venues.length,
        filtered: false,
        message: 'Showing all venues (no location filter)',
      });
    }

    // Try to geocode the location
    const coords = await geocoding.geocodeLocation(location);

    if (!coords) {
      // Could not geocode - return all venues with a warning
      venues = venues.map(v => ({ ...v, distance: null }));

      return res.json({
        venues,
        total: venues.length,
        filtered: false,
        radiusMiles: parseFloat(radiusMiles) || 10,
        warning: `Could not find location "${location}". Showing all venues.`,
      });
    }

    // Filter venues by proximity
    const radius = parseFloat(radiusMiles) || 10;

    // Calculate distance for each venue that has coordinates
    const venuesWithDistance = venues
      .map(venue => {
        if (
          venue.latitude !== null &&
          venue.latitude !== undefined &&
          venue.longitude !== null &&
          venue.longitude !== undefined
        ) {
          const distance = geocoding.calculateDistance(
            coords.latitude,
            coords.longitude,
            venue.latitude,
            venue.longitude
          );
          return { ...venue, distance };
        }
        // Venue without coordinates - exclude from proximity filter
        return null;
      })
      .filter(v => v !== null);

    // Filter by radius
    const nearbyVenues = venuesWithDistance.filter(v => v.distance <= radius);

    // Sort by distance
    nearbyVenues.sort((a, b) => a.distance - b.distance);

    res.json({
      venues: nearbyVenues,
      total: nearbyVenues.length,
      filtered: true,
      location: location,
      coordinates: coords,
      radiusMiles: radius,
      message: `Found ${nearbyVenues.length} venues within ${radius} miles of ${location}`,
    });
  } catch (error) {
    logger.error('Venue proximity search error:', error);
    res.status(500).json({
      error: 'Failed to search venues',
      details: error.message,
    });
  }
});

// ---------- CAPTCHA Verification ----------

// ---------- ALTCHA Challenge ----------

router.get('/altcha/challenge', applyWriteLimiter, async (req, res) => {
  try {
    if (!process.env.ALTCHA_HMAC_KEY) {
      // In development, return a dummy challenge so the widget can still render
      if (process.env.NODE_ENV !== 'production') {
        const challenge = await createChallenge({ hmacKey: 'dev-only-key', maxNumber: 100000 });
        return res.json(challenge);
      }
      return res.status(503).json({ error: 'ALTCHA not configured' });
    }
    const challenge = await createChallenge({
      hmacKey: process.env.ALTCHA_HMAC_KEY,
      maxNumber: 100000,
    });
    res.json(challenge);
  } catch (error) {
    logger.error('Error generating ALTCHA challenge:', error);
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

router.post('/verify-captcha', applyWriteLimiter, async (req, res) => {
  try {
    const { token } = req.body || {};
    const result = await verifyAltcha(token);

    if (result.success) {
      return res.json(result);
    } else {
      const statusCode = result.error === 'CAPTCHA verification not configured' ? 500 : 400;
      return res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error verifying captcha:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Contact Form ----------

router.post('/contact', applyWriteLimiter, async (req, res) => {
  try {
    const { captchaToken } = req.body || {};

    // Sanitize and trim string fields
    const name = String(req.body.name || '')
      .trim()
      .slice(0, CONTACT_MAX_NAME_LENGTH);
    const email = String(req.body.email || '')
      .trim()
      .slice(0, CONTACT_MAX_EMAIL_LENGTH);
    const subject = String(req.body.subject || '')
      .trim()
      .slice(0, CONTACT_MAX_SUBJECT_LENGTH);
    const message = String(req.body.message || '')
      .trim()
      .slice(0, CONTACT_MAX_MESSAGE_LENGTH);

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Name, email, subject and message are required' });
    }

    // Basic email format check
    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Verify ALTCHA
    const captchaResult = await verifyAltcha(captchaToken);
    if (!captchaResult.success) {
      return res.status(400).json({ error: captchaResult.error || 'CAPTCHA verification failed' });
    }

    // Persist to contact_enquiries collection for admin review
    const now = new Date().toISOString();
    const enquiry = {
      id: uid('ceq'),
      senderType: 'external',
      senderName: validator.escape(name),
      senderEmail: validator.normalizeEmail(email) || email,
      subject: validator.escape(subject),
      message: validator.escape(message),
      status: 'new',
      responses: [],
      createdAt: now,
      updatedAt: now,
    };

    await dbUnified.insertOne('contact_enquiries', enquiry);

    logger.info('Contact form submission saved', {
      id: enquiry.id,
      senderEmail: enquiry.senderEmail,
    });

    return res.json({
      success: true,
      message: 'Thank you for your message. We will be in touch soon.',
    });
  } catch (error) {
    logger.error('Error processing contact form:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Contact Supplier ----------

/**
 * POST /api/v1/contact-supplier
 * Send an enquiry message to a specific supplier
 * Body: { name, email, message, supplierId }
 */
router.post('/contact-supplier', applyWriteLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '')
      .trim()
      .slice(0, CONTACT_MAX_NAME_LENGTH);
    const email = String(req.body.email || '')
      .trim()
      .slice(0, CONTACT_MAX_EMAIL_LENGTH);
    const message = String(req.body.message || '')
      .trim()
      .slice(0, CONTACT_MAX_MESSAGE_LENGTH);
    const supplierId = String(req.body.supplierId || '').trim();

    // Validate required fields
    if (!name || !email || !message || !supplierId) {
      return res.status(400).json({ error: 'Name, email, message, and supplierId are required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Look up the supplier to verify they exist
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Persist the enquiry in the database
    const enquiry = {
      id: `enq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      supplierId,
      supplierName: supplier.name || '',
      senderName: validator.escape(name),
      senderEmail: validator.normalizeEmail(email),
      message: validator.escape(message),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await dbUnified.insertOne('enquiries', enquiry);

    logger.info('Supplier enquiry submitted', {
      supplierId,
      senderEmail: enquiry.senderEmail,
      enquiryId: enquiry.id,
    });

    return res.json({
      success: true,
      message: 'Your enquiry has been sent. The supplier will be in touch soon.',
    });
  } catch (error) {
    logger.error('Error processing contact-supplier form:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Settings ----------

router.get('/me/settings', applyAuthRequired, async (req, res) => {
  try {
    const users = await dbUnified.read('users');
    const i = users.findIndex(u => u.id === req.user.id);
    if (i < 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ notify: users[i].notify !== false });
  } catch (error) {
    logger.error('Error reading user settings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/me/settings', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const notify = !!(req.body && req.body.notify);
    const updated = await dbUnified.updateOne('users', { id: req.user.id }, { $set: { notify } });
    if (!updated) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true, notify });
  } catch (error) {
    logger.error('Error updating user settings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Maintenance ----------

router.get('/maintenance/message', async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const maintenance = settings.maintenance || {
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    };

    // Return public maintenance information
    res.json({
      enabled: maintenance.enabled,
      message: maintenance.message,
    });
  } catch (error) {
    logger.error('Error reading maintenance message:', error);
    // Return default message on error
    res.status(200).json({
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    });
  }
});

// ---------- CSP Reporting ----------

// CSP Violation Reporting Endpoint
router.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  logger.warn('CSP Violation:', req.body);
  res.status(204).end();
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
