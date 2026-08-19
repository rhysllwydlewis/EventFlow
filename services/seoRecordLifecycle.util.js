'use strict';

/**
 * Shared, dependency-free primitives for deciding whether a supplier or
 * package record is a real, live, addressable business listing.
 *
 * This module intentionally has zero internal EventFlow dependencies. Three
 * different places in the codebase (the public supplier/package SEO
 * services, the supplier directory ranking service and the location-page
 * eligibility check) each grew their own partial copy of "is this record
 * really public" — with different subsets of the same handful of checks.
 * That drift is exactly how a suspended or test/fixture record ends up
 * viewable and indexable in one surface while correctly excluded from
 * another (see SEO-002 in the SEO audit). Putting the primitives here, with
 * no dependency on anything that itself needs them, lets every one of those
 * modules — including services/seoEligibility.service.js, the shared policy
 * built on top of these primitives — import the same logic without forming
 * a require() cycle.
 */

/**
 * Strip markup and collapse whitespace, matching the light-touch sanitising
 * already used by the SEO services.
 * @param {*} value Raw value.
 * @returns {string} Plain text.
 */
function cleanText(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Matches "test" as a standalone word (case-insensitive) so "Romeo Test" and
// "test-no2-yy7lo4" are caught while an ordinary business name that merely
// contains the substring — "Contest Caterers", "Westerly Tents" — is not.
const WHOLE_WORD_TEST = /(^|[^a-z0-9])test([^a-z0-9]|$)/i;

/**
 * Detect an *explicit or exact* test/fixture marker on a supplier or
 * package record: the `isTest` flag, or a name/slug that IS (not merely
 * contains) "test". This is the confident tier — it is what's allowed to
 * hard-block a direct page request (canBeViewedPublicly), because a false
 * positive here 404s a real business's own page for its own customers.
 * @param {Object} record Supplier or package record.
 * @returns {boolean} True when the record is confidently fixture data.
 */
function isConfirmedTestFixture(record) {
  const source = record && typeof record === 'object' ? record : {};
  if (source.isTest === true) {
    return true;
  }
  const name = cleanText(
    source.name || source.businessName || source.company || source.title || ''
  );
  if (/^test$/i.test(name)) {
    return true;
  }
  const slug = cleanText(source.slug || '');
  return /^test$/i.test(slug);
}

/**
 * Detect a *likely* test/fixture marker: everything isConfirmedTestFixture
 * catches, plus a name or slug that merely carries "test" as a distinct
 * word (e.g. "Romeo Test", "test-no2-yy7lo4") — the naming pattern the SEO
 * audit found already leaking into the live index. This broader, fuzzier
 * tier is only safe to use for *discovery* (search/index/sitemap
 * exclusion), never for hard-blocking a direct page request: "Test Valley
 * Marquees" or a package literally titled "Wedding Menu Taste Test" would
 * also match this pattern despite being real listings, so 404ing them would
 * be a much worse outcome than merely keeping them out of search/the index.
 * @param {Object} record Supplier or package record.
 * @returns {boolean} True when the record looks like fixture data.
 */
function isKnownTestFixture(record) {
  if (isConfirmedTestFixture(record)) {
    return true;
  }
  const source = record && typeof record === 'object' ? record : {};
  const name = cleanText(
    source.name || source.businessName || source.company || source.title || ''
  );
  if (WHOLE_WORD_TEST.test(name)) {
    return true;
  }
  const slug = cleanText(source.slug || '');
  return WHOLE_WORD_TEST.test(slug);
}

/** Fail-closed approval guard for confirmed or previously quarantined fixtures. */
function approvalDecision(record) {
  if (record && record.seoQuarantined === true) {
    return { allowed: false, reason: 'seo_quarantined_record' };
  }
  if (isConfirmedTestFixture(record)) {
    return { allowed: false, reason: 'confirmed_test_fixture' };
  }
  return { allowed: true, reason: null };
}

/**
 * Reason a record's lifecycle state blocks it from being publicly viewable,
 * or null when nothing here blocks it.
 *
 * Consolidates the deleted/archived/suspended/rejected/paused/not-approved
 * checks that used to be scattered (and inconsistently applied) across
 * publicSupplierSeo.service.js, publicListingSeo.service.js and
 * supplierLocation.service.js's isEligibleForLocationPages.
 * @param {Object} record Supplier or package record.
 * @returns {?string} One of 'deleted' | 'inactive' | 'suspended' | 'rejected' | 'not_approved', or null.
 */
function lifecycleBlockReason(record) {
  const source = record && typeof record === 'object' ? record : {};

  if (
    source.deleted === true ||
    source.isDeleted === true ||
    source.deletedAt ||
    source.archivedAt
  ) {
    return 'deleted';
  }
  if (source.paused === true || source.suspended === true) {
    return source.suspended === true ? 'suspended' : 'inactive';
  }

  const status = cleanText(source.status).toLowerCase();
  const verificationStatus = cleanText(source.verificationStatus).toLowerCase();

  if (status === 'suspended' || verificationStatus === 'suspended') {
    return 'suspended';
  }
  if (status === 'rejected' || verificationStatus === 'rejected') {
    return 'rejected';
  }
  if (['inactive', 'disabled', 'banned'].includes(status)) {
    return 'inactive';
  }

  // Not yet (or no longer) approved covers both a record still awaiting
  // moderation and one whose approval was withdrawn — an unresolved
  // moderation state is, by definition, not an approved one.
  if (source.approved !== true) {
    return 'not_approved';
  }

  return null;
}

/**
 * Whether the record carries a stable id and a real display name.
 * @param {Object} record Supplier or package record.
 * @param {string[]} [nameFields] Fields checked for a display name, in order.
 * @returns {boolean} True when both are present.
 */
function hasStableIdentity(record, nameFields = ['name', 'businessName', 'title']) {
  const source = record && typeof record === 'object' ? record : {};
  if (!source.id) {
    return false;
  }
  return nameFields.some(field => Boolean(cleanText(source[field])));
}

/**
 * Whether a record's owner reference still resolves to a real user.
 *
 * A record with no owner at all is treated as valid here — see
 * publicSupplierSeo.service.js's original isPublicSupplier, which this
 * mirrors: some legacy/imported suppliers never had an owner account.
 * @param {Object} record Supplier or package record.
 * @param {Set<string>} [validOwnerIds] IDs of users that still exist.
 * @returns {boolean} True when the owner reference is valid or absent.
 */
function isOwnerValid(record, validOwnerIds) {
  const source = record && typeof record === 'object' ? record : {};
  if (!source.ownerUserId) {
    return true;
  }
  return validOwnerIds instanceof Set && validOwnerIds.has(String(source.ownerUserId));
}

module.exports = {
  cleanText,
  isKnownTestFixture,
  isConfirmedTestFixture,
  approvalDecision,
  lifecycleBlockReason,
  hasStableIdentity,
  isOwnerValid,
};
