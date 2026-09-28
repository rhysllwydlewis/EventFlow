/**
 * City-specific Pexels photography for public location pages.
 *
 * A stored editorial image always wins. Reviewed entries cover cities where a
 * known photo is already available; every other registry city is resolved from
 * a precise city, region and nation search through the existing Pexels service.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { getPexelsService } = require('../utils/pexels-service');

const HEROES_PATH = path.join(__dirname, '..', 'data', 'location-heroes.json');
const IMAGE_PARAMS = 'auto=compress&cs=tinysrgb&w=1600&h=1100&fit=crop';
const AUTO_HERO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const autoHeroCache = new Map();

// One reviewed photograph per registry city and county. The automatic search
// below only accepts results whose own metadata names the place, and Pexels
// rarely names counties or smaller cities that way, so without these the
// homepage grid and location pages fell back to plain placeholders. Each
// entry was checked against its Pexels page, including the photo's recorded
// location. Where Pexels holds nothing of a place, the alt text says what the
// photo actually shows (e.g. a nearby landmark) rather than claiming it.
const CITY_HEROES = Object.freeze(
  Object.fromEntries(
    Object.entries(JSON.parse(fs.readFileSync(HEROES_PATH, 'utf8'))).map(([slug, hero]) => [
      slug,
      Object.freeze({
        url: `${hero.image}?${IMAGE_PARAMS}`,
        alt: hero.alt,
        credit: hero.credit,
        sourceUrl: hero.sourceUrl,
      }),
    ])
  )
);

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
  return (
    String(value === null || value === undefined ? '' : value)
      // The line break is removed first and on its own. Forging a log entry
      // needs a newline, so that is the property worth stating explicitly
      // rather than leaving it implied by the allowlist below.
      .replace(/[\r\n]/g, ' ')
      .replace(/[^a-z0-9 ._:/-]/gi, '')
      .slice(0, maxLength)
  );
}

/**
 * "City landmark" reads oddly for a county-scale entry (e.g. Ceredigion) —
 * both the Pexels query and the hero's fallback alt text ask for the kind of
 * photograph that actually suits what the place is.
 * @param {Object} city Registry entry (city or county).
 * @returns {string} Search/description suffix.
 */
function locationPhotoSubject(city) {
  return city && city.type === 'county' ? 'countryside landscape' : 'city landmark';
}

/**
 * Build a disambiguated Pexels query for any registered UK city or county.
 * @param {Object} city Registry city record.
 * @returns {string} Search query.
 */
function buildCitySearchQuery(city) {
  return [
    city && city.name,
    city && city.region,
    city && city.nation,
    `United Kingdom ${locationPhotoSubject(city)}`,
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
    alt: String((photo && photo.alt) || `${city.name} ${locationPhotoSubject(city)}`).trim(),
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
    // They are passed as structured metadata rather than interpolated into the
    // message so the line the log writes is a constant, whatever they contain.
    logger.warn('Could not resolve a Pexels location hero', {
      citySlug: forLog(city.slug, 64),
      error: forLog(error.message, 200),
    });
  }
  return null;
}

/**
 * Add an automatic hero unless an editor has pinned a custom image.
 *
 * A city defaults to `auto`, so the resolver keeps refreshing its photograph
 * the way every city did before this toggle existed. Switching a city to
 * `custom` pins whatever image an editor has stored — including a broken or
 * momentarily empty one — deliberately: that is the point of the toggle, and
 * silently falling back to Pexels the instant a custom URL is unreachable
 * would defeat it. A `custom` city with nothing stored yet still gets the
 * automatic photo, since there is no pinned image to show instead.
 * @param {Object} city Registry city record.
 * @param {Object} page Normalised location page.
 * @param {Object} [options] Resolver dependencies.
 * @returns {Promise<Object>} Page with its effective hero.
 */
async function resolvePageHero(city, page, options = {}) {
  if (!page) {
    return page;
  }
  const isCustom = page.content && page.content.heroSource === 'custom';
  if (isCustom && page.content.heroImageUrl) {
    return page;
  }
  const hero = await resolveAutomaticHero(city, options);
  if (!hero) {
    // Auto mode never renders a stale custom image left over from a previous
    // toggle: with no fresh automatic photo either, the page falls through to
    // the named-city placeholder rather than showing an image the editor did
    // not choose for this mode.
    return page.content && page.content.heroImageUrl
      ? { ...page, content: { ...page.content, heroImageUrl: null } }
      : page;
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
