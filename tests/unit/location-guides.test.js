/**
 * Related planning guides on a city page.
 */

'use strict';

const { relatedGuides, resetGuidesCache } = require('../../services/locationGuides.service');

beforeEach(() => {
  resetGuidesCache();
});

describe('relatedGuides', () => {
  it('picks guides matching the city’s actual supplier categories', () => {
    const guides = relatedGuides([{ name: 'Venues' }]);
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.length).toBeLessThanOrEqual(3);
    guides.forEach(guide => {
      expect(guide.title).toBeTruthy();
      expect(guide.href).toMatch(/^\//);
    });
  });

  it('falls back to featured guides when no category matches', () => {
    const guides = relatedGuides([{ name: 'Some Category Nobody Has A Guide For' }]);
    expect(guides.length).toBeGreaterThan(0);
  });

  it('returns nothing for a city with no categories yet, rather than a random guess', () => {
    expect(relatedGuides([])).toEqual([]);
  });

  it('never asserts anything specific to a city — titles stay generic', () => {
    const guides = relatedGuides([{ name: 'Venues' }]);
    guides.forEach(guide => {
      expect(guide.title.toLowerCase()).not.toContain('cardiff');
    });
  });

  it('only ever links to ordinary site-relative paths', () => {
    const guides = relatedGuides([{ name: 'Venues' }]);
    guides.forEach(guide => {
      expect(guide.href).toMatch(/^\/[a-zA-Z0-9/_-]*$/);
    });
  });
});
