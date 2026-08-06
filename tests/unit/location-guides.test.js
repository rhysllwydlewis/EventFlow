/**
 * Related planning guides on a city page.
 */

'use strict';

const fs = require('fs');
const registry = require('../../services/locationRegistry.service');
const { relatedGuides, resetGuidesCache } = require('../../services/locationGuides.service');

// Forces the registry to read its own data file and cache the result before
// any test in this file mocks fs.readFileSync for the guides catalogue —
// otherwise a later registry.listCities() call would be intercepted too and
// silently see zero cities.
const ALL_CITY_SLUGS = registry.listCities().map(city => city.slug);

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

describe('reachability of every generic guide, not just the featured three', () => {
  let readFileSyncSpy;

  // Ten generic guides, only the first three flagged featured — mirrors the
  // real catalogue's shape (three featured guides from file 1, everything
  // else, including all of file 2, unflagged).
  const generic = Array.from({ length: 10 }, (_unused, index) => ({
    id: `guide-${index}`,
    title: `Guide ${index}`,
    category: 'Nonexistent Category',
    href: `/articles/guide-${index}`,
    excerpt: `Excerpt ${index}.`,
    featured: index < 3,
    featuredOrder: index < 3 ? index + 1 : undefined,
  }));

  beforeEach(() => {
    resetGuidesCache();
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(filePath => {
      if (String(filePath).endsWith('guides.json')) {
        return JSON.stringify(generic);
      }
      return JSON.stringify([]);
    });
  });

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    resetGuidesCache();
  });

  it('lets a non-featured guide win a slot for at least one city, not just the fixed featured three', () => {
    const nonFeaturedTitles = new Set(generic.slice(3).map(guide => guide.title));
    const surfaced = ALL_CITY_SLUGS.some(slug =>
      relatedGuides([{ name: 'Elsewhere' }], slug).some(guide => nonFeaturedTitles.has(guide.title))
    );
    expect(surfaced).toBe(true);
  });

  it('gives the same city the same selection on every call', () => {
    const first = relatedGuides([{ name: 'Elsewhere' }], 'cardiff').map(guide => guide.title);
    const second = relatedGuides([{ name: 'Elsewhere' }], 'cardiff').map(guide => guide.title);
    expect(second).toEqual(first);
  });

  it('never returns more than three guides', () => {
    const guides = relatedGuides([{ name: 'Elsewhere' }], 'london');
    expect(guides.length).toBeLessThanOrEqual(3);
  });
});

describe('a malformed or unreadable catalogue', () => {
  let readFileSyncSpy;

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    resetGuidesCache();
  });

  it('fails closed rather than throwing when a catalogue file cannot be read', () => {
    resetGuidesCache();
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    expect(() => relatedGuides([{ name: 'Venues' }], 'cardiff')).not.toThrow();
    expect(relatedGuides([{ name: 'Venues' }], 'cardiff')).toEqual([]);
  });

  it('fails closed rather than throwing on invalid JSON', () => {
    resetGuidesCache();
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('not valid json {{{');
    expect(() => relatedGuides([{ name: 'Venues' }], 'cardiff')).not.toThrow();
    expect(relatedGuides([{ name: 'Venues' }], 'cardiff')).toEqual([]);
  });
});

describe('excerpt length', () => {
  let readFileSyncSpy;

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    resetGuidesCache();
  });

  it('truncates a long excerpt on a whole word, with an ellipsis', () => {
    resetGuidesCache();
    const longExcerpt = 'word '.repeat(80).trim();
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(filePath => {
      if (String(filePath).endsWith('guides.json')) {
        return JSON.stringify([
          {
            id: 'long-excerpt',
            title: 'Guide With A Long Excerpt',
            category: 'Venues',
            href: '/articles/long-excerpt',
            excerpt: longExcerpt,
            featured: true,
            featuredOrder: 1,
          },
        ]);
      }
      return JSON.stringify([]);
    });

    const [guide] = relatedGuides([{ name: 'Venues' }], 'cardiff');
    expect(guide.excerpt.length).toBeLessThanOrEqual(200);
    expect(guide.excerpt.endsWith('…')).toBe(true);
    expect(guide.excerpt).not.toMatch(/\s…$/);
  });
});

describe('registry consistency of the real catalogue', () => {
  it('never pins a guide to a city slug the registry does not recognise', () => {
    const guides = [
      ...require('../../public/assets/data/guides.json'),
      ...require('../../public/assets/data/guides-eventflow-pack.json'),
    ];
    const unknownPins = guides
      .filter(guide => Array.isArray(guide.cities))
      .flatMap(guide => guide.cities.filter(slug => !registry.getCity(slug)));
    expect(unknownPins).toEqual([]);
  });
});
