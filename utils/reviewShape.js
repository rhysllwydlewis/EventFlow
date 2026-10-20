/**
 * Review shape adapter
 *
 * Two generations of writers share the `reviews` collection:
 *
 *   - v2 (services/reviewService.js, POST /api/v2/reviews): `_id`, `authorId`,
 *     `text`, `verification`, `moderation.state`, `response`
 *   - legacy (reviews.js, the live public form POST /api/suppliers/:id/reviews):
 *     `id`, `userId`, `userName`, `comment`, `approved` / `flagged` / `approvedBy`,
 *     no `moderation`, no `response`
 *
 * Every reader that decides what a supplier sees (the dashboard review list, the
 * summary counts and average, the stats endpoint, replies) must agree on which
 * reviews are published and what their fields are. This module is that one
 * agreement. It never loosens moderation: only an explicitly approved review is
 * `approved`; anything awaiting a decision is `pending`; a moderator's rejection
 * (or a record in an unrecognised state) is never counted.
 */

'use strict';

const STATES = Object.freeze({
  APPROVED: 'approved',
  PENDING: 'pending',
  REJECTED: 'rejected',
  OTHER: 'other',
});

/**
 * Whether a stored review is in the v2 shape (it carries a moderation object).
 *
 * @param {Object} doc - Stored review
 * @returns {boolean} True for v2 documents
 */
function isV2Review(doc) {
  return Boolean(doc && doc.moderation && typeof doc.moderation === 'object');
}

/**
 * Publication state of a review, whichever shape it is stored in.
 *
 * v2: `moderation.state` is authoritative ('approved' | 'pending' | 'rejected';
 * changes-requested and dispute states are `other` and are not published).
 * Legacy: `approved === true` is published. Otherwise a moderator's decision is
 * recorded in `approvedBy`, so a decided-against review is `rejected` and an
 * undecided one (including spam-flagged ones awaiting moderation) is `pending`.
 *
 * @param {Object} doc - Stored review
 * @returns {'approved'|'pending'|'rejected'|'other'} State
 */
function reviewState(doc) {
  if (!doc || typeof doc !== 'object') {
    return STATES.OTHER;
  }
  if (isV2Review(doc)) {
    switch (doc.moderation.state) {
      case 'approved':
        return STATES.APPROVED;
      case 'pending':
        return STATES.PENDING;
      case 'rejected':
        return STATES.REJECTED;
      default:
        return STATES.OTHER;
    }
  }
  if (doc.approved === true) {
    return STATES.APPROVED;
  }
  return doc.approvedBy ? STATES.REJECTED : STATES.PENDING;
}

/**
 * Whether a review is published (counts towards ratings and appears in lists).
 *
 * @param {Object} doc - Stored review
 * @returns {boolean} True only for approved reviews
 */
function isApprovedReview(doc) {
  return reviewState(doc) === STATES.APPROVED;
}

/**
 * A usable star rating (1-5), or null.
 *
 * @param {Object} doc - Stored review
 * @returns {number|null} Rating
 */
function reviewRating(doc) {
  const rating = Number(doc && doc.rating);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

/**
 * The supplier's reply, from either field name.
 *
 * @param {Object} doc - Stored review
 * @returns {{text: string, respondedAt: (string|null), updatedAt: (string|null)}|null} Reply
 */
function reviewResponse(doc) {
  const stored = doc && (doc.response || doc.supplierResponse);
  if (!stored || !stored.text) {
    return null;
  }
  return {
    text: String(stored.text),
    respondedAt: stored.respondedAt || stored.createdAt || null,
    updatedAt: stored.updatedAt || null,
  };
}

/**
 * Normalise a stored review to one shape. Contains no moderation internals,
 * IP data or account ids beyond `authorId`.
 *
 * @param {Object} doc - Stored review (either shape)
 * @returns {Object} Normalised review
 */
function normaliseReview(doc) {
  const v2 = isV2Review(doc);
  return {
    id: String(doc._id || doc.id || ''),
    shape: v2 ? 'v2' : 'legacy',
    supplierId: doc.supplierId || null,
    authorId: doc.authorId || doc.userId || null,
    authorName: doc.userName || doc.authorName || null,
    rating: reviewRating(doc),
    title: doc.title || '',
    text: doc.text || doc.comment || '',
    createdAt: doc.createdAt || null,
    state: reviewState(doc),
    verified: v2
      ? Boolean(doc.verification && doc.verification.status !== 'unverified')
      : doc.verified === true,
    response: reviewResponse(doc),
  };
}

/**
 * Whether a stored id refers to this review (legacy `id` or v2 `_id`).
 *
 * @param {Object} doc - Stored review
 * @param {string} reviewId - Id from a URL
 * @returns {boolean} True when it is the same review
 */
function reviewHasId(doc, reviewId) {
  const wanted = String(reviewId);
  return (
    (doc._id !== undefined && String(doc._id) === wanted) ||
    (doc.id !== undefined && String(doc.id) === wanted)
  );
}

module.exports = {
  STATES,
  isV2Review,
  reviewState,
  isApprovedReview,
  reviewRating,
  reviewResponse,
  normaliseReview,
  reviewHasId,
};
