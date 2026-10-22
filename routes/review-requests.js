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
const {
  authRequired,
  requireVerifiedUser,
  requireApprovedSupplier,
} = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { sendMail, FROM_HELLO } = require('../utils/postmark');
const { removeLoadedRouterRoute } = require('../utils/legacyRouterRoute');
const reviewRequestOperations = require('../utils/reviewRequestOperations');
const { addPublicProfilePath } = require('../utils/publicSupplierProfilePath');

const removedLegacySupplierRoutes = removeLoadedRouterRoute(
  require.resolve('./supplier'),
  '/request-review',
  'post'
);
if (removedLegacySupplierRoutes > 0) {
  logger.info('[review-requests] Disabled obsolete false-success /request-review handler');
}

const REVIEW_REQUEST_TTL_DAYS = 14;
// A review request is an email from EventFlow to an address the supplier typed, so a supplier can
// only send so many a day (the per-IP write limiter does not stop one account sending to many).
const MAX_REVIEW_REQUESTS_PER_DAY = 30;
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

function createActiveRequestId(supplierId, customerEmail) {
  const reservationHash = crypto
    .createHash('sha256')
    .update(`${supplierId}\0${customerEmail}`)
    .digest('hex');
  return `rreq_active_${reservationHash}`;
}

function createHistoricalRequestId() {
  return `rreq_${crypto.randomUUID()}`;
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
  return new Date(completedDate.getTime() + REVIEW_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
}

function getRequestBaseUrl(req) {
  const configured = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

function safeSupplierRedirect(supplier, state) {
  const publicProfilePath = supplier ? addPublicProfilePath(supplier).publicProfilePath : null;
  if (!publicProfilePath) {
    return `/suppliers?reviewRequest=${encodeURIComponent(state)}`;
  }
  return `${publicProfilePath}?reviewRequest=${encodeURIComponent(state)}#sp-section-reviews`;
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

/**
 * Read the customer details out of a review-request body.
 *
 * @param {Object} body - Request body
 * @returns {{customerEmail: string, customerName: string, threadId: (string|null)}} Cleaned input
 */
function parseRequestInput(body) {
  const customerName =
    typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 100) : '';
  const threadId =
    typeof body.threadId === 'string' && body.threadId.trim()
      ? body.threadId.trim().slice(0, 200)
      : null;
  return { customerEmail: normalizeEmail(body.customerEmail), customerName, threadId };
}

/**
 * Whether an address looks like an email address.
 *
 * @param {string} email - Normalised address
 * @returns {boolean} True when it can be sent to
 */
function isValidCustomerEmail(email) {
  return Boolean(email) && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Find a reason this customer cannot be sent another request, and retire an expired one.
 *
 * @param {Object} db - Database adapter
 * @param {string} supplierId - Supplier id
 * @param {string} customerEmail - Normalised customer email
 * @param {Date} currentTime - Reference time
 * @returns {Promise<Object|null>} The 409 response body, or null when a new request may go out
 */
async function findRequestConflict(db, supplierId, customerEmail, currentTime) {
  const { latest, recentCompleted } = await getRecipientRequestState(
    db,
    supplierId,
    customerEmail,
    currentTime
  );
  if (recentCompleted) {
    const retryAt = getCompletedCooldownEnd(recentCompleted);
    return {
      error: `This customer has reviewed your business within the last ${REVIEW_REQUEST_COOLDOWN_DAYS} days`,
      status: recentCompleted.status,
      retryAt: retryAt ? retryAt.toISOString() : undefined,
    };
  }
  if (!latest || !ACTIVE_STATUSES.has(latest.status)) {
    return null;
  }
  if (!isExpired(latest, currentTime)) {
    return {
      error: 'An active review request has already been sent to this customer',
      status: latest.status,
      expiresAt: latest.expiresAt,
    };
  }
  await db.updateOne(
    'reviewRequests',
    { id: latest.id },
    {
      $set: {
        id: createHistoricalRequestId(),
        status: 'expired',
        expiredAt: currentTime.toISOString(),
        updatedAt: currentTime.toISOString(),
      },
    }
  );
  return null;
}

/**
 * Claim the request id for this supplier and customer.
 *
 * @param {Object} db - Database adapter
 * @param {Object} requestDocument - The new request record
 * @param {Date} currentTime - Reference time
 * @returns {Promise<Object|null>} The 409 response body when another request got there first, else null
 * @throws {Error} When the record could not be stored
 */
async function reserveRequest(db, requestDocument, currentTime) {
  const inserted = await db.insertOne('reviewRequests', requestDocument);
  if (inserted) {
    return null;
  }
  const competingRequest = await db.findOne('reviewRequests', { id: requestDocument.id });
  if (
    competingRequest &&
    ACTIVE_STATUSES.has(competingRequest.status) &&
    !isExpired(competingRequest, currentTime)
  ) {
    return {
      error: 'An active review request has already been sent to this customer',
      status: competingRequest.status,
      expiresAt: competingRequest.expiresAt,
    };
  }
  throw new Error('Failed to reserve review request');
}

/**
 * The stored record for a new review request.
 *
 * @param {Object} params - { requestId, supplier, ownerUserId, input, rawToken, currentTime, expiresAt }
 * @returns {Object} Request document
 */
function buildRequestDocument({
  requestId,
  supplier,
  ownerUserId,
  input,
  rawToken,
  currentTime,
  expiresAt,
}) {
  return {
    id: requestId,
    supplierId: supplier.id,
    supplierOwnerUserId: ownerUserId,
    supplierName: normalizeDisplayName(supplier.name),
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    threadId: input.threadId,
    tokenHash: hashToken(rawToken),
    status: 'pending',
    createdAt: currentTime.toISOString(),
    updatedAt: currentTime.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * The invitation email for a review request.
 *
 * @param {Object} params - { requestDocument, customerName, reviewLink, fromAddress }
 * @returns {Object} Mail options
 */
function buildReviewEmail({ requestDocument, customerName, reviewLink, fromAddress }) {
  return {
    to: requestDocument.customerEmail,
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
  };
}

/**
 * Record that the invitation went out.
 *
 * @param {Object} db - Database adapter
 * @param {string} requestId - Request id
 * @param {Object} delivery - The mail provider's result
 * @param {Date} currentTime - Reference time
 * @returns {Promise<string>} The time the email was sent
 */
async function recordSent(db, requestId, delivery, currentTime) {
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
  return sentAt;
}

/**
 * Record that a reserved request could not be delivered.
 *
 * @param {Object} db - Database adapter
 * @param {string} requestId - Request id
 * @param {Date} currentTime - Reference time
 * @param {Error} error - What went wrong
 * @returns {Promise<void>}
 */
async function recordDeliveryFailure(db, requestId, currentTime, error) {
  try {
    await db.updateOne(
      'reviewRequests',
      { id: requestId },
      {
        $set: {
          id: createHistoricalRequestId(),
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

function createReviewRequestRouter(overrides = {}) {
  const router = express.Router();
  const db = overrides.db || dbUnified;
  const send = overrides.sendMail || sendMail;
  const fromAddress = overrides.fromAddress || FROM_HELLO;
  const authenticate = overrides.authRequired || authRequired;
  // Sending a review request emails an arbitrary address on the platform's behalf, so it is
  // gated exactly like the other supplier write routes (packages, messaging): the account's
  // email must be verified and the supplier profile approved. Both middlewares reply with a
  // structured 403 (`EMAIL_NOT_VERIFIED` / `SUPPLIER_NOT_APPROVED`).
  const requireVerifiedEmail = overrides.requireVerifiedUser || requireVerifiedUser;
  const requireApproval = overrides.requireApprovedSupplier || requireApprovedSupplier;
  const protectCsrf = overrides.csrfProtection || csrfProtection;
  const limitWrites = overrides.writeLimiter || writeLimiter;
  const now = overrides.now || (() => new Date());
  const createToken =
    overrides.createToken || (() => crypto.randomBytes(TOKEN_BYTES).toString('hex'));
  const baseUrlFor = overrides.getBaseUrl || getRequestBaseUrl;

  const historyPaths = ['/api/v1/supplier/review-requests', '/api/supplier/review-requests'];
  router.get(historyPaths, authenticate, async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'supplier') {
        return res.status(403).json({ error: 'Suppliers only' });
      }

      const supplier = await db.findOne('suppliers', {
        ownerUserId: req.user.id,
      });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const requests = await db.find('reviewRequests', {
        supplierId: supplier.id,
      });
      return res.json({
        ok: true,
        ...reviewRequestOperations.listSupplierRequests(requests || [], req.query, now()),
      });
    } catch (error) {
      logger.error('GET /supplier/review-requests error:', error.message);
      return res.status(500).json({ error: 'Unable to load review request activity' });
    }
  });

  const postPaths = ['/api/v1/supplier/request-review', '/api/supplier/request-review'];

  // CSRF and rate limiting first, so a forged or flooding request costs no database reads.
  const postGuards = [
    authenticate,
    protectCsrf,
    limitWrites,
    requireVerifiedEmail,
    requireApproval,
  ];

  router.post(postPaths, postGuards, async (req, res) => {
    const currentTime = now();
    let requestId = null;
    let reservationAcquired = false;

    try {
      if (req.user.role !== 'supplier') {
        return res.status(403).json({ error: 'Suppliers only' });
      }

      const input = parseRequestInput(req.body);
      if (!isValidCustomerEmail(input.customerEmail)) {
        return res.status(400).json({ error: 'A valid customer email is required' });
      }

      const supplier = await db.findOne('suppliers', {
        ownerUserId: req.user.id,
      });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const sentToday =
        (await db.find('reviewRequests', {
          supplierId: supplier.id,
          createdAt: { $gte: new Date(currentTime.getTime() - 24 * 60 * 60 * 1000).toISOString() },
        })) || [];
      // A request whose email could not be delivered sent nothing, so it does not use up the cap
      // (a mail outage must not lock a supplier out for the day).
      if (
        sentToday.filter(request => request.status !== 'failed').length >=
        MAX_REVIEW_REQUESTS_PER_DAY
      ) {
        return res.status(429).json({
          error: `You can send up to ${MAX_REVIEW_REQUESTS_PER_DAY} review requests a day. Try again tomorrow.`,
        });
      }

      const existing = await findRequestConflict(db, supplier.id, input.customerEmail, currentTime);
      if (existing) {
        return res.status(409).json(existing);
      }

      const rawToken = createToken();
      if (!TOKEN_PATTERN.test(rawToken)) {
        throw new Error('Review request token generator returned an invalid token');
      }

      requestId = createActiveRequestId(supplier.id, input.customerEmail);
      const expiresAt = new Date(
        currentTime.getTime() + REVIEW_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000
      );
      const reviewLink = `${baseUrlFor(req)}/review-request?token=${encodeURIComponent(rawToken)}`;
      const requestDocument = buildRequestDocument({
        requestId,
        supplier,
        ownerUserId: req.user.id,
        input,
        rawToken,
        currentTime,
        expiresAt,
      });

      const competing = await reserveRequest(db, requestDocument, currentTime);
      if (competing) {
        return res.status(409).json(competing);
      }
      reservationAcquired = true;

      const delivery = await send(
        buildReviewEmail({
          requestDocument,
          customerName: input.customerName,
          reviewLink,
          fromAddress,
        })
      );
      const sentAt = await recordSent(db, requestId, delivery, currentTime);

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
      if (requestId && reservationAcquired) {
        await recordDeliveryFailure(db, requestId, currentTime, error);
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
        return secureRedirect(
          res,
          safeSupplierRedirect({ id: request.supplierId, name: request.supplierName }, 'completed')
        );
      }
      if (request.status === 'failed') {
        return secureRedirect(
          res,
          safeSupplierRedirect(
            { id: request.supplierId, name: request.supplierName },
            'unavailable'
          )
        );
      }
      if (request.status === 'expired' || isExpired(request, currentTime)) {
        if (request.status !== 'expired') {
          await db.updateOne(
            'reviewRequests',
            { id: request.id },
            {
              $set: {
                id: createHistoricalRequestId(),
                status: 'expired',
                expiredAt: currentTime.toISOString(),
                updatedAt: currentTime.toISOString(),
              },
            }
          );
        }
        return secureRedirect(
          res,
          safeSupplierRedirect({ id: request.supplierId, name: request.supplierName }, 'expired')
        );
      }
      if (!ACTIVE_STATUSES.has(request.status)) {
        return secureRedirect(
          res,
          safeSupplierRedirect(
            { id: request.supplierId, name: request.supplierName },
            'unavailable'
          )
        );
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

      return secureRedirect(
        res,
        safeSupplierRedirect({ id: request.supplierId, name: request.supplierName }, 'ready')
      );
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
                    id: createHistoricalRequestId(),
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
module.exports.createActiveRequestId = createActiveRequestId;
module.exports.hashToken = hashToken;
module.exports.normalizeDisplayName = normalizeDisplayName;
module.exports.normalizeEmail = normalizeEmail;
