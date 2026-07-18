'use strict';

const {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  buildSupplierSeoModel,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
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
  rating: 0,
  averageRating: 4.8,
  reviewCount: 12,
  updatedAt: '2026-07-18T10:00:00.000Z',
};

describe('public supplier SEO service', () => {
  test('builds a deterministic, unique and readable supplier slug', () => {
    const first = buildPublicSupplierSlug(supplier);
    const second = buildPublicSupplierSlug({ ...supplier, name: 'Renamed Photography Studio' });

    expect(first).toMatch(/^cwm-valley-photography--[a-f0-9]{16}$/);
    expect(second).toMatch(/^renamed-photography-studio--[a-f0-9]{16}$/);
    expect(first.split('--')[1]).toBe(second.split('--')[1]);
  });

  test('resolves an old name slug by its stable supplier token', () => {
    const canonical = buildPublicSupplierSlug(supplier);
    const token = canonical.split('--')[1];

    expect(resolvePublicSupplierBySlug([supplier], `old-business-name--${token}`)).toEqual(
      supplier
    );
    expect(resolvePublicSupplierBySlug([supplier], 'not-a-public-slug')).toBeNull();
  });

  test('only considers approved suppliers with a valid owner public', () => {
    const owners = new Set(['user-1']);

    expect(isPublicSupplier(supplier, owners)).toBe(true);
    expect(isPublicSupplier({ ...supplier, approved: false }, owners)).toBe(false);
    expect(isPublicSupplier({ ...supplier, ownerUserId: 'missing-user' }, owners)).toBe(false);
    expect(isPublicSupplier({ ...supplier, ownerUserId: null }, owners)).toBe(true);
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
    const template = `<!doctype html><html><head>
      <title>Supplier Profile — EventFlow</title>
      <meta name="description" content="Generic supplier profile">
      <meta property="og:title" content="Supplier Profile — EventFlow">
      <meta name="twitter:title" content="Supplier Profile — EventFlow">
    </head><body><main><h1 id="supplier-name">Loading supplier</h1></main></body></html>`;

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

  test('uses approved review analytics before the legacy rating field', () => {
    const withRating = buildSupplierSeoModel(supplier);
    const withoutCount = buildSupplierSeoModel({ ...supplier, reviewCount: 0 });

    expect(withRating.structuredData.aggregateRating).toEqual(
      expect.objectContaining({ ratingValue: 4.8, reviewCount: 12 })
    );
    expect(withoutCount.structuredData.aggregateRating).toBeUndefined();
  });
});
