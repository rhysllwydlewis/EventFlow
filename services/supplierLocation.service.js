/**
 * EventFlow supplier geography
 *
 * Turns whatever a supplier record actually holds — a structured base location,
 * a set of service areas, or nothing but the legacy free-text `location` string
 * — into a deterministic, explainable relationship with a registry city.
 *
 * Two rules shape everything here:
 *
 * 1. Ambiguous free text is never silently promoted into a mapping. A record we
 *    are unsure about becomes review-required, not a guess on a public page.
 * 2. The relationship is explainable. Every match carries the reason it matched
 *    and a label the page can show the visitor.
 */

'use strict';

const registry = require('./locationRegistry.service');
const { isPublicSupplier, supplierDisplayName } = require('./publicSupplierSeo.service');
const {
  AUDIT_STATUSES,
  CONFIDENCE,
  MAPPING_SOURCES,
  RELATIONSHIPS,
  RELATIONSHIP_ORDER,
  RELATIONSHIP_WEIGHTS,
  SERVICE_AREA_TYPES,
} = require('../models/LocationContent');

/** Radius a supplier is assumed to travel when it has given no explicit value. */
const DEFAULT_TRAVEL_RADIUS_MILES = 0;

/** Longest journey a supplier may claim through a radius service area. */
const MAX_TRAVEL_RADIUS_MILES = 200;

/**
 * Largest relevance bonus a paid tier may contribute.
 *
 * This is deliberately smaller than the gap between any two relationship tiers
 * (the narrowest is 20, between "based in" and "serves"), so a Pro supplier
 * from another city can never displace an equally strong local match on
 * subscription alone.
 */
const MAX_TIER_BOOST = 15;

/** Words that indicate a free-text location covers more than one place. */
const BROAD_AREA_HINTS = [
  'and',
  'surrounding',
  'surrounds',
  'areas',
  'area',
  'nationwide',
  'uk wide',
  'uk-wide',
  'across',
  'greater',
  'south',
  'north',
  'east',
  'west',
  'wales',
  'scotland',
  'england',
  'midlands',
  'yorkshire',
];

/**
 * Read a GeoJSON point from a record, tolerating the plain lat/lng shape.
 * @param {Object} value Candidate coordinate holder.
 * @returns {{latitude: number, longitude: number}|null} Coordinate, or null.
 */
function readPoint(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value.coordinates) && value.coordinates.length === 2) {
    const [longitude, latitude] = value.coordinates.map(Number);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
    return null;
  }
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng ?? value.lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  return null;
}

/**
 * Build the GeoJSON point EventFlow stores, in `[longitude, latitude]` order.
 * @param {{latitude: number, longitude: number}} point Coordinate.
 * @returns {{type: string, coordinates: number[]}|null} GeoJSON point.
 */
function toGeoJsonPoint(point) {
  if (!point) {
    return null;
  }
  return { type: 'Point', coordinates: [point.longitude, point.latitude] };
}

let cachedCityNamePatterns = null;
let cachedBroadAreaPatterns = null;

/**
 * Word-boundary matchers for every city name and alternative name.
 *
 * Built once: the audit script runs this against every supplier record, and
 * rebuilding sixty-odd regular expressions per row was pure waste.
 * @returns {{slug: string, name: string, pattern: RegExp}[]} Matchers.
 */
function cityNamePatterns() {
  if (cachedCityNamePatterns) {
    return cachedCityNamePatterns;
  }
  const patterns = [];
  for (const city of registry.listCities()) {
    for (const name of [city.name, ...city.alternateNames]) {
      const token = registry.normaliseSlug(name);
      if (!token) {
        continue;
      }
      // Hyphen-delimited word boundaries: "cardiff-bay" contains Cardiff,
      // "cardiffian" does not.
      patterns.push({ slug: city.slug, name, pattern: new RegExp(`(?:^|-)${token}(?:-|$)`) });
    }
  }
  cachedCityNamePatterns = patterns;
  return patterns;
}

/**
 * Word-boundary matchers for the wider-area hints.
 * @returns {RegExp[]} Matchers.
 */
function broadAreaPatterns() {
  if (!cachedBroadAreaPatterns) {
    cachedBroadAreaPatterns = BROAD_AREA_HINTS.map(
      hint => new RegExp(`(?:^|-)${registry.normaliseSlug(hint)}(?:-|$)`)
    );
  }
  return cachedBroadAreaPatterns;
}

/**
 * Drop the cached matchers. Used by tests that swap the registry.
 * @returns {void} Nothing.
 */
function resetMatcherCache() {
  cachedCityNamePatterns = null;
  cachedBroadAreaPatterns = null;
}

/**
 * Classify a legacy free-text location without guessing.
 *
 * "Cardiff" is a mapping. "Cardiff and South Wales" names a city but also
 * claims a wider area, so it goes to a human. "Somewhere lovely" is unmapped.
 * @param {string} value Legacy `supplier.location` text.
 * @returns {{status: string, citySlug: string|null, matchedNames: string[], reason: string}} Classification.
 */
function classifyLegacyLocation(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) {
    return {
      status: AUDIT_STATUSES.unmapped,
      citySlug: null,
      matchedNames: [],
      reason: 'no legacy location recorded',
    };
  }

  // An exact match on the whole string is the only automatic mapping.
  const whole = registry.resolveCity(raw);
  if (whole) {
    return {
      status: AUDIT_STATUSES.highConfidence,
      citySlug: whole.city.slug,
      matchedNames: [whole.city.name],
      reason: 'legacy location names exactly one registry city',
    };
  }

  const normalised = registry.normaliseSlug(raw);
  const matches = new Map();
  for (const candidate of cityNamePatterns()) {
    if (candidate.pattern.test(normalised)) {
      matches.set(candidate.slug, candidate.name);
    }
  }

  if (matches.size === 0) {
    return {
      status: AUDIT_STATUSES.unmapped,
      citySlug: null,
      matchedNames: [],
      reason: 'legacy location does not name a registry city',
    };
  }

  const [firstSlug] = [...matches.keys()];
  const matchedNames = [...matches.values()];
  if (matches.size > 1) {
    return {
      status: AUDIT_STATUSES.reviewRequired,
      citySlug: null,
      matchedNames,
      reason: `legacy location names ${matches.size} registry cities`,
    };
  }

  const mentionsBroadArea = broadAreaPatterns().some(pattern => pattern.test(normalised));

  return {
    status: AUDIT_STATUSES.reviewRequired,
    citySlug: firstSlug,
    matchedNames,
    reason: mentionsBroadArea
      ? 'legacy location names a city alongside a wider area'
      : 'legacy location contains a city name among other words',
  };
}

/**
 * Normalise a supplier's base location.
 *
 * Structured data wins. A legacy string is only ever reported, never promoted
 * into a usable mapping, so nothing reaches a public page on a guess.
 * @param {Object} supplier Supplier record.
 * @returns {Object|null} Normalised base location, or null when unknown.
 */
function normaliseBaseLocation(supplier) {
  const source = supplier && typeof supplier === 'object' ? supplier : {};
  const base =
    source.baseLocation && typeof source.baseLocation === 'object' ? source.baseLocation : null;

  if (base) {
    const resolved = base.citySlug ? registry.resolveCity(base.citySlug) : null;
    const point = readPoint(base.coordinates);
    return {
      displayName:
        base.displayName || (resolved ? `${resolved.city.name}, ${resolved.city.nation}` : null),
      postcode: base.postcode || null,
      citySlug: resolved ? resolved.city.slug : null,
      nation: base.nation || (resolved ? resolved.city.nation : null),
      coordinates:
        toGeoJsonPoint(point) ||
        (resolved
          ? {
              ...resolved.city.coordinates,
              coordinates: [...resolved.city.coordinates.coordinates],
            }
          : null),
      point: point || (resolved ? { ...resolved.city.centre } : null),
      source: base.source || MAPPING_SOURCES.supplierSelected,
      confidence: base.confidence || (resolved ? CONFIDENCE.medium : CONFIDENCE.low),
      legacyLocation: source.location || null,
    };
  }

  if (!source.location) {
    return null;
  }

  // Legacy-only record: report what the text looks like, but expose no city.
  const classification = classifyLegacyLocation(source.location);
  return {
    displayName: String(source.location),
    postcode: null,
    citySlug: null,
    nation: null,
    coordinates: null,
    point: null,
    source: MAPPING_SOURCES.legacyText,
    confidence: CONFIDENCE.low,
    legacyLocation: String(source.location),
    legacyClassification: classification,
  };
}

/**
 * Normalise a supplier's declared service areas.
 *
 * Unknown city slugs, out-of-range radii and unrecognised types are dropped
 * rather than partially honoured.
 * @param {Object} supplier Supplier record.
 * @returns {{cities: string[], radiusMiles: number, regions: string[], nationwide: boolean}} Coverage.
 */
function normaliseServiceAreas(supplier) {
  const source = supplier && typeof supplier === 'object' ? supplier : {};
  const areas = Array.isArray(source.serviceAreas) ? source.serviceAreas : [];
  const cities = new Set();
  const regions = new Set();
  let radiusMiles = DEFAULT_TRAVEL_RADIUS_MILES;
  let nationwide = source.travelPolicy && source.travelPolicy.nationwide === true;

  for (const area of areas) {
    if (!area || typeof area !== 'object') {
      continue;
    }
    if (area.type === SERVICE_AREA_TYPES.city) {
      const resolved = registry.resolveCity(area.slug);
      if (resolved) {
        cities.add(resolved.city.slug);
      }
      continue;
    }
    if (area.type === SERVICE_AREA_TYPES.radius) {
      const miles = Number(area.miles);
      if (Number.isFinite(miles) && miles > 0) {
        radiusMiles = Math.max(radiusMiles, Math.min(MAX_TRAVEL_RADIUS_MILES, miles));
      }
      continue;
    }
    if (area.type === SERVICE_AREA_TYPES.region && area.name) {
      regions.add(String(area.name));
      continue;
    }
    if (area.type === SERVICE_AREA_TYPES.nationwide) {
      nationwide = true;
    }
  }

  return {
    cities: [...cities],
    radiusMiles,
    regions: [...regions],
    nationwide: Boolean(nationwide),
  };
}

/**
 * Whether a supplier may appear on any public location page.
 *
 * Reuses the platform's existing public-supplier rule and adds the exclusions
 * the location work introduces: suspended records, seeded test accounts and
 * suppliers whose owning user has gone.
 * @param {Object} supplier Supplier record.
 * @param {Set<string>} validOwnerIds IDs of users that still exist.
 * @returns {boolean} True when the supplier is eligible.
 */
function isEligibleForLocationPages(supplier, validOwnerIds) {
  if (!isPublicSupplier(supplier, validOwnerIds)) {
    return false;
  }
  if (supplier.status === 'suspended' || supplier.suspended === true) {
    return false;
  }
  if (supplier.isTest === true || supplier.testAccount === true) {
    return false;
  }
  if (supplier.deletedAt || supplier.archivedAt) {
    return false;
  }
  return true;
}

/**
 * Round a distance for display without implying false precision.
 * @param {number} miles Distance in miles.
 * @returns {number} Rounded distance.
 */
function roundMiles(miles) {
  return miles < 10 ? Math.round(miles * 10) / 10 : Math.round(miles);
}

/**
 * Human-readable explanation of why a supplier appears on a city page.
 * @param {string} relationship Relationship constant.
 * @param {Object} city City record.
 * @param {number|null} distanceMiles Distance, when known.
 * @returns {string} Label such as "Based in Cardiff" or "18 miles away".
 */
function relationshipLabel(relationship, city, distanceMiles) {
  const name = city && city.name ? city.name : 'this area';
  if (relationship === RELATIONSHIPS.basedIn) {
    return `Based in ${name}`;
  }
  if (relationship === RELATIONSHIPS.serves) {
    return `Serves ${name}`;
  }
  if (relationship === RELATIONSHIPS.radius) {
    if (Number.isFinite(distanceMiles)) {
      const rounded = roundMiles(distanceMiles);
      return `${rounded} ${rounded === 1 ? 'mile' : 'miles'} away`;
    }
    return `Travels to ${name}`;
  }
  if (relationship === RELATIONSHIPS.nationwide) {
    return 'Covers the whole UK';
  }
  return '';
}

/**
 * Determine how a supplier relates to a city.
 *
 * Precedence is fixed and checked in order: based in, explicitly serves, within
 * the supplier's travel radius, then nationwide. The first match wins, so a
 * local supplier is never reported as a nationwide fallback.
 * @param {Object} supplier Supplier record.
 * @param {Object} city City record from the registry.
 * @returns {Object|null} `{relationship, label, distanceMiles, ...}` or null.
 */
function matchSupplierToCity(supplier, city) {
  if (!supplier || !city) {
    return null;
  }

  const base = normaliseBaseLocation(supplier);
  const coverage = normaliseServiceAreas(supplier);
  const distanceMiles = base && base.point ? registry.distanceToCity(city, base.point) : null;

  const describe = relationship => ({
    relationship,
    label: relationshipLabel(relationship, city, distanceMiles),
    distanceMiles: Number.isFinite(distanceMiles) ? roundMiles(distanceMiles) : null,
    citySlug: city.slug,
    baseCitySlug: base ? base.citySlug : null,
    weight: RELATIONSHIP_WEIGHTS[relationship] || 0,
  });

  if (base && base.citySlug === city.slug) {
    return describe(RELATIONSHIPS.basedIn);
  }
  if (coverage.cities.includes(city.slug)) {
    return describe(RELATIONSHIPS.serves);
  }
  if (
    coverage.radiusMiles > 0 &&
    Number.isFinite(distanceMiles) &&
    distanceMiles <= coverage.radiusMiles
  ) {
    return describe(RELATIONSHIPS.radius);
  }
  if (coverage.nationwide) {
    return describe(RELATIONSHIPS.nationwide);
  }
  return null;
}

/**
 * Quality score for a supplier, independent of geography.
 *
 * Deliberately modest in range: geography leads on a location page, and quality
 * separates suppliers that share a relationship tier.
 * @param {Object} supplier Supplier record.
 * @returns {number} Score between 0 and 60.
 */
function qualityScore(supplier) {
  const summary =
    supplier.approvedReviewSummary && typeof supplier.approvedReviewSummary === 'object'
      ? supplier.approvedReviewSummary
      : {};
  const rating = Number(summary.averageRating);
  const reviews = Number(summary.reviewCount);

  let score = 0;
  if (Number.isFinite(rating) && rating > 0) {
    score += Math.min(20, (rating / 5) * 20);
  }
  if (Number.isFinite(reviews) && reviews > 0) {
    score += Math.min(15, Math.log10(reviews + 1) * 15);
  }

  // Profile completeness: each element is something a planner actually uses.
  const completeness = [
    supplierDisplayName(supplier),
    supplier.description,
    supplier.category,
    supplier.images && supplier.images.length,
    supplier.logo || supplier.coverImage,
    supplier.priceRange || supplier.price_display,
  ].filter(Boolean).length;
  score += Math.min(15, completeness * 2.5);

  if (supplier.verified === true || supplier.trustVerified === true) {
    score += 10;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Capped subscription bonus.
 * @param {Object} supplier Supplier record.
 * @returns {number} Bonus, never above MAX_TIER_BOOST.
 */
function tierBoost(supplier) {
  const isPro =
    supplier.isPro === true ||
    supplier.subscriptionStatus === 'active' ||
    supplier.plan === 'pro' ||
    supplier.tier === 'pro';
  return isPro ? MAX_TIER_BOOST : 0;
}

/**
 * Rank eligible suppliers for a city.
 *
 * Duplicate records — the same business reachable under a legacy ID, or matched
 * twice through overlapping service areas — are collapsed to their strongest
 * relationship before ranking.
 * @param {Object[]} suppliers Supplier records.
 * @param {Object} city City record.
 * @param {Object} [options] Options.
 * @param {Set<string>} [options.validOwnerIds] Owner IDs that still exist.
 * @param {number} [options.limit] Maximum results.
 * @returns {Object[]} Ranked `{supplier, relationship, label, score, ...}`.
 */
function rankSuppliersForCity(suppliers, city, options = {}) {
  if (!city) {
    return [];
  }
  const validOwnerIds = options.validOwnerIds instanceof Set ? options.validOwnerIds : new Set();
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : Infinity;

  const bestByIdentity = new Map();

  for (const supplier of suppliers || []) {
    if (!isEligibleForLocationPages(supplier, validOwnerIds)) {
      continue;
    }
    const match = matchSupplierToCity(supplier, city);
    if (!match) {
      continue;
    }

    // Collapse duplicates on the strongest available identity. Two records that
    // share an owner and a display name are the same business to a visitor.
    const identity =
      supplier.canonicalSupplierId ||
      `${supplier.ownerUserId || supplier.id}:${registry.normaliseSlug(supplierDisplayName(supplier))}`;

    const entry = {
      supplier,
      relationship: match.relationship,
      label: match.label,
      distanceMiles: match.distanceMiles,
      score: Math.round((match.weight + qualityScore(supplier) + tierBoost(supplier)) * 100) / 100,
    };

    const existing = bestByIdentity.get(identity);
    if (!existing || entry.score > existing.score) {
      bestByIdentity.set(identity, entry);
    }
  }

  return [...bestByIdentity.values()]
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const orderDelta =
        RELATIONSHIP_ORDER.indexOf(a.relationship) - RELATIONSHIP_ORDER.indexOf(b.relationship);
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return String(a.supplier.id).localeCompare(String(b.supplier.id));
    })
    .slice(0, limit);
}

/**
 * Classify a supplier for the migration audit.
 * @param {Object} supplier Supplier record.
 * @returns {Object} Audit row describing the record's mapping state.
 */
function auditSupplierLocation(supplier) {
  const base = normaliseBaseLocation(supplier);
  const coverage = normaliseServiceAreas(supplier);
  const id = supplier && supplier.id ? String(supplier.id) : '';

  if (base && base.citySlug) {
    return {
      supplierId: id,
      status: AUDIT_STATUSES.alreadyMapped,
      citySlug: base.citySlug,
      confidence: base.confidence,
      source: base.source,
      legacyLocation: base.legacyLocation,
      serviceCities: coverage.cities,
      reason: 'supplier already has a structured base location',
    };
  }

  const postcode = supplier && (supplier.postcode || supplier.basePostcode);
  const classification = classifyLegacyLocation(supplier && supplier.location);

  return {
    supplierId: id,
    status: classification.status,
    citySlug: classification.citySlug,
    confidence:
      classification.status === AUDIT_STATUSES.highConfidence ? CONFIDENCE.high : CONFIDENCE.low,
    source: MAPPING_SOURCES.legacyText,
    legacyLocation: supplier && supplier.location ? String(supplier.location) : null,
    postcode: postcode ? String(postcode) : null,
    serviceCities: coverage.cities,
    matchedNames: classification.matchedNames,
    reason: classification.reason,
  };
}

module.exports = {
  DEFAULT_TRAVEL_RADIUS_MILES,
  MAX_TIER_BOOST,
  MAX_TRAVEL_RADIUS_MILES,
  auditSupplierLocation,
  classifyLegacyLocation,
  isEligibleForLocationPages,
  matchSupplierToCity,
  normaliseBaseLocation,
  normaliseServiceAreas,
  qualityScore,
  rankSuppliersForCity,
  relationshipLabel,
  resetMatcherCache,
  roundMiles,
  tierBoost,
  toGeoJsonPoint,
};
