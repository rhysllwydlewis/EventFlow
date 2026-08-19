'use strict';

/**
 * Shared public/index/sitemap eligibility policy for suppliers and packages.
 *
 * This is the single source of truth the SEO audit (finding SEO-002) asked
 * for: before this module, "is this record public" was answered three
 * different ways in three different places —
 * services/publicSupplierSeo.service.js's isPublicSupplier (approval + name
 * + owner only), services/supplierRanking.service.js's
 * isPubliclyEligibleSupplier (also excludes isTest/suspended/rejected, used
 * by the real directory search) and
 * services/supplierLocation.service.js's isEligibleForLocationPages (its own
 * hand-rolled superset). Because the SEO detail-page routes and sitemap.js
 * used the weakest of the three, a suspended supplier or an explicit test
 * fixture (e.g. the "test-no2-yy7lo4" package the audit found indexed) could
 * be served and advertised in the sitemap even though the real directory
 * search already excluded it.
 *
 * Four separate decisions are exposed, deliberately not collapsed into one
 * boolean, because "approved" is not the same question as "indexable":
 *
 *   - canBeViewedPublicly  — should a direct request for this record's page
 *                            render at all (200) rather than hard-block
 *                            (404/redirect)?
 *   - canAppearInDirectory — should it show up in marketplace search/browse?
 *   - canBeIndexed         — should its page carry `index,follow`? A record
 *                            can be canBeViewedPublicly === true and
 *                            canBeIndexed === false at the same time — that
 *                            page must still respond 200 with
 *                            `noindex, follow`, never a hard block.
 *   - canAppearInSitemap   — canBeIndexed, plus an actual clean canonical
 *                            route was resolved for it.
 *
 * Every decision returns `{ eligible, reasons }`. `reasons` is always a
 * machine-readable code list (REASON_CODES below), never just a boolean, so
 * admin UI, the quarantine script and tests can explain *why* a record was
 * excluded.
 */

const lifecycle = require('./seoRecordLifecycle.util');
const { calculateProfileQuality, isMeaningfulText } = require('./supplierRanking.service');
const supplierLocation = require('./supplierLocation.service');

/** Machine-readable reason codes returned by a failed eligibility decision. */
const REASON_CODES = Object.freeze({
  NOT_FOUND: 'not_found',
  TEST_FIXTURE: 'test_fixture_record',
  NOT_APPROVED: 'not_approved',
  SUSPENDED: 'suspended',
  REJECTED: 'rejected',
  DELETED: 'deleted',
  INACTIVE: 'inactive',
  INVALID_OWNER: 'owner_account_invalid',
  MISSING_IDENTITY: 'missing_stable_identity',
  MISSING_CLASSIFICATION: 'missing_category_classification',
  MISSING_LOCATION: 'missing_or_unusable_location',
  BELOW_QUALITY_THRESHOLD: 'below_content_quality_threshold',
  SUPPLIER_NOT_VIEWABLE: 'supplier_not_publicly_viewable',
  SUPPLIER_NOT_INDEXABLE: 'supplier_not_indexable',
  NO_CANONICAL_SLUG: 'no_clean_canonical_route',
});

/**
 * Minimum services/supplierRanking.service.js profile-completeness score
 * (out of calculateProfileQuality's max of 40) a supplier needs before its
 * page is worth indexing. Deliberately reuses the existing quality model
 * rather than a new word-count heuristic. Set low enough that a supplier
 * with a name, category, location and a genuine short description already
 * clears it — the bar exists to catch near-empty shells (bare name only, or
 * name + category with nothing else), not to demand a fully decorated
 * profile.
 */
const MIN_SUPPLIER_QUALITY_SCORE_FOR_INDEX = 10;

/** Minimum length (matching calculateProfileQuality's own bar) a package's own description must clear to be worth indexing on its own page. */
const MIN_PACKAGE_DESCRIPTION_LENGTH = 40;

function reasonForBlock(blockReason) {
  switch (blockReason) {
    case 'deleted':
      return REASON_CODES.DELETED;
    case 'inactive':
      return REASON_CODES.INACTIVE;
    case 'suspended':
      return REASON_CODES.SUSPENDED;
    case 'rejected':
      return REASON_CODES.REJECTED;
    case 'not_approved':
      return REASON_CODES.NOT_APPROVED;
    default:
      return null;
  }
}

function decision(reasons) {
  return { eligible: reasons.length === 0, reasons };
}

// ─── Suppliers ────────────────────────────────────────────────────────────

function supplierViewability(supplier, context = {}) {
  if (!supplier || typeof supplier !== 'object') {
    return decision([REASON_CODES.NOT_FOUND]);
  }
  const reasons = [];
  // Only the confident tier (explicit isTest flag, or a name/slug that IS
  // "test") may hard-block a direct page request — the broader name/slug
  // heuristic used for directory/index eligibility below would 404 a real
  // business like "Test Valley Marquees" for its own customers.
  if (lifecycle.isConfirmedTestFixture(supplier)) {
    reasons.push(REASON_CODES.TEST_FIXTURE);
  }
  const blocked = reasonForBlock(lifecycle.lifecycleBlockReason(supplier));
  if (blocked) {
    reasons.push(blocked);
  }
  if (!lifecycle.hasStableIdentity(supplier, ['name', 'businessName', 'company'])) {
    reasons.push(REASON_CODES.MISSING_IDENTITY);
  }
  if (!lifecycle.isOwnerValid(supplier, context.validOwnerIds)) {
    reasons.push(REASON_CODES.INVALID_OWNER);
  }
  return decision(reasons);
}

// Directory listing applies everything page-view eligibility does, plus the
// broader name/slug test-fixture heuristic that viewability deliberately
// excludes (see supplierViewability) — hiding a likely-fixture record from
// search/browse is a safe, reversible discovery decision even when it's not
// confident enough to 404 the page itself for a direct visitor.
function supplierDirectoryEligibility(supplier, context = {}) {
  const base = supplierViewability(supplier, context);
  const reasons = [...base.reasons];
  if (!reasons.includes(REASON_CODES.TEST_FIXTURE) && lifecycle.isKnownTestFixture(supplier)) {
    reasons.push(REASON_CODES.TEST_FIXTURE);
  }
  return decision(reasons);
}

function supplierHasUsableLocation(supplier) {
  if (supplierLocation.supplierPostcode(supplier)) {
    return true;
  }
  if (lifecycle.cleanText(supplier.location)) {
    return true;
  }
  const coverage = supplierLocation.normaliseServiceAreas(supplier);
  return Boolean(coverage.nationwide) || coverage.cities.length > 0 || coverage.regions.length > 0;
}

function supplierIndexEligibility(supplier, context = {}) {
  const base = supplierDirectoryEligibility(supplier, context);
  const reasons = [...base.reasons];
  if (base.eligible) {
    if (!lifecycle.cleanText(supplier.category)) {
      reasons.push(REASON_CODES.MISSING_CLASSIFICATION);
    }
    if (!supplierHasUsableLocation(supplier)) {
      reasons.push(REASON_CODES.MISSING_LOCATION);
    }
    const quality = calculateProfileQuality(supplier);
    if (quality.score < MIN_SUPPLIER_QUALITY_SCORE_FOR_INDEX) {
      reasons.push(REASON_CODES.BELOW_QUALITY_THRESHOLD);
    }
  }
  return decision(reasons);
}

// ─── Packages ─────────────────────────────────────────────────────────────

function packageViewability(pkg, context = {}) {
  if (!pkg || typeof pkg !== 'object') {
    return decision([REASON_CODES.NOT_FOUND]);
  }
  const reasons = [];
  // See supplierViewability's comment: only the confident tier hard-blocks
  // a direct request. A package titled "Wedding Menu Taste Test" is a real,
  // plausible listing that must still render for a direct visitor.
  if (lifecycle.isConfirmedTestFixture(pkg)) {
    reasons.push(REASON_CODES.TEST_FIXTURE);
  }
  const blocked = reasonForBlock(lifecycle.lifecycleBlockReason(pkg));
  if (blocked) {
    reasons.push(blocked);
  }
  if (!lifecycle.hasStableIdentity(pkg, ['title', 'name'])) {
    reasons.push(REASON_CODES.MISSING_IDENTITY);
  }
  const supplierCheck = supplierViewability(context.supplier, context);
  if (!supplierCheck.eligible) {
    reasons.push(REASON_CODES.SUPPLIER_NOT_VIEWABLE);
  }
  return decision(reasons);
}

function packageDirectoryEligibility(pkg, context = {}) {
  const base = packageViewability(pkg, context);
  const reasons = [...base.reasons];
  if (!reasons.includes(REASON_CODES.TEST_FIXTURE) && lifecycle.isKnownTestFixture(pkg)) {
    reasons.push(REASON_CODES.TEST_FIXTURE);
  }
  return decision(reasons);
}

function packageIndexEligibility(pkg, context = {}) {
  const base = packageDirectoryEligibility(pkg, context);
  const reasons = [...base.reasons];
  if (base.eligible) {
    // A package inherits the quality of its owning supplier landing page.
    // Viewable-but-thin suppliers may serve a noindex page, but must not lend
    // indexability to child packages.
    const supplierIndex = supplierIndexEligibility(context.supplier, context);
    if (!supplierIndex.eligible) {
      reasons.push(REASON_CODES.SUPPLIER_NOT_INDEXABLE);
    }
    const description = pkg.description || pkg.description_short || pkg.descriptionShort || '';
    if (!isMeaningfulText(description, MIN_PACKAGE_DESCRIPTION_LENGTH)) {
      reasons.push(REASON_CODES.BELOW_QUALITY_THRESHOLD);
    }
  }
  return decision(reasons);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────

function isPackageContext(context) {
  return context && context.type === 'package';
}

/**
 * Should a direct request for this record's page render at all?
 * @param {Object} record Supplier or package record.
 * @param {Object} [context] `{ type: 'supplier'|'package', validOwnerIds, supplier }`.
 * @returns {{eligible: boolean, reasons: string[]}} Decision.
 */
function canBeViewedPublicly(record, context = {}) {
  return isPackageContext(context)
    ? packageViewability(record, context)
    : supplierViewability(record, context);
}

/**
 * Should this record appear in marketplace search/browse results?
 * @param {Object} record Supplier or package record.
 * @param {Object} [context] See canBeViewedPublicly.
 * @returns {{eligible: boolean, reasons: string[]}} Decision.
 */
function canAppearInDirectory(record, context = {}) {
  return isPackageContext(context)
    ? packageDirectoryEligibility(record, context)
    : supplierDirectoryEligibility(record, context);
}

/**
 * Should this record's page carry `index,follow`?
 * @param {Object} record Supplier or package record.
 * @param {Object} [context] See canBeViewedPublicly.
 * @returns {{eligible: boolean, reasons: string[]}} Decision.
 */
function canBeIndexed(record, context = {}) {
  return isPackageContext(context)
    ? packageIndexEligibility(record, context)
    : supplierIndexEligibility(record, context);
}

/**
 * Should this record's canonical URL be advertised in sitemap.xml?
 *
 * Requires canBeIndexed() plus an actual, already-built canonical slug —
 * the caller passes `context.canonicalSlug` (built the normal way, via
 * buildPublicSupplierSlug/buildPublicPackageSlug) rather than this module
 * re-deriving it, so the slug design stays owned by one place.
 * @param {Object} record Supplier or package record.
 * @param {Object} [context] See canBeViewedPublicly, plus `canonicalSlug`.
 * @returns {{eligible: boolean, reasons: string[]}} Decision.
 */
function canAppearInSitemap(record, context = {}) {
  const base = canBeIndexed(record, context);
  const reasons = [...base.reasons];
  if (!lifecycle.cleanText(context.canonicalSlug)) {
    reasons.push(REASON_CODES.NO_CANONICAL_SLUG);
  }
  return decision(reasons);
}

module.exports = {
  REASON_CODES,
  MIN_SUPPLIER_QUALITY_SCORE_FOR_INDEX,
  MIN_PACKAGE_DESCRIPTION_LENGTH,
  canBeViewedPublicly,
  canAppearInDirectory,
  canBeIndexed,
  canAppearInSitemap,
  isKnownTestFixture: lifecycle.isKnownTestFixture,
};
