/**
 * Curated Pexels photography for the first public location pages.
 *
 * A stored editorial image always wins. These entries are safe defaults for a
 * city that has not yet had a hero selected in the location editor, so public
 * pages never fall back to an unrelated generic event photograph.
 */

'use strict';

const IMAGE_PARAMS = 'auto=compress&cs=tinysrgb&w=1600&h=1100&fit=crop';

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

module.exports = {
  CITY_HEROES,
  findCuratedHeroByUrl,
  getCuratedHero,
};
