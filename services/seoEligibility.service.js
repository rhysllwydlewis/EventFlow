'use strict';

/**
 * Shared public/index/sitemap eligibility policy for suppliers and packages.
 *
 * Four decisions are intentionally kept separate because a listing can be
 * directly viewable and discoverable without being suitable for indexing.
 */

const lifecycle = require('./seoRecordLifecycle.util');
const { calculateProfileQuality, isMeaningfulText } = require('./supplierRanking.service');
const supplierLocation = require('./supplierLocation.service');
const {
  isPublishedUnclaimedSupplierBotProfile,
} = require('./supplierBotPilotVisibility.util');

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
  PUBLISHED_UNCLAIMED: 'published_unclaimed_noindex',
  SUPPLIER_NOT_VIEWABLE: 'supplier_not_publicly_viewable',
  SUPPLIER_NOT_INDEXABLE: 'supplier_not_indexable',
  NO_CANONICAL_SLUG: 'no_clean_canonical_route',
});

const MIN_SUPPLIER_QUALITY_SCORE_FOR_INDEX = 10;
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

function supplierViewability(supplier, context = {}) {
  if (!supplier || typeof supplier !== 'object') {
    return decision([REASON_CODES.NOT_FOUND]);
  }
  const reasons = [];
  if (lifecycle.isConfirmedTestFixture(supplier)) {
    reasons.push(REASON_CODES.TEST_FIXTURE);
  }

  const publishedUnclaimed = isPublishedUnclaimedSupplierBotProfile(supplier);
  const blocked = reasonForBlock(lifecycle.lifecycleBlockReason(supplier));
  // `pilot_unclaimed` and `public_unclaimed` are explicit publication states.
  // They are allowed to behave like marketplace listings even though ownership
  // has not transferred and the underlying record is deliberately not a normal
  // supplier-moderation record. Ordinary Supplier Bot drafts remain blocked.
  if (blocked && !(blocked === REASON_CODES.NOT_APPROVED && publishedUnclaimed)) {
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
    if (isPublishedUnclaimedSupplierBotProfile(supplier)) {
      // Directory publication and SEO publication are separate rollout gates.
      // Unclaimed bot profiles may be browsed/searched like other suppliers,
      // but remain noindex and absent from sitemap until ownership is claimed.
      reasons.push(REASON_CODES.PUBLISHED_UNCLAIMED);
    }
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

function packageViewability(pkg, context = {}) {
  if (!pkg || typeof pkg !== 'object') {
    return decision([REASON_CODES.NOT_FOUND]);
  }
  const reasons = [];
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

function isPackageContext(context) {
  return context && context.type === 'package';
}

function canBeViewedPublicly(record, context = {}) {
  return isPackageContext(context)
    ? packageViewability(record, context)
    : supplierViewability(record, context);
}

function canAppearInDirectory(record, context = {}) {
  return isPackageContext(context)
    ? packageDirectoryEligibility(record, context)
    : supplierDirectoryEligibility(record, context);
}

function canBeIndexed(record, context = {}) {
  return isPackageContext(context)
    ? packageIndexEligibility(record, context)
    : supplierIndexEligibility(record, context);
}

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
