/**
 * Quote Request Routes
 * API for managing quote requests from customers to suppliers
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const { getUserFromCookie } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const validator = require('validator');

/**
 * POST /api/quote-requests
 * Create a new quote request
 */
router.post('/', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const { name, email, phone, eventType, eventDate, location, budget, notes, suppliers } =
      req.body;

    // Get user if authenticated
    const user = await getUserFromCookie(req);

    // Validate required fields
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Valid email is required',
      });
    }

    if (!name || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Name is required',
      });
    }

    if (!eventType || eventType.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Event type is required',
      });
    }

    if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one supplier is required',
      });
    }

    // Validate and sanitize phone if provided
    let sanitizedPhone = null;
    if (phone && phone.trim().length > 0) {
      // Basic phone validation - should contain only digits, spaces, +, -, ()
      if (!/^[\d\s+\-()]+$/.test(phone)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid phone number format',
        });
      }
      sanitizedPhone = validator.escape(phone.trim());
    }

    // Validate event date if provided
    let parsedEventDate = null;
    if (eventDate) {
      parsedEventDate = new Date(eventDate);
      if (isNaN(parsedEventDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid event date',
        });
      }
    }

    // Create quote request
    const quoteRequest = {
      id: `qr_${Date.now()}_${crypto.randomUUID()}`,
      userId: user?.id || null,
      name: validator.escape(name.trim()),
      email: validator.normalizeEmail(email),
      phone: sanitizedPhone,
      eventType: validator.escape(eventType.trim()),
      eventDate: parsedEventDate ? parsedEventDate.toISOString() : null,
      location: location ? validator.escape(location.trim()) : null,
      budget: budget ? validator.escape(budget.trim()) : null,
      notes: notes ? validator.escape(notes.trim()) : null,
      suppliers: suppliers.map(s => ({
        supplierId: validator.escape(s.supplierId || s.id),
        supplierName: validator.escape(s.supplierName || s.name),
        category: s.category ? validator.escape(s.category) : null,
      })),
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const savedQuote = await dbUnified.insertOne('quoteRequests', quoteRequest);
    if (!savedQuote) {
      logger.error('[QUOTE] insertOne failed', { quoteId: quoteRequest.id });
      return res.status(500).json({ error: 'Failed to submit quote request. Please try again.' });
    }

    res.json({
      success: true,
      message: 'Quote request submitted successfully',
      data: {
        quoteRequestId: quoteRequest.id,
        suppliersCount: quoteRequest.suppliers.length,
      },
    });
  } catch (error) {
    logger.error('Create quote request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit quote request',
    });
  }
});

/**
 * GET /api/quote-requests
 * Get user's quote requests (requires authentication via cookie)
 */
router.get('/', async (req, res) => {
  try {
    const user = await getUserFromCookie(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const quoteRequests = (await dbUnified.read('quoteRequests')) || [];
    const userRequests = quoteRequests
      .filter(qr => qr.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: { requests: userRequests },
    });
  } catch (error) {
    logger.error('Get quote requests error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve quote requests',
    });
  }
});

/**
 * GET /api/quote-requests/:id
 * Get a specific quote request (requires authentication)
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await getUserFromCookie(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const { id } = req.params;
    const quoteRequests = (await dbUnified.read('quoteRequests')) || [];
    const request = quoteRequests.find(qr => qr.id === id);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Quote request not found',
      });
    }

    // Only allow user to view their own requests
    if (request.userId !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: { request },
    });
  } catch (error) {
    logger.error('Get quote request error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve quote request',
    });
  }
});

module.exports = router;
