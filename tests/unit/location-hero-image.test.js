/**
 * Curated city-specific Pexels hero defaults.
 */

'use strict';

const heroImages = require('../../services/locationHeroImage.service');

describe('city hero defaults', () => {
  it.each([
    ['cardiff', '5743996', /Cardiff/i],
    ['bristol', '19100348', /Bristol|Clifton/i],
    ['newport', '34106705', /Newport/i],
  ])('uses a geographically specific Pexels photo for %s', (slug, photoId, cityPattern) => {
    const hero = heroImages.getCuratedHero(slug);

    expect(hero.url).toContain(`images.pexels.com/photos/${photoId}/`);
    expect(hero.alt).toMatch(cityPattern);
    expect(hero.credit).toBeTruthy();
    expect(hero.sourceUrl).toMatch(/^https:\/\/www\.pexels\.com\/photo\//);
  });

  it('does not reuse one generic image across the cities', () => {
    const urls = ['cardiff', 'bristol', 'newport'].map(slug => heroImages.getCuratedHero(slug).url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('has no invented fallback for a city that has not been curated', () => {
    expect(heroImages.getCuratedHero('city-not-yet-reviewed')).toBeNull();
  });

  it('recognises a curated Pexels photo when transform parameters change', () => {
    const hero = heroImages.findCuratedHeroByUrl(
      'https://images.pexels.com/photos/5743996/pexels-photo-5743996.jpeg?w=800'
    );
    expect(hero).toEqual(expect.objectContaining({ credit: 'Balazs Bezeczky' }));
  });
});
