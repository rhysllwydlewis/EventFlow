/**
 * Newsletter Routes
 * Handles newsletter subscription with double opt-in confirmation
 * Public endpoints (no auth required)
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const crypto = require('crypto');
const validator = require('validator');
const dbUnified = require('../db-unified');
const postmark = require('../utils/postmark');
const rateLimit = require('express-rate-limit');

// Rate limiter for newsletter endpoints (5 requests per hour per IP)
const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many subscription attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/newsletter/subscribe
 * Subscribe to newsletter with double opt-in
 * Body: { email: string, source?: string }
 */
router.post('/subscribe', newsletterLimiter, async (req, res) => {
  try {
    const { email, source = 'homepage' } = req.body;

    // Validate email
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email address',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if email already exists
    const subscribers = (await dbUnified.read('newsletterSubscribers')) || [];
    const existingSubscriber = subscribers.find(s => s.email === normalizedEmail);

    // Generate confirmation token (20 bytes = 40 hex chars, URL-safe)
    const confirmToken = crypto.randomBytes(20).toString('hex');
    const confirmTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    if (existingSubscriber) {
      if (existingSubscriber.status === 'active') {
        return res.json({
          success: true,
          message: 'You are already subscribed to our newsletter',
        });
      }

      // If pending or unsubscribed, update token and resend
      existingSubscriber.confirmToken = confirmToken;
      existingSubscriber.confirmTokenExpiry = confirmTokenExpiry;
      existingSubscriber.status = 'pending-confirmation';
      existingSubscriber.source = source;
      existingSubscriber.updatedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'newsletterSubscribers',
        { id: existingSubscriber.id },
        {
          $set: {
            confirmToken,
            confirmTokenExpiry,
            status: 'pending-confirmation',
            source,
            updatedAt: existingSubscriber.updatedAt,
          },
        }
      );
    } else {
      // Create new subscriber
      const newSubscriber = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        status: 'pending-confirmation',
        confirmToken,
        confirmTokenExpiry,
        subscribedAt: new Date().toISOString(),
        confirmedAt: null,
        unsubscribedAt: null,
        source,
        ipAddress: req.ip || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await dbUnified.insertOne('newsletterSubscribers', newSubscriber);
    }

    // Send confirmation email
    const baseUrl =
      process.env.NEWSLETTER_CONFIRM_BASE_URL ||
      process.env.BASE_URL ||
      process.env.APP_BASE_URL ||
      'https://event-flow.co.uk';
    const confirmLink = `${baseUrl}/newsletter/confirm?token=${confirmToken}`;

    try {
      await postmark.sendMail({
        to: normalizedEmail,
        subject: 'Confirm your EventFlow newsletter subscription',
        template: 'newsletter-confirm',
        templateData: {
          confirmLink,
        },
        from: postmark.FROM_INFO,
        messageStream: 'outbound',
      });
    } catch (emailError) {
      logger.error('Failed to send confirmation email:', emailError);
      // Return error to user so they know email failed
      return res.status(500).json({
        error: 'Failed to send confirmation email. Please try again later.',
      });
    }

    res.json({
      success: true,
      message: 'Please check your email to confirm your subscription',
    });
  } catch (error) {
    logger.error('Newsletter subscription error:', error);
    res.status(500).json({
      error: 'Failed to process subscription. Please try again later.',
    });
  }
});

/**
 * GET /api/newsletter/confirm
 * Confirm newsletter subscription via email link
 * Query: token=xxx
 */
router.get('/confirm', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.redirect('/newsletter/expired');
    }

    const subscribers = (await dbUnified.read('newsletterSubscribers')) || [];
    const subscriber = subscribers.find(s => s.confirmToken === token);

    if (!subscriber) {
      return res.redirect('/newsletter/expired');
    }

    // Check if token is expired
    const now = new Date();
    const expiry = new Date(subscriber.confirmTokenExpiry);

    if (now > expiry) {
      return res.redirect('/newsletter/expired');
    }

    // Already confirmed
    if (subscriber.status === 'active') {
      return res.redirect('/newsletter/confirmed');
    }

    // Activate subscription
    subscriber.status = 'active';
    subscriber.confirmedAt = new Date().toISOString();
    subscriber.confirmToken = null;
    subscriber.confirmTokenExpiry = null;
    subscriber.updatedAt = new Date().toISOString();

    await dbUnified.updateOne(
      'newsletterSubscribers',
      { id: subscriber.id },
      {
        $set: {
          status: 'active',
          confirmedAt: subscriber.confirmedAt,
          confirmToken: null,
          confirmTokenExpiry: null,
          updatedAt: subscriber.updatedAt,
        },
      }
    );

    // Send optional welcome email
    try {
      await postmark.sendMail({
        to: subscriber.email,
        subject: 'Welcome to EventFlow!',
        template: 'newsletter-welcome',
        templateData: {
          email: subscriber.email,
        },
        from: postmark.FROM_INFO,
        messageStream: 'outbound',
      });
    } catch (emailError) {
      logger.error('Failed to send welcome email:', emailError);
      // Continue anyway - subscription is confirmed
    }

    res.redirect('/newsletter/confirmed');
  } catch (error) {
    logger.error('Newsletter confirmation error:', error);
    res.redirect('/newsletter/expired');
  }
});

/**
 * POST /api/newsletter/unsubscribe
 * Unsubscribe from newsletter
 * Body: { email: string }
 */
router.post('/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        error: 'Invalid email address',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const subscribers = (await dbUnified.read('newsletterSubscribers')) || [];
    const subscriber = subscribers.find(s => s.email === normalizedEmail);

    if (!subscriber) {
      return res.json({
        success: true,
        message: 'Email not found in our newsletter list',
      });
    }

    // Update status to unsubscribed
    subscriber.status = 'unsubscribed';
    subscriber.unsubscribedAt = new Date().toISOString();
    subscriber.updatedAt = new Date().toISOString();

    await dbUnified.updateOne(
      'newsletterSubscribers',
      { id: subscriber.id },
      {
        $set: {
          status: 'unsubscribed',
          unsubscribedAt: subscriber.unsubscribedAt,
          updatedAt: subscriber.updatedAt,
        },
      }
    );

    res.json({
      success: true,
      message: 'Successfully unsubscribed from newsletter',
    });
  } catch (error) {
    logger.error('Newsletter unsubscribe error:', error);
    res.status(500).json({
      error: 'Failed to unsubscribe. Please try again later.',
    });
  }
});

module.exports = router;
