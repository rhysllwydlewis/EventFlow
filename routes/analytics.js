/**
 * Analytics Routes
 * Lightweight event tracking for user behavior analytics
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const dbUnified = require('../db-unified');
const { getUserFromCookie, authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const validator = require('validator');
const supplierAnalytics = require('../utils/supplierAnalytics');
const profileViewKeys = require('../utils/profileViewKeys');

// In-memory rate limit store for POST /track (IP+supplierId, 1 view per hour)
const trackRateLimitCache = new Map();
// Periodic cleanup every 30 minutes to prevent unbounded memory growth
setInterval(
  () => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [k, v] of trackRateLimitCache) {
      if (v < cutoff) {
        trackRateLimitCache.delete(k);
      }
    }
  },
  30 * 60 * 1000
).unref();

/**
 * Cheap per-process guard for enquiry beacons: at most one per IP per supplier per hour.
 * (Profile views use the database check in the route instead, which works across
 * instances and restarts.)
 *
 * @param {string} ip - Request IP
 * @param {string} supplierId - Supplier id
 * @param {string} type - Event type
 * @returns {boolean} True when the event should be dropped
 */
function isTrackRateLimited(ip, supplierId, type) {
  if (!ip) {
    return false; // Skip rate limiting when IP is unavailable
  }
  const key = `${ip}:${supplierId}:${type}`;
  const now = Date.now();
  const last = trackRateLimitCache.get(key);
  if (last && now - last < 60 * 60 * 1000) {
    return true;
  }
  trackRateLimitCache.set(key, now);
  return false;
}

const PROFILE_VIEW_DEDUPE_MS = 60 * 60 * 1000;
// Most counted views one network address can add to one supplier in an hour. A visitor key alone
// cannot stop someone minting new keys, so this caps the address as well. It is a trade-off: a
// busy shared address (an office, a mobile carrier) can undercount, which is safer than letting
// one client inflate a supplier's numbers. 20 leaves room for a real office or venue while
// keeping one client's reach bounded. Set PROFILE_VIEW_IP_CAP to tune it (an environment change,
// so it takes a restart). The cap applies to anonymous visitors only; a signed-in visitor is
// already one account and has no address-derived value stored. How well it separates clients
// depends on `req.ip` being the real client address (utils/trustProxy.js, used by server.js, looks past Cloudflare).
// The counters live in their own collection and expire after two hours (PROFILE_VIEW_CAP_TTL_MS).
const PROFILE_VIEW_CAP_COLLECTION = 'profile_view_caps';
const PROFILE_VIEW_CAP_TTL_MS = 2 * 60 * 60 * 1000;
const PROFILE_VIEW_IP_CAP =
  parseInt(process.env.PROFILE_VIEW_IP_CAP, 10) > 0
    ? parseInt(process.env.PROFILE_VIEW_IP_CAP, 10)
    : 20;
const AUTOMATED_CLIENT_PATTERN =
  /bot|crawler|spider|crawl|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|monitor/i;

/**
 * Whether a profile page load should not count as a visit: the supplier's own
 * session, an admin, or a client that identifies itself as automated.
 *
 * @param {Object} req - Express request
 * @param {Object|null} user - Signed-in user, if any
 * @param {Object} supplier - The supplier whose page was loaded
 * @returns {boolean} True when the view is not a visit
 */
function isUncountedViewer(req, user, supplier) {
  if (
    user &&
    (user.role === 'admin' || (supplier.ownerUserId && user.id === supplier.ownerUserId))
  ) {
    return true;
  }
  return AUTOMATED_CLIENT_PATTERN.test(req.get('user-agent') || '');
}

/**
 * The coarse kind of browser a user-agent string describes, e.g. "chrome/windows".
 *
 * Only the family counts towards "the same visitor", never the full string, so changing the
 * version number or appending text to the user-agent does not make a new visitor.
 *
 * @param {string} userAgent - Raw user-agent header
 * @returns {string} "<browser>/<os>", each "other" when not recognised
 */
function userAgentFamily(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  let browser = 'other';
  if (/edg(e|a|ios)?\//.test(ua)) {
    browser = 'edge';
  } else if (/opr\/|opera/.test(ua)) {
    browser = 'opera';
  } else if (/firefox|fxios/.test(ua)) {
    browser = 'firefox';
  } else if (/chrome|chromium|crios/.test(ua)) {
    browser = 'chrome';
  } else if (/safari/.test(ua)) {
    browser = 'safari';
  }
  let os = 'other';
  if (/iphone|ipad|ipod/.test(ua)) {
    os = 'ios';
  } else if (/android/.test(ua)) {
    os = 'android';
  } else if (/windows/.test(ua)) {
    os = 'windows';
  } else if (/mac os|macintosh/.test(ua)) {
    os = 'mac';
  } else if (/cros/.test(ua)) {
    os = 'chromeos';
  } else if (/linux|x11/.test(ua)) {
    os = 'linux';
  }
  return `${browser}/${os}`;
}

/**
 * Give back a cap slot that was taken but not used, so the counter stays equal to the views
 * counted (a burst of repeats or rejected requests must not eat the room of real visitors).
 *
 * @param {string} capKey - Counter row key
 * @returns {Promise<void>}
 */
async function releaseCapSlot(capKey) {
  try {
    await dbUnified.incrementCounter(PROFILE_VIEW_CAP_COLLECTION, capKey, { by: -1 });
  } catch (error) {
    logger.debug('Could not release a profile view cap slot:', error);
  }
}

/**
 * Stable anonymous key for "the same visitor": the signed-in account if there is one, otherwise an
 * HMAC (under a server secret) of the address and the browser family. The raw address is never
 * stored and the key cannot be reversed by trying every address; an IPv6 address counts as its /64.
 *
 * @param {Object} req - Express request
 * @param {Object|null} user - Signed-in user, if any
 * @returns {string} Visitor key, or '' when an anonymous visitor cannot be keyed (no secret set)
 */
function visitorKeyFor(req, user) {
  if (user?.id) {
    return `u:${user.id}`;
  }
  return profileViewKeys.anonymousVisitorKey(req.ip, userAgentFamily(req.get('user-agent')));
}

// Whitelist of allowed event types
const ALLOWED_EVENTS = [
  'search_performed',
  'filter_changed',
  'result_clicked',
  'shortlist_add',
  'shortlist_remove',
  'quote_request_started',
  'quote_request_submitted',
];

// Whitelist of allowed property keys (prevent arbitrary data)
const ALLOWED_PROPERTY_KEYS = [
  'query',
  'filters',
  'resultsCount',
  'source',
  'filterName',
  'filterValue',
  'resultType',
  'resultId',
  'position',
  'itemType',
  'itemId',
  'supplierCount',
  'eventType',
  'category',
  'location',
];

// Maximum string length for property values
const MAX_STRING_LENGTH = 500;

/**
 * Sanitize and validate analytics properties
 */
function sanitizeProperties(properties) {
  if (!properties || typeof properties !== 'object') {
    return {};
  }

  const sanitized = {};

  for (const key of ALLOWED_PROPERTY_KEYS) {
    if (properties[key] !== undefined) {
      let value = properties[key];

      // Truncate strings to prevent huge payloads
      if (typeof value === 'string') {
        value = value.slice(0, MAX_STRING_LENGTH);
        // Don't include raw query strings with potential PII
        // Only store sanitized/truncated versions
        sanitized[key] = validator.escape(value);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (typeof value === 'object') {
        // For nested objects (like filters), limit depth and sanitize
        if (key === 'filters') {
          sanitized[key] = sanitizeFilters(value);
        }
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize filter object
 */
function sanitizeFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  const sanitized = {};
  const allowedFilterKeys = ['category', 'location', 'budgetMin', 'budgetMax', 'sort'];

  for (const key of allowedFilterKeys) {
    if (filters[key] !== undefined) {
      const value = filters[key];
      if (typeof value === 'string') {
        sanitized[key] = validator.escape(value.slice(0, 100));
      } else if (typeof value === 'number') {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * POST /api/analytics/event
 * Track a user event
 * Rate limited to prevent abuse
 */
router.post('/event', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const { event, properties, timestamp } = req.body;

    // Validate event type
    if (!event || !ALLOWED_EVENTS.includes(event)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event type',
      });
    }

    // Get user if authenticated
    const user = await getUserFromCookie(req);

    // Sanitize properties to prevent PII leakage and huge payloads
    const sanitizedProperties = sanitizeProperties(properties);

    // Create analytics event
    const analyticsEvent = {
      event: validator.escape(event),
      properties: sanitizedProperties,
      userId: user?.id || null,
      timestamp: timestamp || new Date().toISOString(),
      userAgent: req.headers['user-agent'],
      // Store IP separately (not in event properties) for rate limiting only
      ip: req.ip,
    };

    // Store event
    const analyticsEvents = (await dbUnified.read('analyticsEvents')) || [];
    analyticsEvents.push(analyticsEvent);

    // Keep only last N events to prevent unbounded growth in local storage
    // Configurable via env var, defaults to 10000
    const maxEvents = parseInt(process.env.MAX_ANALYTICS_EVENTS, 10) || 10000;
    if (analyticsEvents.length > maxEvents) {
      // Trim the oldest events - in MongoDB this is handled by TTL indexes
      analyticsEvents.splice(0, analyticsEvents.length - maxEvents);
      await dbUnified.write('analyticsEvents', analyticsEvents);
    } else {
      const analyticsInserted = await dbUnified.insertOne('analyticsEvents', analyticsEvent);
      if (!analyticsInserted) {
        logger.warn('[ANALYTICS] event insertOne failed — non-critical');
      }
    }

    // Respond immediately (don't block on write)
    res.json({
      success: true,
      message: 'Event tracked',
    });
  } catch (error) {
    // Fail silently - analytics should never break UX
    logger.debug('Analytics tracking error:', error);
    res.json({
      success: true,
      message: 'Event received',
    });
  }
});

/**
 * GET /api/analytics/events
 * Get analytics events (admin only - will be protected by admin middleware in future)
 */
router.get('/events', async (req, res) => {
  try {
    const user = await getUserFromCookie(req);

    // Basic admin check - in production, use proper roleRequired middleware
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required',
      });
    }

    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const skip = Number(req.query.skip) || 0;
    const eventType = req.query.event;

    const analyticsEvents = (await dbUnified.read('analyticsEvents')) || [];
    let filteredEvents = analyticsEvents;

    // Filter by event type if specified
    if (eventType) {
      filteredEvents = filteredEvents.filter(e => e.event === eventType);
    }

    // Sort by timestamp descending
    filteredEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate
    const paginatedEvents = filteredEvents.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        events: paginatedEvents,
        total: filteredEvents.length,
        limit,
        skip,
      },
    });
  } catch (error) {
    logger.error('Get analytics events error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve analytics events',
    });
  }
});

/**
 * POST /api/analytics/lead-score (P4-04: Predictive Lead Scoring)
 * Calculate lead quality score for an enquiry
 */
router.post('/lead-score', authRequired, csrfProtection, (req, res) => {
  try {
    const { enquiry } = req.body;

    if (!enquiry) {
      return res.status(400).json({ error: 'Enquiry data is required' });
    }

    let score = 0;
    const scoreBreakdown = {};

    // Message length (more detailed = higher intent)
    if (enquiry.message) {
      const messageLength = enquiry.message.length;
      if (messageLength > 200) {
        score += 20;
        scoreBreakdown.messageLength = { points: 20, reason: 'Detailed message (>200 chars)' };
      } else if (messageLength > 100) {
        score += 10;
        scoreBreakdown.messageLength = { points: 10, reason: 'Moderate message length' };
      } else {
        scoreBreakdown.messageLength = { points: 0, reason: 'Short message' };
      }
    }

    // Budget specified
    if (enquiry.budget) {
      score += 15;
      scoreBreakdown.budget = { points: 15, reason: 'Budget specified' };
    }

    // Event date specified (ready to book)
    if (enquiry.eventDate) {
      score += 25;
      scoreBreakdown.eventDate = { points: 25, reason: 'Event date provided' };

      // Urgency bonus (event within 3 months)
      const eventDate = new Date(enquiry.eventDate);
      const threeMonthsFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      if (eventDate < threeMonthsFromNow) {
        score += 10;
        scoreBreakdown.urgency = { points: 10, reason: 'Event within 3 months' };
      }
    }

    // Response time (enquiry recency - how long ago was it created)
    if (enquiry.createdAt) {
      const hoursSinceCreation = (Date.now() - new Date(enquiry.createdAt)) / (1000 * 60 * 60);

      if (hoursSinceCreation < 1) {
        score += 30;
        scoreBreakdown.enquiryRecency = { points: 30, reason: 'Very recent enquiry (<1 hour)' };
      } else if (hoursSinceCreation < 24) {
        score += 20;
        scoreBreakdown.enquiryRecency = { points: 20, reason: 'Recent enquiry (<24 hours)' };
      } else {
        score += 5;
        scoreBreakdown.enquiryRecency = { points: 5, reason: 'Older enquiry' };
      }
    }

    // Previous interactions (repeat customer)
    if (enquiry.isRepeatCustomer) {
      score += 20;
      scoreBreakdown.repeatCustomer = { points: 20, reason: 'Returning customer' };
    }

    // Guest count specified (shows planning)
    if (enquiry.guests) {
      score += 5;
      scoreBreakdown.guestCount = { points: 5, reason: 'Guest count provided' };
    }

    // Venue/location specified
    if (enquiry.location || enquiry.venue) {
      score += 5;
      scoreBreakdown.location = { points: 5, reason: 'Location/venue specified' };
    }

    // Cap score at 100
    score = Math.min(score, 100);

    // Determine quality tier
    let quality = 'low';
    if (score >= 70) {
      quality = 'high';
    } else if (score >= 40) {
      quality = 'medium';
    }

    res.json({
      success: true,
      leadScore: score,
      quality,
      scoreBreakdown,
      recommendations: getLeadRecommendations(score, quality, enquiry),
    });
  } catch (error) {
    logger.error('Lead scoring error:', error);
    res.status(500).json({
      error: 'Failed to calculate lead score',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get recommendations based on lead score
 */
function getLeadRecommendations(score, quality, enquiry) {
  const recommendations = [];

  if (quality === 'high') {
    recommendations.push('Priority response recommended - high conversion potential');
    recommendations.push('Offer premium packages or personalized service');
  } else if (quality === 'medium') {
    recommendations.push('Follow up within 24 hours');
    recommendations.push('Request more details to qualify further');
  } else {
    recommendations.push('Standard response timeframe acceptable');
    recommendations.push('Send informational materials and FAQ');
  }

  // Specific recommendations based on missing data
  if (!enquiry.budget) {
    recommendations.push('Ask about budget to better qualify');
  }
  if (!enquiry.eventDate) {
    recommendations.push('Request event date to assess urgency');
  }
  if (!enquiry.guests) {
    recommendations.push('Inquire about guest count for package matching');
  }

  return recommendations;
}

/**
 * Check a beacon body. Returns the cleaned values, or the error to answer with.
 *
 * @param {Object} body - Request body
 * @returns {{type: string, supplierId: string}|{error: string}} Cleaned values or an error message
 */
function readTrackBody(body) {
  const { type, supplierId } = body || {};
  if (!type || !['profile_view', 'enquiry'].includes(type)) {
    return { error: 'Invalid type. Must be profile_view or enquiry' };
  }
  if (!supplierId || typeof supplierId !== 'string' || supplierId.length > 100) {
    return { error: 'supplierId is required' };
  }
  // Only safe characters (alphanumeric, hyphens, underscores)
  const cleanSupplierId = supplierId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanSupplierId)) {
    return { error: 'Invalid supplierId format' };
  }
  return { type, supplierId: cleanSupplierId };
}

/**
 * Decide and record one profile view.
 *
 * @param {Object} req - Request
 * @param {Object|null} user - Signed-in visitor, if any
 * @param {Object} supplier - The supplier being viewed
 * @returns {Promise<string>} The message to answer with
 */
async function recordProfileView(req, user, supplier) {
  const cleanSupplierId = supplier.id;
  const userId = user ? user.id : null;
  // Not visits: the supplier looking at their own page, staff, and automated clients.
  if (isUncountedViewer(req, user, supplier)) {
    return 'Not counted';
  }
  const visitorKey = visitorKeyFor(req, user);
  if (!visitorKey) {
    // No secret to key an anonymous visitor with: count nothing rather than store a weak key.
    logger.warn('Profile view not counted: no JWT_SECRET or PROFILE_VIEW_SALT is configured');
    return 'Not counted';
  }
  const since = new Date(Date.now() - PROFILE_VIEW_DEDUPE_MS).toISOString();
  const recent = await dbUnified.count('events', {
    supplierId: cleanSupplierId,
    type: 'profile_view',
    visitorKey,
    timestamp: { $gte: since },
  });
  if (recent > 0) {
    return 'Already tracked';
  }
  // However many browsers an address pretends to be, it adds a bounded number of views. The
  // slot is taken with one atomic increment (so concurrent requests cannot all pass a read)
  // and given back if the visitor turns out to be counted already. Only anonymous visitors
  // are capped, and nothing derived from the address is kept on the event.
  const hourBucket = Math.floor(Date.now() / PROFILE_VIEW_DEDUPE_MS);
  const addressKey = userId ? '' : profileViewKeys.addressKey(req.ip);
  const capKey = addressKey ? `${cleanSupplierId}:${addressKey}:${hourBucket}` : '';
  if (capKey) {
    const used = await dbUnified.incrementCounter(PROFILE_VIEW_CAP_COLLECTION, capKey, {
      expiresAt: new Date(Date.now() + PROFILE_VIEW_CAP_TTL_MS),
      throwOnError: true,
    });
    if (used > PROFILE_VIEW_IP_CAP) {
      await releaseCapSlot(capKey);
      return 'Already tracked';
    }
  }
  // The read above is only a fast path. The unique dedupeKey makes the insert itself the
  // decision: of two beacons from one visitor at once, the database accepts one.
  const outcome = await supplierAnalytics.trackProfileView(
    cleanSupplierId,
    userId,
    null,
    false,
    visitorKey,
    { dedupeKey: `${cleanSupplierId}:${visitorKey}:${hourBucket}` }
  );
  if (!outcome?.recorded && capKey) {
    // Nothing was added (a duplicate, or the write failed): give the slot back.
    await releaseCapSlot(capKey);
  }
  return outcome?.duplicate ? 'Already tracked' : 'Event tracked';
}

/**
 * POST /api/analytics/track
 * Track profile views and enquiries per supplier
 * Profile views count once per visitor per hour; enquiry beacons once per IP per hour
 */
router.post('/track', writeLimiter, async (req, res) => {
  try {
    const body = readTrackBody(req.body);
    if (body.error) {
      return res.status(400).json({ success: false, error: body.error });
    }
    const { type, supplierId: cleanSupplierId } = body;

    // Enquiry beacons: max 1 per IP per supplier per hour. Profile views are limited per
    // visitor by the database check instead, so two browsers behind one address
    // (an office, a mobile network) are not merged into one.
    if (type !== 'profile_view' && isTrackRateLimited(req.ip, cleanSupplierId, type)) {
      return res.json({ success: true, message: 'Already tracked' });
    }

    // Get authenticated user if available
    const user = await getUserFromCookie(req);

    // Only real, public profiles have visitors.
    const supplier = await dbUnified.findOne('suppliers', { id: cleanSupplierId });
    if (!supplier || supplier.approved !== true) {
      return res.json({ success: true, message: 'Not tracked' });
    }

    if (type === 'profile_view') {
      return res.json({ success: true, message: await recordProfileView(req, user, supplier) });
    }
    await supplierAnalytics.trackEnquirySent(cleanSupplierId, user ? user.id : null);
    res.json({ success: true, message: 'Event tracked' });
  } catch (error) {
    // Fail silently — analytics should never break UX
    logger.debug('Analytics track error:', error);
    res.json({ success: true, message: 'Event received' });
  }
});

module.exports = router;
