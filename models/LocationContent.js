/**
 * EventFlow UK locations — shared model constants
 *
 * The city registry in `data/uk-cities.json` is the authoritative list of
 * places EventFlow recognises. Everything editorial or operational about a
 * place — publication state, indexability, hero media, local copy, review
 * dates — lives in the `location_pages` collection keyed by the registry slug,
 * so a redeploy never silently republishes or unpublishes a page.
 */

'use strict';

const COLLECTIONS = {
  locationPages: 'location_pages',
  locationCategoryPages: 'location_category_pages',
};

/**
 * Editorial workflow states. `draft` and `review` are admin-only; `pilot` is
 * publicly reachable but never indexable; `published` is the only state that
 * can reach the sitemap, and only when the quality gate also passes.
 */
const PUBLICATION_STATES = {
  draft: 'draft',
  review: 'review',
  pilot: 'pilot',
  published: 'published',
  retired: 'retired',
};

const PUBLICATION_STATE_VALUES = Object.values(PUBLICATION_STATES);

/** States whose pages render a 200 response to the public. */
const PUBLIC_STATES = [PUBLICATION_STATES.pilot, PUBLICATION_STATES.published];

/**
 * How a supplier relates to a city, strongest first. The order is the
 * deterministic precedence used by the matcher: a supplier based in the city is
 * never demoted to "serves" because it also lists a service area.
 */
const RELATIONSHIPS = {
  basedIn: 'based_in',
  serves: 'serves',
  radius: 'radius',
  nationwide: 'nationwide',
};

const RELATIONSHIP_ORDER = [
  RELATIONSHIPS.basedIn,
  RELATIONSHIPS.serves,
  RELATIONSHIPS.radius,
  RELATIONSHIPS.nationwide,
];

/** Relevance weight contributed by each relationship, before quality signals. */
const RELATIONSHIP_WEIGHTS = {
  [RELATIONSHIPS.basedIn]: 100,
  [RELATIONSHIPS.serves]: 80,
  [RELATIONSHIPS.radius]: 55,
  [RELATIONSHIPS.nationwide]: 20,
};

/**
 * Where a mapping came from, and how much we trust it. Only `high` confidence
 * mappings are used for public matching; anything else waits for a human.
 */
const MAPPING_SOURCES = {
  postcodeLookup: 'postcode_lookup',
  registryName: 'registry_name',
  supplierSelected: 'supplier_selected',
  adminVerified: 'admin_verified',
  legacyText: 'legacy_text',
};

const CONFIDENCE = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** Audit classifications produced by scripts/audit-supplier-locations.js. */
const AUDIT_STATUSES = {
  alreadyMapped: 'already_mapped',
  highConfidence: 'high_confidence',
  reviewRequired: 'review_required',
  unmapped: 'unmapped',
};

const SERVICE_AREA_TYPES = {
  city: 'city',
  radius: 'radius',
  region: 'region',
  nationwide: 'nationwide',
};

/**
 * How a city page's hero image is chosen. `auto` is the default: the curated
 * or Pexels-resolved photograph for the city, refreshed automatically. An
 * editor switches a city to `custom` to pin their own uploaded or linked
 * image instead; switching back to `auto` hands the city back to automatic
 * resolution without discarding the custom image they had stored.
 */
const HERO_SOURCES = {
  auto: 'auto',
  custom: 'custom',
};

const HERO_SOURCE_VALUES = Object.values(HERO_SOURCES);

/**
 * Indexability quality gate. The score is a weighted sum of independently
 * verifiable signals rather than a hard-coded "six suppliers, three
 * categories" rule, so the bar can be tuned per deployment without a code
 * change to the matcher.
 */
const QUALITY_SIGNALS = {
  supplierDepth: { weight: 25, target: 8 },
  categoryDiversity: { weight: 20, target: 4 },
  localContent: { weight: 20, target: 1 },
  proofOfActivity: { weight: 15, target: 3 },
  internalLinks: { weight: 10, target: 2 },
  reviewFreshness: { weight: 10, target: 1 },
};

const QUALITY_PASS_SCORE = 60;

/**
 * Indexability quality gate for a city × category page.
 *
 * A category page never inherits its parent city's score: a city can look
 * ready overall while one specific category is still thin. There is no
 * category-diversity signal here — a page about one category has nothing to
 * diversify — so the weight that signal carries at city level is redistributed
 * across the remaining five, and each one's target is deliberately lower than
 * its city-level counterpart, matching a single category's real inventory
 * rather than the whole city's.
 */
const CATEGORY_QUALITY_SIGNALS = {
  supplierDepth: { weight: 30, target: 4 },
  localContent: { weight: 25, target: 1 },
  proofOfActivity: { weight: 20, target: 2 },
  internalLinks: { weight: 15, target: 2 },
  reviewFreshness: { weight: 10, target: 1 },
};

const CATEGORY_QUALITY_PASS_SCORE = 60;

/** Local editorial copy older than this is treated as stale by the gate. */
const CONTENT_REVIEW_MAX_AGE_DAYS = 365;

const LIMITS = {
  heroCreditMaxLength: 160,
  heroSourceUrlMaxLength: 500,
  introMaxLength: 1200,
  sectionBodyMaxLength: 4000,
  sectionTitleMaxLength: 120,
  faqQuestionMaxLength: 200,
  faqAnswerMaxLength: 2000,
  maxSections: 8,
  maxFaqs: 10,
  maxSuppliersPerPage: 24,
  maxNearbyLinks: 6,
};

module.exports = {
  AUDIT_STATUSES,
  CATEGORY_QUALITY_PASS_SCORE,
  CATEGORY_QUALITY_SIGNALS,
  COLLECTIONS,
  CONFIDENCE,
  CONTENT_REVIEW_MAX_AGE_DAYS,
  HERO_SOURCES,
  HERO_SOURCE_VALUES,
  LIMITS,
  MAPPING_SOURCES,
  PUBLICATION_STATES,
  PUBLICATION_STATE_VALUES,
  PUBLIC_STATES,
  QUALITY_PASS_SCORE,
  QUALITY_SIGNALS,
  RELATIONSHIPS,
  RELATIONSHIP_ORDER,
  RELATIONSHIP_WEIGHTS,
  SERVICE_AREA_TYPES,
};
