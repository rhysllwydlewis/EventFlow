/**
 * Contact & Contact-Supplier Routes
 * Public contact form and per-supplier enquiry form.
 *
 * Split out of routes/misc.js (Effort 3.1 — route structure cleanup).
 */

'use strict';

const express = require('express');
const validator = require('validator');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { uid } = require('../store');
const router = express.Router();

// Input length limits for contact form fields
const CONTACT_MAX_NAME_LENGTH = 100;
const CONTACT_MAX_EMAIL_LENGTH = 200;
const CONTACT_MAX_MESSAGE_LENGTH = 2000;
const CONTACT_MAX_SUBJECT_LENGTH = 200;

let dbUnified;
let writeLimiter;
let verifyAltcha;

function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Contact routes: dependencies object is required');
  }
  const required = ['dbUnified', 'writeLimiter', 'verifyAltcha'];
  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Contact routes: missing required dependencies: ${missing.join(', ')}`);
  }
  dbUnified = deps.dbUnified;
  writeLimiter = deps.writeLimiter;
  verifyAltcha = deps.verifyAltcha;
}

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

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

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.CONTACT_MAX_NAME_LENGTH = CONTACT_MAX_NAME_LENGTH;
module.exports.CONTACT_MAX_EMAIL_LENGTH = CONTACT_MAX_EMAIL_LENGTH;
module.exports.CONTACT_MAX_MESSAGE_LENGTH = CONTACT_MAX_MESSAGE_LENGTH;
module.exports.CONTACT_MAX_SUBJECT_LENGTH = CONTACT_MAX_SUBJECT_LENGTH;
