/**
 * EventFlow UK city registry
 *
 * A single source of truth for the places EventFlow recognises. The registry is
 * repository-backed (`data/uk-cities.json`) so a city entity can never appear or
 * disappear because a database write failed, while everything editorial lives in
 * the `location_pages` collection and is merged on read.
 *
 * Cardiff and Caerdydd are the same entity: alternative names resolve to the
 * canonical slug rather than creating a second city.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');
const { calculateDistance, isValidUKPostcode } = require('../utils/geocoding');

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'uk-cities.json');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 60;

// Rough bounding box for the United Kingdom, used to reject registry entries
// whose coordinates were transposed or entered in the wrong order.
const UK_BOUNDS = {
  minLatitude: 49.5,
  maxLatitude: 61.0,
  minLongitude: -8.7,
  maxLongitude: 2.1,
};

const VALID_NATIONS = ['England', 'Scotland', 'Wales', 'Northern Ireland'];

let cachedRegistry = null;

/**
 * Normalise arbitrary user or supplier input into a candidate slug.
 *
 * Accents are folded so "Bangor " and "bangor" agree, and anything that is not
 * a letter or digit becomes a single hyphen.
 * @param {string} value Raw value.
 * @returns {string} Normalised slug, or an empty string when unusable.
 */
function normaliseSlug(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Test whether a value is already a well-formed registry slug.
 * @param {string} value Candidate slug.
 * @returns {boolean} True when the value is safe to use in a URL path.
 */
function isValidSlug(value) {
  const candidate = String(value === null || value === undefined ? '' : value);
  return (
    candidate.length > 0 && candidate.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(candidate)
  );
}

/**
 * Validate one registry entry.
 * @param {Object} entry Raw entry from the registry file.
 * @param {number} index Position in the file, used in error messages.
 * @returns {string[]} Human-readable problems; empty when the entry is valid.
 */
function validateEntry(entry, index) {
  const problems = [];
  const label = entry && entry.slug ? entry.slug : `entry ${index}`;

  if (!entry || typeof entry !== 'object') {
    return [`${label}: entry is not an object`];
  }
  if (!isValidSlug(entry.slug)) {
    problems.push(`${label}: slug is missing or malformed`);
  }
  if (!entry.name || typeof entry.name !== 'string') {
    problems.push(`${label}: name is required`);
  }
  if (!VALID_NATIONS.includes(entry.nation)) {
    problems.push(`${label}: nation must be one of ${VALID_NATIONS.join(', ')}`);
  }

  const centre = entry.centre || {};
  const latitude = Number(centre.latitude);
  const longitude = Number(centre.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    problems.push(`${label}: centre coordinates are missing`);
  } else if (
    latitude < UK_BOUNDS.minLatitude ||
    latitude > UK_BOUNDS.maxLatitude ||
    longitude < UK_BOUNDS.minLongitude ||
    longitude > UK_BOUNDS.maxLongitude
  ) {
    problems.push(`${label}: centre coordinates fall outside the United Kingdom`);
  }

  const radius = Number(entry.defaultServiceRadiusMiles);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 200) {
    problems.push(`${label}: defaultServiceRadiusMiles must be between 1 and 200`);
  }

  if (entry.alternateNames && !Array.isArray(entry.alternateNames)) {
    problems.push(`${label}: alternateNames must be an array`);
  }
  if (entry.nearbyLocationSlugs && !Array.isArray(entry.nearbyLocationSlugs)) {
    problems.push(`${label}: nearbyLocationSlugs must be an array`);
  }

  return problems;
}

/**
 * Freeze a validated entry into the shape the rest of the platform consumes.
 *
 * GeoJSON is stored `[longitude, latitude]` throughout EventFlow; the plain
 * `centre` object is kept alongside it because the distance helper takes
 * latitude and longitude separately.
 * @param {Object} entry Validated registry entry.
 * @returns {Object} Normalised, frozen city record.
 */
function freezeEntry(entry) {
  const latitude = Number(entry.centre.latitude);
  const longitude = Number(entry.centre.longitude);
  return Object.freeze({
    slug: entry.slug,
    name: entry.name,
    alternateNames: Object.freeze([...(entry.alternateNames || [])]),
    nation: entry.nation,
    region: entry.region || null,
    centre: Object.freeze({ latitude, longitude }),
    coordinates: Object.freeze({
      type: 'Point',
      coordinates: Object.freeze([longitude, latitude]),
    }),
    defaultServiceRadiusMiles: Number(entry.defaultServiceRadiusMiles),
    nearbyLocationSlugs: Object.freeze([...(entry.nearbyLocationSlugs || [])]),
  });
}

/**
 * Load, validate and index the registry file.
 *
 * A malformed registry is a deployment error, not a runtime condition to paper
 * over: the loader throws rather than serving a half-built list of cities.
 * @param {Object} [options] Loader options.
 * @param {boolean} [options.force] Rebuild even when a cached copy exists.
 * @returns {Object} Registry index with cities, alias map and problems.
 */
function loadRegistry(options = {}) {
  if (cachedRegistry && !options.force) {
    return cachedRegistry;
  }

  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('City registry must be a JSON array');
  }

  const problems = [];
  const bySlug = new Map();
  const byAlias = new Map();

  parsed.forEach((entry, index) => {
    const entryProblems = validateEntry(entry, index);
    if (entryProblems.length) {
      problems.push(...entryProblems);
      return;
    }
    if (bySlug.has(entry.slug)) {
      problems.push(`${entry.slug}: duplicate slug`);
      return;
    }

    const city = freezeEntry(entry);
    bySlug.set(city.slug, city);

    // The canonical name and every alternative name resolve to the same entity.
    // A collision means two cities claim the same alias, which would make the
    // resolution order significant — refuse it rather than pick a winner.
    const aliases = [city.slug, city.name, ...city.alternateNames];
    for (const alias of aliases) {
      const key = normaliseSlug(alias);
      if (!key) {
        continue;
      }
      const existing = byAlias.get(key);
      if (existing && existing !== city.slug) {
        problems.push(`${city.slug}: alias "${alias}" already resolves to ${existing}`);
        continue;
      }
      byAlias.set(key, city.slug);
    }
  });

  // Nearby links must point at cities that exist, or the "nearby areas" module
  // would advertise dead ends.
  for (const city of bySlug.values()) {
    for (const nearby of city.nearbyLocationSlugs) {
      if (!bySlug.has(nearby)) {
        problems.push(`${city.slug}: nearby slug "${nearby}" is not in the registry`);
      }
      if (nearby === city.slug) {
        problems.push(`${city.slug}: is listed as its own nearby location`);
      }
    }
  }

  if (problems.length) {
    throw new Error(`City registry is invalid:\n- ${problems.join('\n- ')}`);
  }

  cachedRegistry = {
    cities: Object.freeze([...bySlug.values()]),
    bySlug,
    byAlias,
  };
  return cachedRegistry;
}

/**
 * Clear the in-process registry cache. Intended for tests and the audit script.
 * @returns {void} Nothing.
 */
function resetRegistryCache() {
  cachedRegistry = null;
}

/**
 * Every city in the registry, in file order.
 * @returns {Object[]} Frozen city records.
 */
function listCities() {
  return loadRegistry().cities;
}

/**
 * Look up a city by its canonical slug only.
 * @param {string} slug Canonical slug.
 * @returns {Object|null} City record, or null.
 */
function getCity(slug) {
  if (!isValidSlug(slug)) {
    return null;
  }
  return loadRegistry().bySlug.get(slug) || null;
}

/**
 * Resolve any recognised name, alias or slug spelling to a city.
 *
 * Returns the match alongside whether the input was already canonical, so a
 * route can answer "redirect" versus "render" without a second lookup.
 * @param {string} value Slug, canonical name or alternative name.
 * @returns {{city: Object, canonical: boolean}|null} Resolution, or null.
 */
function resolveCity(value) {
  const key = normaliseSlug(value);
  if (!key) {
    return null;
  }
  const slug = loadRegistry().byAlias.get(key);
  if (!slug) {
    return null;
  }
  const city = getCity(slug);
  if (!city) {
    return null;
  }
  return { city, canonical: String(value) === city.slug };
}

/**
 * Resolve the alias a URL used back to its canonical slug.
 * @param {string} value Any recognised spelling.
 * @returns {string} Canonical slug, or an empty string.
 */
function canonicalSlugFor(value) {
  const resolved = resolveCity(value);
  return resolved ? resolved.city.slug : '';
}

/**
 * Cities listed as nearby, resolved to records and filtered by a predicate.
 *
 * The predicate is how the page framework keeps unpublished cities out of the
 * "nearby areas" module without the registry needing to know about publication.
 * @param {string} slug Canonical slug.
 * @param {Function} [isAllowed] Optional filter receiving each city record.
 * @returns {Object[]} Nearby city records.
 */
function nearbyCities(slug, isAllowed) {
  const city = getCity(slug);
  if (!city) {
    return [];
  }
  return city.nearbyLocationSlugs
    .map(nearbySlug => getCity(nearbySlug))
    .filter(Boolean)
    .filter(nearby => (typeof isAllowed === 'function' ? isAllowed(nearby) : true));
}

/**
 * Free-text city search for the hub page's search box.
 *
 * Matches a prefix of the canonical name or of any alternative name, so
 * "caer" finds Cardiff for a Welsh-speaking visitor.
 * @param {string} query Search text.
 * @param {number} [limit] Maximum results.
 * @returns {Object[]} Matching city records.
 */
function searchCities(query, limit = 10) {
  const needle = normaliseSlug(query);
  if (!needle) {
    return [];
  }
  const exact = [];
  const prefix = [];
  const contains = [];

  for (const city of listCities()) {
    const haystacks = [city.slug, ...city.alternateNames.map(normaliseSlug)];
    if (haystacks.some(value => value === needle)) {
      exact.push(city);
    } else if (haystacks.some(value => value.startsWith(needle))) {
      prefix.push(city);
    } else if (haystacks.some(value => value.includes(needle))) {
      contains.push(city);
    }
  }

  return [...exact, ...prefix, ...contains].slice(0, Math.max(0, limit));
}

/**
 * Distance in miles between a coordinate and a city centre.
 * @param {Object} city City record.
 * @param {{latitude: number, longitude: number}} point Coordinate.
 * @returns {number|null} Distance in miles, or null when either side is unusable.
 */
function distanceToCity(city, point) {
  if (!city || !point) {
    return null;
  }
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return calculateDistance(city.centre.latitude, city.centre.longitude, latitude, longitude);
}

/**
 * The registry city nearest to a coordinate, within an optional cutoff.
 * @param {{latitude: number, longitude: number}} point Coordinate.
 * @param {Object} [options] Options.
 * @param {number} [options.maxMiles] Reject matches beyond this distance.
 * @returns {{city: Object, distanceMiles: number}|null} Nearest city, or null.
 */
function nearestCity(point, options = {}) {
  const maxMiles = Number.isFinite(Number(options.maxMiles)) ? Number(options.maxMiles) : 30;
  let best = null;

  for (const city of listCities()) {
    const distanceMiles = distanceToCity(city, point);
    if (distanceMiles === null) {
      return null;
    }
    if (!best || distanceMiles < best.distanceMiles) {
      best = { city, distanceMiles };
    }
  }

  if (!best || best.distanceMiles > maxMiles) {
    return null;
  }
  return best;
}

/**
 * Resolve a UK postcode to a registry city using the existing Postcodes.io
 * integration, falling back to the nearest city centre.
 *
 * Postcodes.io is the geocoder EventFlow already runs; the registry supplies
 * the city identity it cannot, which is the gap the plan calls out.
 * @param {string} postcode UK postcode.
 * @param {Object} [dependencies] Injected geocoder, for tests.
 * @returns {Promise<Object|null>} `{city, distanceMiles, coordinates}` or null.
 */
async function resolvePostcodeToCity(postcode, dependencies = {}) {
  if (!isValidUKPostcode(postcode)) {
    return null;
  }
  const geocode = dependencies.geocodePostcode || require('../utils/geocoding').geocodePostcode;

  let result = null;
  try {
    result = await geocode(postcode);
  } catch (error) {
    logger.warn('Postcode lookup failed while resolving a city:', error.message);
    return null;
  }
  if (!result || !Number.isFinite(Number(result.latitude))) {
    return null;
  }

  const point = { latitude: Number(result.latitude), longitude: Number(result.longitude) };
  const nearest = nearestCity(point, { maxMiles: dependencies.maxMiles });
  if (!nearest) {
    return null;
  }
  return {
    city: nearest.city,
    distanceMiles: nearest.distanceMiles,
    coordinates: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    postcode: result.postcode || String(postcode).toUpperCase(),
  };
}

module.exports = {
  UK_BOUNDS,
  VALID_NATIONS,
  canonicalSlugFor,
  distanceToCity,
  getCity,
  isValidSlug,
  listCities,
  loadRegistry,
  nearbyCities,
  nearestCity,
  normaliseSlug,
  resetRegistryCache,
  resolveCity,
  resolvePostcodeToCity,
  searchCities,
};
