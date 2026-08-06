/**
 * Related planning guides on a city page.
 */

'use strict';

const fs = require('fs');
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

describe('city-pinned guides', () => {
  let readFileSyncSpy;

  const catalogue = [
    {
      id: 'generic-venues',
      title: 'Generic Venues Guide',
      category: 'Venues',
      href: '/articles/generic-venues',
      excerpt: 'Applies everywhere.',
      featured: true,
      featuredOrder: 1,
    },
    {
      id: 'cardiff-venues',
      title: 'Wedding Venues in Cardiff',
      category: 'Venues',
      cities: ['cardiff'],
      href: '/articles/cardiff-venues',
      excerpt: 'Written specifically for Cardiff.',
    },
    {
      id: 'bristol-venues',
      title: 'Wedding Venues in Bristol',
      category: 'Venues',
      cities: ['bristol'],
      href: '/articles/bristol-venues',
      excerpt: 'Written specifically for Bristol.',
    },
  ];

  beforeEach(() => {
    resetGuidesCache();
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(filePath => {
      if (String(filePath).endsWith('guides.json')) {
        return JSON.stringify(catalogue);
      }
      return JSON.stringify([]);
    });
  });

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    resetGuidesCache();
  });

  it('puts a guide written specifically for this city ahead of category-matched ones', () => {
    const guides = relatedGuides([{ name: 'Venues' }], 'cardiff');
    expect(guides[0].title).toBe('Wedding Venues in Cardiff');
  });

  it('never shows a guide pinned to a different city, even on a matching category', () => {
    const guides = relatedGuides([{ name: 'Venues' }], 'cardiff');
    expect(guides.map(guide => guide.title)).not.toContain('Wedding Venues in Bristol');
  });

  it('still shows the generic, city-agnostic guide alongside the pinned one', () => {
    const guides = relatedGuides([{ name: 'Venues' }], 'cardiff');
    expect(guides.map(guide => guide.title)).toContain('Generic Venues Guide');
  });

  it('a city-agnostic request never surfaces a guide pinned to a specific city', () => {
    const guides = relatedGuides([{ name: 'Venues' }]);
    expect(guides.map(guide => guide.title)).toEqual(['Generic Venues Guide']);
  });
});
