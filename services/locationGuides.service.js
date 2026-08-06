/**
 * EventFlow UK locations — related planning guides
 *
 * EventFlow already publishes general event-planning guides (venue
 * selection, caterer choice, budgeting and so on). They are not local
 * knowledge — nothing here claims to know anything specific about a city —
 * but a guide relevant to the categories a city actually has suppliers in is
 * genuinely useful to link from that city's page, the same way the page
 * already links to nearby cities without asserting anything false about them.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

const GUIDES_PATH = path.join(__dirname, '..', 'public', 'assets', 'data', 'guides.json');
const MAX_GUIDES = 3;

let cachedGuides = null;

/**
 * Read and parse the published guides catalogue, once per process.
 * @returns {Object[]} Guides, or an empty array if the file is missing or malformed.
 */
function loadGuides() {
  if (cachedGuides) {
    return cachedGuides;
  }
  try {
    const raw = fs.readFileSync(GUIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cachedGuides = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn('Could not read the guides catalogue:', error.message);
    cachedGuides = [];
  }
  return cachedGuides;
}

/**
 * Normalise text for a loose, case-insensitive category match.
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
 * Guides relevant to a city's actual supplier categories.
 *
 * Falls back to the site's generally featured guides when nothing on the
 * page matches a guide's category — still genuinely useful, and never framed
 * as anything specific to the city.
 * @param {{name: string}[]} categories Populated categories for the page.
 * @returns {{title: string, href: string, excerpt: string}[]} Up to three guides.
 */
function relatedGuides(categories = []) {
  const guides = loadGuides();
  const wanted = new Set((categories || []).map(entry => comparable(entry && entry.name)));
  // A page with no supplier categories yet has no real context to link
  // guides against, so it gets none — the same restraint the composed
  // introduction already applies to a city with no suppliers.
  if (!guides.length || !wanted.size) {
    return [];
  }

  const matched = guides.filter(guide => wanted.has(comparable(guide && guide.category)));
  const source = matched.length ? matched : guides.filter(guide => guide && guide.featured);

  return source
    .slice()
    .sort((a, b) => (Number(a.featuredOrder) || 99) - (Number(b.featuredOrder) || 99))
    .slice(0, MAX_GUIDES)
    .map(guide => ({
      title: String((guide && guide.title) || '').trim(),
      href: safeInternalHref(guide && guide.href),
      excerpt: String((guide && (guide.excerpt || guide.description)) || '').trim(),
    }))
    .filter(guide => guide.title && guide.href);
}

/** Clear the cached catalogue. Used by tests. */
function resetGuidesCache() {
  cachedGuides = null;
}

module.exports = { relatedGuides, resetGuidesCache };
