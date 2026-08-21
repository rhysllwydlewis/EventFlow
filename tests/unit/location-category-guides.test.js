/**
 * Related planning guides on a city × category page.
 */

'use strict';

const fs = require('fs');
const {
  guideEventType,
  guideServiceCategory,
  relatedGuidesForCategory,
  resetGuidesCache,
} = require('../../services/locationGuides.service');
const { resolveCategory } = require('../../services/locationCategoryPage.service');

const venues = resolveCategory('venues');
const catering = resolveCategory('catering');
const cardiff = { slug: 'cardiff' };

beforeEach(() => {
  resetGuidesCache();
});

describe('guideServiceCategory and guideEventType', () => {
  it('prefers the new serviceCategory field over the legacy category field', () => {
    expect(guideServiceCategory({ category: 'Venues', serviceCategory: 'Catering' })).toBe(
      'Catering'
    );
  });

  it('falls back to the legacy category field when serviceCategory is absent', () => {
    expect(guideServiceCategory({ category: 'Venues' })).toBe('Venues');
  });

  it('reads an eventType when the catalogue entry names one, and an empty string otherwise', () => {
    expect(guideEventType({ eventType: 'Wedding' })).toBe('Wedding');
    expect(guideEventType({})).toBe('');
  });
});

describe('relatedGuidesForCategory', () => {
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
      id: 'cardiff-wedding-venues',
      title: 'Planning a Wedding in Cardiff',
      serviceCategory: 'Venues',
      eventType: 'Wedding',
      cities: ['cardiff'],
      href: '/articles/cardiff-wedding-venues',
      excerpt: 'Written specifically for Cardiff weddings.',
    },
    {
      id: 'cardiff-corporate-venues',
      title: 'Planning a Corporate Event in Cardiff',
      serviceCategory: 'Venues',
      eventType: 'Corporate',
      cities: ['cardiff'],
      href: '/articles/cardiff-corporate-venues',
      excerpt: 'Written specifically for Cardiff corporate events.',
    },
    {
      id: 'cardiff-catering',
      title: 'Catering in Cardiff',
      serviceCategory: 'Catering',
      cities: ['cardiff'],
      href: '/articles/cardiff-catering',
      excerpt: 'Written specifically for Cardiff catering.',
    },
    {
      id: 'cardiff-citywide',
      title: 'The Cardiff Event Planning Checklist',
      cities: ['cardiff'],
      href: '/articles/cardiff-citywide',
      excerpt: 'City-wide, not tied to one category.',
    },
    {
      id: 'bristol-venues',
      title: 'Wedding Venues in Bristol',
      serviceCategory: 'Venues',
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

  it('lets two guides for the same city and category coexist by event type', () => {
    const guides = relatedGuidesForCategory(cardiff, venues);
    const titles = guides.map(guide => guide.title);
    expect(titles).toContain('Planning a Wedding in Cardiff');
    expect(titles).toContain('Planning a Corporate Event in Cardiff');
  });

  it('never shows a guide pinned to a different city, even on a matching category', () => {
    const guides = relatedGuidesForCategory(cardiff, venues);
    expect(guides.map(guide => guide.title)).not.toContain('Wedding Venues in Bristol');
  });

  it('never shows a category-specific guide on the wrong category page', () => {
    const guides = relatedGuidesForCategory(cardiff, venues);
    expect(guides.map(guide => guide.title)).not.toContain('Catering in Cardiff');
  });

  it('shows a city-pinned guide with no service category on every one of that city’s category pages', () => {
    const onVenues = relatedGuidesForCategory(cardiff, venues).map(guide => guide.title);
    const onCatering = relatedGuidesForCategory(cardiff, catering).map(guide => guide.title);
    expect(onVenues).toContain('The Cardiff Event Planning Checklist');
    expect(onCatering).toContain('The Cardiff Event Planning Checklist');
  });

  it('still includes a generic, city-agnostic guide matching the category', () => {
    const guides = relatedGuidesForCategory(cardiff, venues).map(guide => guide.title);
    expect(guides).toContain('Generic Venues Guide');
  });

  it('returns nothing for an unrecognised category', () => {
    expect(relatedGuidesForCategory(cardiff, null)).toEqual([]);
  });

  it('only ever links to ordinary site-relative paths', () => {
    const guides = relatedGuidesForCategory(cardiff, venues);
    guides.forEach(guide => {
      expect(guide.href).toMatch(/^\/[a-zA-Z0-9/_-]*$/);
    });
  });
});

describe('relatedGuidesForCategory with the real catalogue', () => {
  it('never throws and only ever returns guides with a title and an href', () => {
    const guides = relatedGuidesForCategory({ slug: 'cardiff' }, venues);
    guides.forEach(guide => {
      expect(guide.title).toBeTruthy();
      expect(guide.href).toBeTruthy();
    });
  });
});
