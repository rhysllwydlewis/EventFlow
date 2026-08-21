/**
 * EventFlow marketplace listings — city geography
 *
 * Gives a marketplace listing (a single item for sale in a single place) the
 * same city-resolution treatment `supplierLocation.service.js` already gives
 * suppliers, so a listing can appear on the UK city pages the way a supplier
 * does. A listing is not a mobile business, so it needs a smaller
 * relationship vocabulary than a supplier: it is either genuinely `in_city`
 * (its resolved city matches) or merely `nearby` (its coordinate falls within
 * the city's own catchment radius) — never "serves" or "nationwide".
 *
 * Resolution never guesses. A listing's `citySlug`, once stored, is trusted
 * directly; failing that, a geocoded coordinate resolves to the nearest
 * registry city, and failing that, the free-text `location` is classified by
 * the exact same rule suppliers use — an exact match on a city name is
 * high-confidence, anything else is left unmapped for a human.
 */

'use strict';

const registry = require('./locationRegistry.service');
const supplierLocation = require('./supplierLocation.service');
const { AUDIT_STATUSES, MAPPING_SOURCES, CONFIDENCE } = require('../models/LocationContent');

/**
 * Read a listing's stored coordinate, tolerating the `{lat, lng}` shape
 * marketplace listings use (suppliers store GeoJSON; listings do not).
 * @param {Object} listing Marketplace listing record.
 * @returns {{latitude: number, longitude: number}|null} Coordinate, or null.
 */
function readListingPoint(listing) {
  const coords = listing && listing.locationCoordinates;
  if (!coords || typeof coords !== 'object') {
    return null;
  }
  const latitude = Number(coords.lat ?? coords.latitude);
  const longitude = Number(coords.lng ?? coords.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  return null;
}

/**
 * Derive a listing's city from its own data, without ever guessing.
 *
 * Tried in order of how much each signal can be trusted: a geocoded
 * coordinate resolves to the nearest registry city, then the free-text
 * `location` is classified the same way a supplier's legacy location is —
 * an exact match on one city name is high-confidence, "Cardiff and the
 * valleys" or two named cities is left for a human, and anything that names
 * no city at all is unmapped.
 * @param {Object} listing Marketplace listing record.
 * @returns {{citySlug: string, source: string, confidence: string}|null} Mapping, or null.
 */
function deriveListingCitySlug(listing) {
  const point = readListingPoint(listing);
  if (point) {
    const nearest = registry.nearestCity(point);
    if (nearest) {
      return {
        citySlug: nearest.city.slug,
        source: MAPPING_SOURCES.postcodeLookup,
        confidence: CONFIDENCE.high,
      };
    }
  }

  const classification = supplierLocation.classifyLegacyLocation(listing && listing.location);
  if (classification.status === AUDIT_STATUSES.highConfidence && classification.citySlug) {
    return {
      citySlug: classification.citySlug,
      source: MAPPING_SOURCES.legacyText,
      confidence: CONFIDENCE.high,
    };
  }

  return null;
}

/**
 * A listing's city, preferring a previously stored mapping over deriving one
 * live on every request.
 * @param {Object} listing Marketplace listing record.
 * @returns {{citySlug: string, source: string, confidence: string}|null} Mapping, or null.
 */
function normaliseListingCitySlug(listing) {
  const stored = listing && listing.citySlug;
  if (stored && registry.getCity(stored)) {
    return {
      citySlug: stored,
      source: listing.citySlugSource || MAPPING_SOURCES.legacyText,
      confidence: listing.citySlugConfidence || CONFIDENCE.high,
    };
  }
  return deriveListingCitySlug(listing);
}

/**
 * Whether a listing may appear on any public location page.
 * @param {Object} listing Marketplace listing record.
 * @returns {boolean} True when the listing is a live, approved listing.
 */
function isEligibleForLocationPages(listing) {
  return Boolean(listing && listing.id && listing.approved === true && listing.status === 'active');
}

/**
 * Human-readable explanation of why a listing appears on a city page.
 * @param {string} relationship Relationship constant (`in_city` or `nearby`).
 * @param {Object} city City record.
 * @param {number|null} distanceMiles Distance, when known.
 * @returns {string} Label such as "Listed in Cardiff" or "12 miles from Cardiff".
 */
function listingRelationshipLabel(relationship, city, distanceMiles) {
  const name = city && city.name ? city.name : 'this area';
  if (relationship === 'in_city') {
    return `Listed in ${name}`;
  }
  if (relationship === 'nearby' && Number.isFinite(distanceMiles)) {
    return `${distanceMiles} ${distanceMiles === 1 ? 'mile' : 'miles'} from ${name}`;
  }
  return '';
}

/**
 * Determine how a listing relates to a city.
 *
 * `in_city` wins outright over `nearby`: a listing whose resolved city is
 * this one is never demoted just because its coordinate also happens to fall
 * within another city's catchment.
 * @param {Object} listing Marketplace listing record.
 * @param {Object} city City record from the registry.
 * @returns {{relationship: string, distanceMiles: number|null}|null} Match, or null.
 */
function matchListingToCity(listing, city) {
  if (!listing || !city) {
    return null;
  }

  const mapped = normaliseListingCitySlug(listing);
  if (mapped && mapped.citySlug === city.slug) {
    return { relationship: 'in_city', distanceMiles: null };
  }

  const point = readListingPoint(listing);
  if (point) {
    const distanceMiles = registry.distanceToCity(city, point);
    if (Number.isFinite(distanceMiles) && distanceMiles <= city.defaultServiceRadiusMiles) {
      return { relationship: 'nearby', distanceMiles: supplierLocation.roundMiles(distanceMiles) };
    }
  }

  return null;
}

/**
 * Rank eligible listings for a city, `in_city` first, then `nearby` by
 * distance, most recently listed first within a tie.
 * @param {Object[]} listings Marketplace listing records.
 * @param {Object} city City record.
 * @param {Object} [options] Options.
 * @param {number} [options.limit] Maximum results.
 * @returns {Object[]} Ranked `{listing, relationship, label, distanceMiles}`.
 */
function rankListingsForCity(listings, city, options = {}) {
  if (!city) {
    return [];
  }
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : Infinity;

  const matched = [];
  for (const listing of listings || []) {
    if (!isEligibleForLocationPages(listing)) {
      continue;
    }
    const match = matchListingToCity(listing, city);
    if (!match) {
      continue;
    }
    matched.push({
      listing,
      relationship: match.relationship,
      label: listingRelationshipLabel(match.relationship, city, match.distanceMiles),
      distanceMiles: match.distanceMiles,
    });
  }

  matched.sort((a, b) => {
    if (a.relationship !== b.relationship) {
      return a.relationship === 'in_city' ? -1 : 1;
    }
    if (a.relationship === 'nearby' && a.distanceMiles !== b.distanceMiles) {
      return a.distanceMiles - b.distanceMiles;
    }
    return new Date(b.listing.createdAt || 0) - new Date(a.listing.createdAt || 0);
  });

  return matched.slice(0, limit);
}

module.exports = {
  deriveListingCitySlug,
  isEligibleForLocationPages,
  listingRelationshipLabel,
  matchListingToCity,
  normaliseListingCitySlug,
  rankListingsForCity,
  readListingPoint,
};
