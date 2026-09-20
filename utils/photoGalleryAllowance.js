/**
 * Shared supplier gallery photo allowance helpers.
 *
 * Used by every route that adds photos to a supplier's gallery
 * (routes/photos.js and routes/suppliers-v2.js) so the plan-based limit is
 * enforced the same way everywhere, instead of one route consulting the
 * subscription plan and another falling back to a hard-coded ceiling that
 * silently reintroduces the "every tier capped at ten" bug the plan-based
 * allowance was built to fix.
 */

'use strict';

/**
 * Reject a gallery upload that would take a supplier past their plan's photo
 * allowance.
 *
 * The browser caps uploads too, but the browser cap is advisory: it is the
 * only thing that used to stand between a free profile and an unlimited
 * gallery, and it applied the same ten-photo ceiling to every tier whatever
 * the plan promised. The allowance is resolved from the supplier's owner, not
 * the uploader, so an admin uploading on someone's behalf gets that
 * supplier's limit rather than their own.
 *
 * @param {Object} supplier Supplier record.
 * @param {number} incoming How many photos this request would add.
 * @returns {Promise<{allowed: boolean, limit: number, current: number}>} Outcome.
 */
async function checkPhotoAllowance(supplier, incoming) {
  const subscriptionService = require('../services/subscriptionService');
  const limit = await subscriptionService.getPhotoAllowance(supplier.ownerUserId);
  // Photos hidden by a downgrade (subscriptionService.enforcePhotoGalleryLimit)
  // don't count toward the allowance, the same way a paused package doesn't
  // count toward the active package limit — otherwise a supplier who
  // downgraded could never upload again until manually deleting old photos.
  const current = Array.isArray(supplier.photosGallery)
    ? supplier.photosGallery.filter(p => !p?.hiddenByPlanLimit).length
    : 0;
  if (limit === -1) {
    return { allowed: true, limit, current };
  }
  return { allowed: current + incoming <= limit, limit, current };
}

/**
 * Build the response for an upload that exceeds the plan allowance.
 * @param {number} limit Photo allowance.
 * @param {number} current Photos already in the gallery.
 * @returns {Object} JSON body.
 */
function photoLimitError(limit, current) {
  return {
    error: `Your plan includes up to ${limit} photos. You currently have ${current}.`,
    code: 'PHOTO_LIMIT_REACHED',
    limit,
    current,
  };
}

module.exports = { checkPhotoAllowance, photoLimitError };
