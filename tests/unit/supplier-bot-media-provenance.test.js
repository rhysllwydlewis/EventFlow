'use strict';

const {
  canonicalMediaUrl,
  createUnclaimedSupplierFromBot,
  normalizeSourceMedia,
} = require('../../services/supplierBotIngestion.service');

function payload(overrides = {}) {
  return {
    candidateId: 'candidate_media_1',
    businessName: 'Example Venue',
    category: 'Venues',
    location: 'South Wales',
    website: 'https://example-venue.test/',
    description: 'Independent EventFlow summary.',
    publicEmail: 'hello@example-venue.test',
    publicPhone: '02920 000000',
    services: ['Weddings'],
    packages: [],
    advertisedPrices: [],
    publicationQuality: 90,
    dataConfidence: 88,
    complianceStatus: 'pass',
    compliancePolicyVersion: 'phase3-test',
    generatedAt: '2026-08-27T10:00:00.000Z',
    generatorVersion: 'deterministic-shadow-media-v2',
    ...overrides,
  };
}

function memoryDb() {
  const suppliers = [];
  return {
    suppliers,
    async read(name) {
      if (name !== 'suppliers') throw new Error(`Unexpected collection: ${name}`);
      return suppliers;
    },
    async insertOne(name, item) {
      if (name !== 'suppliers') throw new Error(`Unexpected collection: ${name}`);
      suppliers.push(item);
      return item;
    },
  };
}

describe('Supplier Bot media provenance', () => {
  it('retains bounded source media without promoting it into public supplier media fields', async () => {
    const mediaEvidence = [
      {
        url: 'https://cdn.example.test/venue/hero.jpg#fragment',
        sourcePageUrl: 'https://example-venue.test/weddings#gallery',
        kind: 'open_graph',
        alt: 'Wedding venue exterior',
        width: 1600,
        height: 900,
        score: 94,
        sameSite: false,
      },
    ];
    const dbUnified = memoryDb();
    const result = await createUnclaimedSupplierFromBot({
      dbUnified,
      payload: payload({
        coverImage: 'https://cdn.example.test/venue/hero.jpg#cover',
        images: [
          'https://cdn.example.test/venue/hero.jpg#one',
          'https://example-venue.test/media/reception.jpg',
        ],
        mediaEvidence,
      }),
    });

    expect(result.supplier.status).toBe('draft');
    expect(result.supplier.ownershipStatus).toBe('unclaimed');
    expect(result.supplier.approved).toBe(false);
    expect(result.supplier.coverImage).toBe('');
    expect(result.supplier.images).toEqual([]);
    expect(result.supplier.openGraphImage).toBe('');
    expect(result.supplier.acquisition.sourceMedia).toEqual({
      coverImage: 'https://cdn.example.test/venue/hero.jpg',
      images: [
        'https://cdn.example.test/venue/hero.jpg',
        'https://example-venue.test/media/reception.jpg',
      ],
      evidence: [
        {
          ...mediaEvidence[0],
          url: 'https://cdn.example.test/venue/hero.jpg',
          sourcePageUrl: 'https://example-venue.test/weddings',
        },
      ],
    });
  });

  it('uses empty acquisition media defaults for legacy bot payloads', async () => {
    const dbUnified = memoryDb();
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: payload() });
    expect(result.supplier.acquisition.sourceMedia).toEqual({
      coverImage: null,
      images: [],
      evidence: [],
    });
  });

  it('normalizes HTTP media URLs and rejects unsupported protocols', () => {
    expect(canonicalMediaUrl('HTTPS://cdn.example.test/hero.jpg#x', 'coverImage')).toBe(
      'https://cdn.example.test/hero.jpg'
    );
    expect(() => canonicalMediaUrl('data:image/png;base64,abc', 'coverImage')).toThrow(
      'coverImage must use HTTP or HTTPS'
    );
  });

  test.each([
    ['non-array images', { images: 'https://example.test/a.jpg' }, 'images must be an array'],
    [
      'too many images',
      { images: Array.from({ length: 13 }, (_, index) => `https://example.test/${index}.jpg`) },
      'images must contain no more than 12 items',
    ],
    ['invalid cover image', { coverImage: 'not a url' }, 'coverImage must be a valid URL'],
    [
      'unsupported evidence kind',
      {
        mediaEvidence: [
          {
            url: 'https://example.test/a.jpg',
            sourcePageUrl: 'https://example.test/',
            kind: 'advertisement',
            alt: null,
            width: null,
            height: null,
            score: 50,
            sameSite: true,
          },
        ],
      },
      'mediaEvidence[0].kind is unsupported',
    ],
    [
      'invalid media score',
      {
        mediaEvidence: [
          {
            url: 'https://example.test/a.jpg',
            sourcePageUrl: 'https://example.test/',
            kind: 'inline_image',
            alt: null,
            width: null,
            height: null,
            score: 101,
            sameSite: true,
          },
        ],
      },
      'mediaEvidence[0].score must be between 0 and 100',
    ],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => normalizeSourceMedia(payload(overrides))).toThrow(message);
  });
});
