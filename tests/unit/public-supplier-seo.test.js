'use strict';

const {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  buildSupplierSeoModel,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
  serializeJsonLd,
} = require('../../services/publicSupplierSeo.service');

const supplier = {
  id: 'supplier-123',
  ownerUserId: 'user-1',
  approved: true,
  name: 'Cŵm Valley Photography',
  category: 'Photography',
  location: 'Cardiff',
  description_short: 'Natural wedding and event photography across South Wales.',
  bannerUrl: '/uploads/banner.webp',
  rating: 5,
  averageRating: 1,
  reviewCount: 999,
  approvedReviewSummary: { averageRating: 4.8, reviewCount: 12 },
  updatedAt: '2026-07-18T10:00:00.000Z',
};

const template = `<!doctype html><html><head>
  <title>Supplier Profile — EventFlow</title>
  <meta name="description" content="Generic supplier profile">
  <meta property="og:title" content="Supplier Profile — EventFlow">
  <meta name="twitter:title" content="Supplier Profile — EventFlow">
</head><body><main><h1 id="supplier-name">Loading supplier</h1></main></body></html>`;

describe('public supplier SEO service', () => {
  test('builds a deterministic, unique and readable supplier slug', () => {
    const first = buildPublicSupplierSlug(supplier);
    const second = buildPublicSupplierSlug({ ...supplier, name: 'Renamed Photography Studio' });

    expect(first).toMatch(/^cwm-valley-photography--[a-f0-9]{16}$/);
    expect(second).toMatch(/^renamed-photography-studio--[a-f0-9]{16}$/);
    expect(first.split('--')[1]).toBe(second.split('--')[1]);
  });

  test('uses the legacy businessName field for readable slugs and metadata', () => {
    const legacySupplier = {
      ...supplier,
      name: undefined,
      company: undefined,
      businessName: 'Dragon Events Wales',
      description_short: undefined,
      descriptionShort: 'Legacy supplier description.',
    };

    expect(buildPublicSupplierSlug(legacySupplier)).toMatch(/^dragon-events-wales--[a-f0-9]{16}$/);
    expect(buildSupplierSeoModel(legacySupplier)).toEqual(
      expect.objectContaining({
        title: 'Dragon Events Wales | Photography | EventFlow',
        description: 'Legacy supplier description.',
      })
    );
  });

  test('resolves an old name slug by its stable supplier token', () => {
    const canonical = buildPublicSupplierSlug(supplier);
    const token = canonical.split('--')[1];

    expect(resolvePublicSupplierBySlug([supplier], `old-business-name--${token}`)).toEqual(
      supplier
    );
    expect(resolvePublicSupplierBySlug([supplier], 'not-a-public-slug')).toBeNull();
  });

  test('only considers approved, named suppliers with a valid owner public', () => {
    const owners = new Set(['user-1']);

    expect(isPublicSupplier(supplier, owners)).toBe(true);
    expect(isPublicSupplier({ ...supplier, approved: false }, owners)).toBe(false);
    expect(isPublicSupplier({ ...supplier, ownerUserId: 'missing-user' }, owners)).toBe(false);
    expect(isPublicSupplier({ ...supplier, ownerUserId: null }, owners)).toBe(true);
    expect(
      isPublicSupplier(
        { ...supplier, name: undefined, businessName: undefined, company: undefined },
        owners
      )
    ).toBe(false);
  });

  test('preserves only recognised campaign attribution on canonical redirects', () => {
    const query = buildCampaignQuery({
      utm_source: ' google ',
      utm_campaign: ['launch', 'retargeting'],
      gclid: 'abc123',
      preview: 'true',
      id: 'supplier-123',
      next: 'https://example.test',
    });

    expect(query).toBe(
      'utm_source=google&utm_campaign=launch&utm_campaign=retargeting&gclid=abc123'
    );
    expect(query).not.toContain('preview');
    expect(query).not.toContain('supplier-123');
    expect(query).not.toContain('example.test');
  });

  test('renders supplier-specific head metadata without changing visible body markup', () => {
    const rendered = renderSupplierHtml(template, supplier);
    const originalBody = template.match(/<body>[\s\S]*<\/body>/i)[0];
    const renderedBody = rendered.match(/<body>[\s\S]*<\/body>/i)[0];

    expect(renderedBody).toBe(originalBody);
    expect(rendered).toContain(
      '<meta name="robots" content="index,follow,max-image-preview:large">'
    );
    expect(rendered).toContain('<meta name="ef-public-supplier-id" content="supplier-123">');
    expect(rendered).toContain('<script src="/assets/js/supplier-route-context.js"></script>');
    expect(rendered).toContain('<link rel="canonical" href="https://event-flow.co.uk/supplier/');
    expect(rendered).toContain('Cŵm Valley Photography | Photography | EventFlow');
    expect(rendered).toContain('id="supplier-structured-data"');
    expect(rendered).not.toContain('Generic supplier profile');
  });

  test('encodes JSON-LD and malformed supplier markup without executable script text', () => {
    const maliciousSupplier = {
      ...supplier,
      name: '<script>alert(1)</script>Studio',
      metaDescription: '</script><img src=x onerror=alert(1)> Safe description',
      priceRange: '&<script>££</script>',
    };
    const rendered = renderSupplierHtml(template, maliciousSupplier);
    const jsonLdText = rendered.match(
      /<script type="application\/ld\+json" id="supplier-structured-data">([\s\S]*?)<\/script>/
    )[1];

    expect(rendered).not.toContain('<script>alert(1)');
    expect(rendered).not.toContain('</script><img');
    expect(jsonLdText).not.toContain('<');
    expect(jsonLdText).not.toContain('>');
    expect(jsonLdText).not.toContain('&');
    expect(() => JSON.parse(jsonLdText)).not.toThrow();

    const serialized = serializeJsonLd({ value: '</script>&\u2028' });
    expect(serialized).toContain('\\u003c/script\\u003e\\u0026\\u2028');
    expect(JSON.parse(serialized)).toEqual({ value: '</script>&\u2028' });
  });

  test('uses only the approved-review analytics summary for aggregate rating schema', () => {
    const withRating = buildSupplierSeoModel(supplier);
    const withoutCount = buildSupplierSeoModel({
      ...supplier,
      approvedReviewSummary: { averageRating: 4.8, reviewCount: 0 },
    });
    const legacyOnly = buildSupplierSeoModel({
      ...supplier,
      approvedReviewSummary: undefined,
      averageRating: 5,
      reviewCount: 100,
      rating: 5,
      reviewsCount: 100,
      reviewSummary: { averageRating: 5, reviewCount: 100 },
    });

    expect(withRating.structuredData.aggregateRating).toEqual(
      expect.objectContaining({ ratingValue: 4.8, reviewCount: 12 })
    );
    expect(withoutCount.structuredData.aggregateRating).toBeUndefined();
    expect(legacyOnly.structuredData.aggregateRating).toBeUndefined();
  });
});