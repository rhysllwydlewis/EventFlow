/**
 * Curated city-specific Pexels hero defaults.
 */

'use strict';

const heroImages = require('../../services/locationHeroImage.service');
const registry = require('../../services/locationRegistry.service');

function pexelsPhoto(overrides = {}) {
  return {
    id: 123,
    width: 1800,
    height: 1200,
    url: 'https://www.pexels.com/photo/london-skyline-123/',
    photographer: 'Example Photographer',
    alt: 'London skyline beside the River Thames',
    src: {
      landscape: 'https://images.pexels.com/photos/123/pexels-photo-123.jpeg?w=1200',
    },
    ...overrides,
  };
}

beforeEach(() => {
  heroImages.resetAutomaticHeroCache();
});

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

  it('uses a reviewed city default without calling the search API', async () => {
    const pexels = { isConfigured: jest.fn(() => true), searchPhotos: jest.fn() };

    const hero = await heroImages.resolveAutomaticHero(registry.getCity('cardiff'), { pexels });

    expect(hero.url).toContain('/photos/5743996/');
    expect(pexels.searchPhotos).not.toHaveBeenCalled();
  });

  it('builds a disambiguated Pexels query for every registry city', () => {
    const queries = registry
      .listCities()
      .map(city => [city, heroImages.buildCitySearchQuery(city)]);

    expect(queries).toHaveLength(58);
    queries.forEach(([city, query]) => {
      expect(query).toContain(city.name);
      expect(query).toContain(city.nation);
      expect(query).toContain('United Kingdom city landmark');
    });
  });

  it('resolves an uncurated city from the existing Pexels service', async () => {
    const city = registry.getCity('london');
    const pexels = {
      isConfigured: jest.fn(() => true),
      searchPhotos: jest.fn(async () => ({ photos: [pexelsPhoto()] })),
    };

    const hero = await heroImages.resolveAutomaticHero(city, { pexels, now: 1000 });

    expect(pexels.searchPhotos).toHaveBeenCalledWith(
      expect.stringContaining('London Greater London England'),
      12,
      1,
      { orientation: 'landscape', size: 'large' }
    );
    expect(hero).toEqual(
      expect.objectContaining({
        url: expect.stringContaining('images.pexels.com/photos/123/'),
        alt: expect.stringContaining('London'),
        credit: 'Example Photographer',
        sourceUrl: 'https://www.pexels.com/photo/london-skyline-123/',
      })
    );
  });

  it('prefers a result that explicitly names the city', async () => {
    const city = registry.getCity('london');
    const pexels = {
      isConfigured: () => true,
      searchPhotos: async () => ({
        photos: [
          pexelsPhoto({
            id: 1,
            alt: 'A generic city skyline',
            url: 'https://www.pexels.com/photo/generic-city-1/',
            src: { landscape: 'https://images.pexels.com/photos/1/photo-1.jpeg' },
          }),
          pexelsPhoto({
            id: 2,
            alt: 'London skyline at sunset',
            url: 'https://www.pexels.com/photo/london-skyline-2/',
            src: { landscape: 'https://images.pexels.com/photos/2/photo-2.jpeg' },
          }),
        ],
      }),
    };

    const hero = await heroImages.resolveAutomaticHero(city, { pexels });
    expect(hero.url).toContain('/photos/2/');
  });

  it('never replaces a stored editorial hero', async () => {
    const page = {
      content: {
        heroImageUrl: 'https://cdn.example.com/london.jpg',
        heroImageAlt: 'Editor choice',
      },
    };
    const pexels = { isConfigured: jest.fn(() => true), searchPhotos: jest.fn() };

    await expect(
      heroImages.resolvePageHero(registry.getCity('london'), page, { pexels })
    ).resolves.toBe(page);
    expect(pexels.searchPhotos).not.toHaveBeenCalled();
  });

  it('fails closed when Pexels is not configured', async () => {
    const page = { content: { heroImageUrl: null } };
    const pexels = { isConfigured: () => false, searchPhotos: jest.fn() };

    await expect(
      heroImages.resolvePageHero(registry.getCity('london'), page, { pexels })
    ).resolves.toBe(page);
    expect(pexels.searchPhotos).not.toHaveBeenCalled();
  });
  it('declines a photograph that does not say it is of this city', async () => {
    // Pexels always returns something. A popular landscape photo of nowhere in
    // particular must not become Bath's hero just because the search ran.
    heroImages.resetAutomaticHeroCache();
    const pexels = {
      isConfigured: () => true,
      searchPhotos: async () => ({
        photos: [
          {
            src: { landscape: 'https://images.pexels.com/photos/900/x.jpeg' },
            url: 'https://www.pexels.com/photo/a-quiet-street-900/',
            alt: 'A quiet street with parked cars',
            photographer: 'Someone',
            width: 1600,
            height: 900,
          },
        ],
      }),
    };
    const page = { content: { heroImageUrl: null } };

    await expect(
      heroImages.resolvePageHero(registry.getCity('bath'), page, { pexels })
    ).resolves.toBe(page);
  });

  it('accepts a photograph whose own description names the city', async () => {
    heroImages.resetAutomaticHeroCache();
    const pexels = {
      isConfigured: () => true,
      searchPhotos: async () => ({
        photos: [
          {
            src: { landscape: 'https://images.pexels.com/photos/901/x.jpeg' },
            url: 'https://www.pexels.com/photo/roman-baths-901/',
            alt: 'The Roman Baths in Bath, England',
            photographer: 'Someone',
            width: 1600,
            height: 900,
          },
        ],
      }),
    };

    const resolved = await heroImages.resolvePageHero(
      registry.getCity('bath'),
      { content: { heroImageUrl: null } },
      { pexels }
    );
    expect(resolved.content.heroImageUrl).toContain('/photos/901/');
    expect(resolved.content.heroImageAlt).toBe('The Roman Baths in Bath, England');
  });

  it('keeps a newline out of the log when a lookup fails', async () => {
    heroImages.resetAutomaticHeroCache();
    const logger = require('../../utils/logger');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const pexels = {
      isConfigured: () => true,
      searchPhotos: async () => {
        throw new Error('boom\nWARN forged log entry');
      },
    };

    await heroImages.resolveAutomaticHero(registry.getCity('bath'), { pexels });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).not.toContain('\n');
    warn.mockRestore();
  });
});
