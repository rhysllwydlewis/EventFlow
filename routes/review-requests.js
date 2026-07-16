/**
 * Supplier review-request delivery and attribution routes.
 *
 * This module replaces the legacy false-success endpoint with real Postmark
 * delivery, secure expiring links, recipient binding, and completion tracking.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { sendMail, FROM_HELLO } = require('../utils/postmark');

const REVIEW_REQUEST_TTL_DAYS = 14;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const COOKIE_NAME = 'ef_review_request';
const ACTIVE_STATUSES = new Set(['pending', 'sent', 'opened']);

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isExpired(request, now) {
  const expiry = request && request.expiresAt ? new Date(request.expiresAt) : null;
  return !expiry || Number.isNaN(expiry.getTime()) || expiry <= now;
}

function getRequestBaseUrl(req) {
  const configured = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function safeSupplierRedirect(supplierId, state) {
  if (!supplierId) {
    return `/suppliers?reviewRequest=${encodeURIComponent(state)}`;
  }
  return `/supplier?id=${encodeURIComponent(supplierId)}&reviewRequest=${encodeURIComponent(state)}#reviews`;
}

async function findLatestRequest(db, supplierId, customerEmail) {
  const requests = await db.find('reviewRequests', { supplierId, customerEmail });
  return (requests || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
}

function createReviewRequestRouter(overrides = {}) {
  const router = express.Router();
  const db = overrides.db || dbUnified;
  const send = overrides.sendMail || sendMail;
  const fromAddress = overrides.fromAddress || FROM_HELLO;
  const authenticate = overrides.authRequired || authRequired;
  const protectCsrf = overrides.csrfProtection || csrfProtection;
  const limitWrites = overrides.writeLimiter || writeLimiter;
  const now = overrides.now || (() => new Date());
  const createToken = overrides.createToken || (() => crypto.randomBytes(TOKEN_BYTES).toString('hex'));
  const baseUrlFor = overrides.getBaseUrl || getRequestBaseUrl;

  const postPaths = ['/api/v1/supplier/request-review', '/api/supplier/request-review'];

  router.post(postPaths, authenticate, protectCsrf, limitWrites, async (req, res) => {
    const currentTime = now();
    let requestId = null;

    try {
      if (req.user.role !== 'supplier') {
        return res.status(403).json({ error: 'Suppliers only' });
      }

      const customerEmail = normalizeEmail(req.body.customerEmail);
      const customerName =
        typeof req.body.customerName === 'string' ? req.body.customerName.trim().slice(0, 100) : '';
      const threadId =
        typeof req.body.threadId === 'string' && req.body.threadId.trim()
          ? req.body.threadId.trim().slice(0, 200)
          : null;

      if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail)) {
        return res.status(400).json({ error: 'A valid customer email is required' });
      }

      const supplier = await db.findOne('suppliers', { ownerUserId: req.user.id });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const latest = await findLatestRequest(db, supplier.id, customerEmail);
      if (latest && latest.status === 'completed') {
        return res.status(409).json({
          error: 'This customer has already completed a review request for your business',
          status: latest.status,
        });
      }
      if (latest && ACTIVE_STATUSES.has(latest.status) && !isExpired(latest, currentTime)) {
        return res.status(409).json({
          error: 'An active review request has already been sent to this customer',
          status: latest.status,
          expiresAt: latest.expiresAt,
        });
      }
      if (latest && ACTIVE_STATUSES.has(latest.status) && isExpired(latest, currentTime)) {
        await db.updateOne(
          'reviewRequests',
          { id: latest.id },
          {
            $set: {
              status: 'expired',
              expiredAt: currentTime.toISOString(),
              updatedAt: currentTime.toISOString(),
            },
          }
        );
      }

      const rawToken = createToken();
      if (!TOKEN_PATTERN.test(rawToken)) {
        throw new Error('Review request token generator returned an invalid token');
      }

      requestId = `rreq_${crypto.randomUUID()}`;
      const expiresAt = new Date(
        currentTime.getTime() + REVIEW_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000
      );
      const reviewLink = `${baseUrlFor(req)}/review-request?token=${encodeURIComponent(rawToken)}`;
      const requestDocument = {
        id: requestId,
        supplierId: supplier.id,
        supplierOwnerUserId: req.user.id,
        supplierName: supplier.name || 'Your supplier',
        customerEmail,
        customerName,
        threadId,
        tokenHash: hashToken(rawToken),
        status: 'pending',
        createdAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      await db.insertOne('reviewRequests', requestDocument);

      const delivery = await send({
        to: customerEmail,
        subject: `${requestDocument.supplierName} invited you to leave a review on EventFlow`,
        template: 'review-request',
        templateData: {
          name: customerName || 'there',
          supplierName: requestDocument.supplierName,
          reviewLink,
          expiresInDays: String(REVIEW_REQUEST_TTL_DAYS),
        },
        text: `${requestDocument.supplierName} invited you to leave a review on EventFlow. Open this secure link within ${REVIEW_REQUEST_TTL_DAYS} days: ${reviewLink}`,
        from: fromAddress,
        tags: ['review-request', 'transactional'],
        messageStream: 'outbound',
        criticalDelivery: true,
      });

      const sentAt = delivery.sentAt || currentTime.toISOString();
      await db.updateOne(
        'reviewRequests',
        { id: requestId },
        {
          $set: {
            status: 'sent',
            sentAt,
            updatedAt: sentAt,
            deliveryProvider: delivery.provider || 'postmark',
            providerMessageId: delivery.PostmarkMessageID || delivery.MessageID || null,
            emailLogId: delivery.emailLogId || null,
          },
        }
      );

      return res.json({
        ok: true,
        message: 'Review request email sent successfully',
        request: {
          id: requestId,
          status: 'sent',
          sentAt,
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      logger.error('POST /supplier/request-review error:', error.message);
      if (requestId) {
        try {
          await db.updateOne(
            'reviewRequests',
            { id: requestId },
            {
              $set: {
                status: 'failed',
                failedAt: currentTime.toISOString(),
                updatedAt: currentTime.toISOString(),
                lastError: String(error.message || 'Email delivery failed').slice(0, 500),
              },
            }
          );
        } catch (updateError) {
          logger.error('Failed to record review-request delivery failure:', updateError.message);
        }
      }
      return res.status(502).json({
        error: 'The review request email could not be delivered. Please try again.',
      });
    }
  });

  router.get('/review-request', async (req, res) => {
    const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!TOKEN_PATTERN.test(rawToken)) {
      return res.redirect(302, safeSupplierRedirect(null, 'invalid'));
    }

    try {
      const request = await db.findOne('reviewRequests', { tokenHash: hashToken(rawToken) });
      if (!request) {
        return res.redirect(302, safeSupplierRedirect(null, 'invalid'));
      }

      const currentTime = now();
      if (request.status === 'completed') {
        return res.redirect(302, safeSupplierRedirect(request.supplierId, 'completed'));
      }
      if (request.status === 'failed') {
        return res.redirect(302, safeSupplierRedirect(request.supplierId, 'unavailable'));
      }
      if (isExpired(request, currentTime)) {
        await db.updateOne(
          'reviewRequests',
          { id: request.id },
          {
            $set: {
              status: 'expired',
              expiredAt: currentTime.toISOString(),
              updatedAt: currentTime.toISOString(),
            },
          }
        );
        return res.redirect(302, safeSupplierRedirect(request.supplierId, 'expired'));
      }

      if (request.status === 'sent') {
        await db.updateOne(
          'reviewRequests',
          { id: request.id },
          {
            $set: {
              status: 'opened',
              openedAt: currentTime.toISOString(),
              updatedAt: currentTime.toISOString(),
            },
          }
        );
      }

      const remainingMs = Math.max(
        new Date(request.expiresAt).getTime() - currentTime.getTime(),
        1000
      );
      res.cookie(COOKIE_NAME, rawToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: remainingMs,
        path: '/',
      });

      return res.redirect(302, safeSupplierRedirect(request.supplierId, 'ready'));
    } catch (error) {
      logger.error('GET /review-request error:', error.message);
      return res.redirect(302, safeSupplierRedirect(null, 'error'));
    }
  });

  const reviewSubmissionPaths = [
    '/api/v1/suppliers/:supplierId/reviews',
    '/api/suppliers/:supplierId/reviews',
  ];

  router.post(reviewSubmissionPaths, async (req, res, next) => {
    const rawToken = req.cookies && req.cookies[COOKIE_NAME];
    if (!TOKEN_PATTERN.test(rawToken || '')) {
      return next();
    }

    try {
      const request = await db.findOne('reviewRequests', { tokenHash: hashToken(rawToken) });
      const currentTime = now();
      if (
        !request ||
        !ACTIVE_STATUSES.has(request.status) ||
        isExpired(request, currentTime) ||
        String(request.supplierId) !== String(req.params.supplierId)
      ) {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        return next();
      }

      return authenticate(req, res, async authError => {
        if (authError) {
          return next(authError);
        }

        try {
          const user = await db.findOne('users', { id: req.user.id });
          const authenticatedEmail = normalizeEmail((user && user.email) || req.user.email);
          if (!authenticatedEmail || authenticatedEmail !== request.customerEmail) {
            return res.status(403).json({
              error: 'Please sign in with the email address that received this review request',
            });
          }

          const originalJson = res.json.bind(res);
          res.json = body => {
            if (res.statusCode < 400 && body && body.success) {
              const completedAt = now().toISOString();
              res.clearCookie(COOKIE_NAME, { path: '/' });
              db.updateOne(
                'reviewRequests',
                { id: request.id },
                {
                  $set: {
                    status: 'completed',
                    completedAt,
                    completedByUserId: req.user.id,
                    updatedAt: completedAt,
                    reviewId: body.review && (body.review.id || body.review._id),
                  },
                }
              ).catch(updateError => {
                logger.error('Failed to complete review request attribution:', updateError.message);
              });
            }
            return originalJson(body);
          };

          return next();
        } catch (error) {
          logger.error('Review request recipient validation failed:', error.message);
          return res.status(500).json({ error: 'Unable to validate this review request' });
        }
      });
    } catch (error) {
      logger.error('Review request submission attribution failed:', error.message);
      res.clearCookie(COOKIE_NAME, { path: '/' });
      return next();
    }
  });

  return router;
}

const router = createReviewRequestRouter();

module.exports = router;
module.exports.createReviewRequestRouter = createReviewRequestRouter;
module.exports.constants = {
  ACTIVE_STATUSES,
  COOKIE_NAME,
  REVIEW_REQUEST_TTL_DAYS,
};
module.exports.hashToken = hashToken;
module.exports.normalizeEmail = normalizeEmail;
