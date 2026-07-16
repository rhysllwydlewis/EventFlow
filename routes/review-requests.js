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
const { removeLoadedRouterRoute } = require('../utils/legacyRouterRoute');

const removedLegacySupplierRoutes = removeLoadedRouterRoute(
  require.resolve('./supplier'),
  '/request-review',
  'post'
);
if (removedLegacySupplierRoutes > 0) {
  logger.info('[review-requests] Disabled obsolete false-success /request-review handler');
}

const REVIEW_REQUEST_TTL_DAYS = 14;
const REVIEW_REQUEST_COOLDOWN_DAYS = 30;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const COOKIE_NAME = 'ef_review_request';
const ACTIVE_STATUSES = new Set(['pending', 'sent', 'opened']);

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDisplayName(value) {
  const normalized =
    typeof value === 'string'
      ? value
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 120)
      : '';
  return normalized || 'Your supplier';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isExpired(request, now) {
  const expiry = request && request.expiresAt ? new Date(request.expiresAt) : null;
  return !expiry || Number.isNaN(expiry.getTime()) || expiry <= now;
}

function getCompletedCooldownEnd(request) {
  const completedAt = request && (request.completedAt || request.createdAt);
  const completedDate = completedAt ? new Date(completedAt) : null;
  if (!completedDate || Number.isNaN(completedDate.getTime())) {
    return null;
  }
  return new Date(
    completedDate.getTime() + REVIEW_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  );
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
  return `/supplier?id=${encodeURIComponent(supplierId)}&reviewRequest=${encodeURIComponent(
    state
  )}#sp-section-reviews`;
}

function secureRedirect(res, location) {
  res.set({
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
  });
  return res.redirect(302, location);
}

async function getRecipientRequestState(db, supplierId, customerEmail, now) {
  const requests = await db.find('reviewRequests', {
    supplierId,
    customerEmail,
  });
  const sorted = (requests || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const recentCompleted = sorted.find(request => {
    if (request.status !== 'completed') {
      return false;
    }
    const cooldownEnd = getCompletedCooldownEnd(request);
    return !cooldownEnd || cooldownEnd > now;
  });

  return {
    latest: sorted[0],
    recentCompleted,
  };
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
  const createToken =
    overrides.createToken || (() => crypto.randomBytes(TOKEN_BYTES).toString('hex'));
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

      const supplier = await db.findOne('suppliers', {
        ownerUserId: req.user.id,
      });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const { latest, recentCompleted } = await getRecipientRequestState(
        db,
        supplier.id,
        customerEmail,
        currentTime
      );
      if (recentCompleted) {
        const retryAt = getCompletedCooldownEnd(recentCompleted);
        return res.status(409).json({
          error: `This customer has reviewed your business within the last ${REVIEW_REQUEST_COOLDOWN_DAYS} days`,
          status: recentCompleted.status,
          retryAt: retryAt ? retryAt.toISOString() : undefined,
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
      const supplierName = normalizeDisplayName(supplier.name);
      const requestDocument = {
        id: requestId,
        supplierId: supplier.id,
        supplierOwnerUserId: req.user.id,
        supplierName,
        customerEmail,
        customerName,
        threadId,
        tokenHash: hashToken(rawToken),
        status: 'pending',
        createdAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      const inserted = await db.insertOne('reviewRequests', requestDocument);
      if (!inserted) {
        throw new Error('Failed to create review request');
      }

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
      const tracked = await db.updateOne(
        'reviewRequests',
        { id: requestId },
        {
          $set: {
            status: 'sent',
            deliveryStatus: 'sent',
            sentAt,
            updatedAt: sentAt,
            deliveryProvider: delivery.provider || 'postmark',
            providerMessageId: delivery.PostmarkMessageID || delivery.MessageID || null,
            emailLogId: delivery.emailLogId || null,
          },
        }
      );
      if (!tracked) {
        logger.error('Review request email sent but tracking state could not be updated', {
          requestId,
        });
      }

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
                deliveryStatus: 'failed',
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
      return secureRedirect(res, safeSupplierRedirect(null, 'invalid'));
    }

    try {
      const request = await db.findOne('reviewRequests', {
        tokenHash: hashToken(rawToken),
      });
      if (!request) {
        return secureRedirect(res, safeSupplierRedirect(null, 'invalid'));
      }

      const currentTime = now();
      if (request.status === 'completed') {
        return secureRedirect(res, safeSupplierRedirect(request.supplierId, 'completed'));
      }
      if (request.status === 'failed') {
        return secureRedirect(res, safeSupplierRedirect(request.supplierId, 'unavailable'));
      }
      if (request.status === 'expired' || isExpired(request, currentTime)) {
        if (request.status !== 'expired') {
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
        }
        return secureRedirect(res, safeSupplierRedirect(request.supplierId, 'expired'));
      }
      if (!ACTIVE_STATUSES.has(request.status)) {
        return secureRedirect(res, safeSupplierRedirect(request.supplierId, 'unavailable'));
      }

      if (request.status === 'sent' || request.status === 'pending') {
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

      return secureRedirect(res, safeSupplierRedirect(request.supplierId, 'ready'));
    } catch (error) {
      logger.error('GET /review-request error:', error.message);
      return secureRedirect(res, safeSupplierRedirect(null, 'error'));
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
      const request = await db.findOne('reviewRequests', {
        tokenHash: hashToken(rawToken),
      });
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
          let completionHandled = false;
          res.json = body => {
            if (completionHandled || res.statusCode >= 400 || !body || !body.success) {
              return originalJson(body);
            }

            completionHandled = true;
            const completedAt = now().toISOString();
            const reviewId =
              (body.review && (body.review.id || body.review._id || body.review.reviewId)) ||
              body.reviewId ||
              null;

            return Promise.resolve(
              db.updateOne(
                'reviewRequests',
                { id: request.id },
                {
                  $set: {
                    status: 'completed',
                    completedAt,
                    completedByUserId: req.user.id,
                    updatedAt: completedAt,
                    reviewId,
                  },
                }
              )
            )
              .then(updated => {
                if (!updated) {
                  logger.error('Review submitted but request completion was not persisted', {
                    requestId: request.id,
                  });
                }
                res.clearCookie(COOKIE_NAME, { path: '/' });
                return originalJson(body);
              })
              .catch(updateError => {
                logger.error('Failed to complete review request attribution:', updateError.message);
                res.clearCookie(COOKIE_NAME, { path: '/' });
                return originalJson(body);
              });
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
  REVIEW_REQUEST_COOLDOWN_DAYS,
  REVIEW_REQUEST_TTL_DAYS,
};
module.exports.hashToken = hashToken;
module.exports.normalizeDisplayName = normalizeDisplayName;
module.exports.normalizeEmail = normalizeEmail;
