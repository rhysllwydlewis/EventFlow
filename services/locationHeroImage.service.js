/**
 * City-specific Pexels photography for public location pages.
 *
 * A stored editorial image always wins. Reviewed entries cover cities where a
 * known photo is already available; every other registry city is resolved from
 * a precise city, region and nation search through the existing Pexels service.
 */

'use strict';

const logger = require('../utils/logger');
const { getPexelsService } = require('../utils/pexels-service');

const IMAGE_PARAMS = 'auto=compress&cs=tinysrgb&w=1600&h=1100&fit=crop';
const AUTO_HERO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const autoHeroCache = new Map();

const CITY_HEROES = Object.freeze({
  cardiff: Object.freeze({
    url: `https://images.pexels.com/photos/5743996/pexels-photo-5743996.jpeg?${IMAGE_PARAMS}`,
    alt: 'Cardiff Bay waterfront with the red-brick Pierhead Building and city skyline',
    credit: 'Balazs Bezeczky',
    sourceUrl: 'https://www.pexels.com/photo/cardiff-bay-5743996/',
  }),
  bristol: Object.freeze({
    url: `https://images.pexels.com/photos/19100348/pexels-photo-19100348.jpeg?${IMAGE_PARAMS}`,
    alt: 'Clifton Suspension Bridge illuminated above the Avon Gorge in Bristol at dusk',
    credit: 'Boys in Bristol Photography',
    sourceUrl:
      'https://www.pexels.com/photo/clifton-suspension-bridge-at-dusk-bristol-england-19100348/',
  }),
  newport: Object.freeze({
    url: `https://images.pexels.com/photos/34106705/pexels-photo-34106705.jpeg?${IMAGE_PARAMS}`,
    alt: 'Aerial view across Newport in South Wales',
    credit: 'Altaf Shah',
    sourceUrl: 'https://www.pexels.com/photo/aerial-view-of-industrial-area-in-wales-34106705/',
  }),
});

/**
 * Return a copy of the curated hero for a city.
 * @param {Object|string} city City record or slug.
 * @returns {Object|null} Curated hero details.
 */
function getCuratedHero(city) {
  const slug = typeof city === 'string' ? city : city && city.slug;
  const hero = CITY_HEROES[String(slug || '').toLowerCase()];
  return hero ? { ...hero } : null;
}

/**
 * Recognise a curated URL even when its Pexels transform parameters differ.
 * @param {string} url Candidate image URL.
 * @returns {Object|null} Matching curated hero details.
 */
function findCuratedHeroByUrl(url) {
  const candidate = String(url || '').split('?')[0];
  if (!candidate) {
    return null;
  }
  for (const hero of Object.values(CITY_HEROES)) {
    if (hero.url.split('?')[0] === candidate) {
      return { ...hero };
    }
  }
  return null;
}

/**
 * Reduce a value to characters that cannot forge a log entry.
 *
 * Anything reaching the log here has travelled through a request path or an
 * external API response, and a newline in a log line is enough to fabricate a
 * separate entry, so the alphabet is restricted rather than merely escaped.
 * @param {unknown} value Candidate value.
 * @param {number} maxLength Maximum characters to keep.
 * @returns {string} Log-safe text.
 */
function forLog(value, maxLength) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[^a-z0-9 ._:/-]/gi, '')
    .slice(0, maxLength);
}

/**
 * Build a disambiguated Pexels query for any registered UK city.
 * @param {Object} city Registry city record.
 * @returns {string} Search query.
 */
function buildCitySearchQuery(city) {
  return [
    city && city.name,
    city && city.region,
    city && city.nation,
    'United Kingdom city landmark',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Normalise text for geographic relevance scoring.
 * @param {unknown} value Candidate text.
 * @returns {string} Comparable text.
 */
function comparableText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether a Pexels result actually says it is of this place.
 *
 * A search for "Bath Somerset England United Kingdom city landmark" will still
 * return results when Pexels holds no photograph of Bath, and the top one is
 * then simply the most popular landscape photo of somewhere else. Publishing
 * that as the city's hero — under alt text the page presents as this city —
 * would be inventing local evidence, which is the one thing these pages exist
 * to avoid. So an automatic photo has to name the city or its region in its own
 * metadata; anything less falls back to the named-city placeholder.
 * @param {Object} photo Pexels photo.
 * @param {Object} city Registry city record.
 * @returns {boolean} True when the result names the place.
 */
function photoNamesPlace(photo, city) {
  const corpus = comparableText(`${(photo && photo.alt) || ''} ${(photo && photo.url) || ''}`);
  if (!corpus) {
    return false;
  }
  const names = [city.name, ...(city.alternateNames || []), city.region]
    .map(comparableText)
    .filter(Boolean);
  return names.some(name => corpus.includes(name));
}

/**
 * Prefer results whose Pexels description explicitly names the city or region.
 * API result order remains the final tie-breaker because it reflects the full
 * city-specific search query.
 * @param {Object} photo Pexels photo.
 * @param {Object} city Registry city record.
 * @param {number} index Original result position.
 * @returns {number} Relevance score.
 */
function scorePhoto(photo, city, index) {
  const corpus = comparableText(`${photo.alt || ''} ${photo.url || ''}`);
  const names = [city.name, ...(city.alternateNames || [])].map(comparableText).filter(Boolean);
  let score = Math.max(0, 20 - index);
  if (names.some(name => corpus.includes(name))) {
    score += 100;
  }
  if (city.region && corpus.includes(comparableText(city.region))) {
    score += 25;
  }
  if (city.nation && corpus.includes(comparableText(city.nation))) {
    score += 10;
  }
  if (Number(photo.width) > Number(photo.height)) {
    score += 5;
  }
  return score;
}

/**
 * Keep only Pexels-owned photo and image URLs.
 * @param {unknown} value Candidate URL.
 * @param {string[]} allowedHosts Exact allowed hosts.
 * @returns {URL|null} Parsed safe URL.
 */
function pexelsUrl(value, allowedHosts) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && allowedHosts.includes(parsed.hostname) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Convert one Pexels API result to the location-page hero contract.
 * @param {Object} photo Pexels photo.
 * @param {Object} city Registry city record.
 * @returns {Object|null} Hero or null for an unsafe/incomplete response.
 */
function heroFromPhoto(photo, city) {
  const image = pexelsUrl(
    photo &&
      photo.src &&
      (photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original),
    ['images.pexels.com']
  );
  const source = pexelsUrl(photo && photo.url, ['www.pexels.com', 'pexels.com']);
  if (!image || !source) {
    return null;
  }
  image.search = IMAGE_PARAMS;
  return {
    url: image.toString(),
    alt: String((photo && photo.alt) || `${city.name} city landmark`).trim(),
    credit: String((photo && photo.photographer) || 'Pexels').trim(),
    sourceUrl: source.toString(),
  };
}

/**
 * Resolve an automatic Pexels hero for any registered city.
 * @param {Object} city Registry city record.
 * @param {Object} [options] Test/runtime dependencies.
 * @param {Object} [options.pexels] Pexels service.
 * @param {number} [options.now] Current timestamp.
 * @returns {Promise<Object|null>} Resolved hero or null when Pexels is unavailable.
 */
async function resolveAutomaticHero(city, options = {}) {
  if (!city || !city.slug) {
    return null;
  }
  const curated = getCuratedHero(city);
  if (curated) {
    return curated;
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cached = autoHeroCache.get(city.slug);
  if (cached && now < cached.expiresAt) {
    return { ...cached.hero };
  }

  const pexels = options.pexels || getPexelsService();
  if (!pexels || !pexels.isConfigured()) {
    return null;
  }

  try {
    const result = await pexels.searchPhotos(buildCitySearchQuery(city), 12, 1, {
      orientation: 'landscape',
      size: 'large',
    });
    const candidates = (result.photos || [])
      .map((photo, index) => ({ hero: heroFromPhoto(photo, city), photo, index }))
      .filter(candidate => candidate.hero && photoNamesPlace(candidate.photo, city))
      .sort(
        (left, right) =>
          scorePhoto(right.photo, city, right.index) - scorePhoto(left.photo, city, left.index)
      );
    const hero = candidates.length ? candidates[0].hero : null;
    if (hero) {
      autoHeroCache.set(city.slug, { hero, expiresAt: now + AUTO_HERO_CACHE_TTL_MS });
      return { ...hero };
    }
  } catch (error) {
    // The slug reaches this line from the request path and the message from an
    // external API, so both are stripped to a safe alphabet before they are
    // written: a newline in a log line lets an attacker forge log entries.
    logger.warn(
      `Could not resolve a Pexels location hero for ${forLog(city.slug, 64)}: ${forLog(error.message, 200)}`
    );
  }
  return null;
}

/**
 * Add an automatic hero only when the page has no stored or curated image.
 * @param {Object} city Registry city record.
 * @param {Object} page Normalised location page.
 * @param {Object} [options] Resolver dependencies.
 * @returns {Promise<Object>} Page with its effective hero.
 */
async function resolvePageHero(city, page, options = {}) {
  if (!page || (page.content && page.content.heroImageUrl)) {
    return page;
  }
  const hero = await resolveAutomaticHero(city, options);
  if (!hero) {
    return page;
  }
  return {
    ...page,
    content: {
      ...page.content,
      heroImageUrl: hero.url,
      heroImageAlt: hero.alt,
      heroImageCredit: hero.credit,
      heroImageSourceUrl: hero.sourceUrl,
    },
  };
}

/** Clear automatic results after tests or configuration changes. */
function resetAutomaticHeroCache() {
  autoHeroCache.clear();
}

module.exports = {
  CITY_HEROES,
  buildCitySearchQuery,
  findCuratedHeroByUrl,
  getCuratedHero,
  heroFromPhoto,
  resetAutomaticHeroCache,
  resolveAutomaticHero,
  resolvePageHero,
  scorePhoto,
};
