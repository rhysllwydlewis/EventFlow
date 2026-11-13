/**
 * Public shape for a package shown on the homepage carousels.
 *
 * The featured and spotlight endpoints are unauthenticated and used to spread
 * the whole stored document into the response. That published fields no
 * visitor has any use for: the database `_id`, the full edit history
 * (`versionHistory`, including who edited and what the listing said before)
 * and the internal user id of the last editor. Supplier-entered fields are
 * left alone, so existing consumers keep working — only bookkeeping goes.
 */

'use strict';

const INTERNAL_PACKAGE_FIELDS = Object.freeze([
  '_id',
  'versionHistory',
  'lastEditedBy',
  'editedBy',
  'approvedBy',
  'rejectedBy',
  'rejectionReason',
  'moderationNotes',
  'adminNotes',
  'isTest',
]);

/**
 * @param {Object} pkg - Stored package document
 * @param {Object} [extra] - Derived fields to add (resolved image, supplier name)
 * @returns {Object} A copy safe to send to anonymous visitors
 */
function toPublicPackageCard(pkg, extra = {}) {
  const card = { ...(pkg || {}) };
  for (const field of INTERNAL_PACKAGE_FIELDS) {
    delete card[field];
  }
  return { ...card, ...extra };
}

module.exports = { toPublicPackageCard, INTERNAL_PACKAGE_FIELDS };
