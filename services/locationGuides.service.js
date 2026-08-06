/**
 * EventFlow UK locations — related planning guides
 *
 * EventFlow already publishes general event-planning guides (venue
 * selection, caterer choice, budgeting and so on). Most are not local
 * knowledge — nothing in a generic guide claims to know anything specific
 * about a city — so they are linked by matching the categories a city
 * actually has suppliers in, the same way the page already links to nearby
 * cities without asserting anything false about them.
 *
 * A guide can also be genuinely about a specific place: give it a `cities`
 * array of registry slugs in its catalogue entry and it becomes eligible only
 * for those cities' pages, ahead of anything category-matched. It is
 * deliberately never inferred by scanning a guide's text for a place name —
 * a guide that merely mentions a city in passing is not a guide about that
 * city, and treating it as one would be exactly the kind of thin, misleading
 * association this whole feature has avoided everywhere else. The catalogue
 * entry has to say so explicitly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', 'public', 'assets', 'data');
// Both files back the public /guides hub; a guide added to either one should
// be just as eligible for a city page as the other.
const GUIDES_PATHS = [
  path.join(DATA_DIR, 'guides.json'),
  path.join(DATA_DIR, 'guides-eventflow-pack.json'),
];
const MAX_GUIDES = 3;

let cachedGuides = null;

/**
 * Read and parse the published guides catalogues, once per process.
 * @returns {Object[]} Guides, or an empty array if none could be read.
 */
function loadGuides() {
  if (cachedGuides) {
    return cachedGuides;
  }
  cachedGuides = GUIDES_PATHS.flatMap(guidesPath => {
    try {
      const parsed = JSON.parse(fs.readFileSync(guidesPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logger.warn(`Could not read the guides catalogue at ${guidesPath}:`, error.message);
      return [];
    }
  });
  return cachedGuides;
}

/**
 * Normalise text for a loose, case-insensitive match.
 * @param {unknown} value Candidate text.
 * @returns {string} Comparable text.
 */
function comparable(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * A guide's internal link, kept to an ordinary site-relative path.
 * @param {unknown} value Candidate href.
 * @returns {string|null} Safe path, or null.
 */
function safeInternalHref(value) {
  const candidate = String(value || '');
  return /^\/[a-zA-Z0-9/_-]*$/.test(candidate) ? candidate : null;
}

/**
 * Whether a guide is pinned to specific cities via its own catalogue entry.
 * @param {Object} guide Catalogue entry.
 * @returns {boolean} True when the guide names any cities at all.
 */
function isCitySpecific(guide) {
  return Array.isArray(guide && guide.cities) && guide.cities.length > 0;
}

/**
 * Shape a catalogue entry into what a city page renders.
 * @param {Object} guide Catalogue entry.
 * @returns {{title: string, href: string, excerpt: string}} Rendered guide.
 */
function toRenderedGuide(guide) {
  return {
    title: String((guide && guide.title) || '').trim(),
    href: safeInternalHref(guide && guide.href),
    excerpt: String((guide && (guide.excerpt || guide.description)) || '').trim(),
  };
}

/**
 * Guides relevant to one city: guides explicitly written for it first, then
 * guides matching the categories it actually has suppliers in.
 *
 * A guide pinned to other cities never appears here on the strength of a
 * category match alone — it was written to be specific, so showing it
 * somewhere it was not written for would misrepresent it. A city-agnostic
 * guide (no `cities` on its catalogue entry) remains eligible everywhere its
 * category fits, exactly as before. Falls back to the site's generally
 * featured guides when nothing else matches — still genuinely useful, and
 * still never framed as anything specific to the city.
 * @param {{name: string}[]} categories Populated categories for the page.
 * @param {string} [citySlug] The current city's registry slug.
 * @returns {{title: string, href: string, excerpt: string}[]} Up to three guides.
 */
function relatedGuides(categories = [], citySlug = '') {
  const guides = loadGuides();
  if (!guides.length) {
    return [];
  }

  const slug = comparable(citySlug);
  const pinned = slug
    ? guides.filter(
        guide => isCitySpecific(guide) && guide.cities.some(city => comparable(city) === slug)
      )
    : [];

  const wanted = new Set((categories || []).map(entry => comparable(entry && entry.name)));
  // A page with no supplier categories yet has no real context to fall back
  // on, so it gets no category/featured guides at all — the same restraint
  // the composed introduction already applies. A guide written specifically
  // for this city is unaffected: it stands on its own regardless.
  const categoryEligible = guides.filter(guide => !isCitySpecific(guide));
  const matched = wanted.size
    ? categoryEligible.filter(guide => wanted.has(comparable(guide && guide.category)))
    : [];
  const fallback = !wanted.size
    ? []
    : matched.length
      ? matched
      : categoryEligible.filter(guide => guide && guide.featured);

  const seen = new Set();
  const ordered = [...pinned, ...fallback].filter(guide => {
    const key = String((guide && guide.id) || guide.href);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (!ordered.length) {
    return [];
  }

  return ordered
    .sort((a, b) => {
      const aPinned = isCitySpecific(a) ? 0 : 1;
      const bPinned = isCitySpecific(b) ? 0 : 1;
      return aPinned - bPinned || (Number(a.featuredOrder) || 99) - (Number(b.featuredOrder) || 99);
    })
    .slice(0, MAX_GUIDES)
    .map(toRenderedGuide)
    .filter(guide => guide.title && guide.href);
}

/** Clear the cached catalogue. Used by tests. */
function resetGuidesCache() {
  cachedGuides = null;
}

module.exports = { relatedGuides, resetGuidesCache };
