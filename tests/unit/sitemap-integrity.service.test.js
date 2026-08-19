'use strict';

const { auditEverySitemapUrl } = require('../../services/sitemapIntegrity.service');

function response(url, overrides = {}) {
  return {
    status: overrides.status || 200,
    headers: { get: name => (name === 'x-robots-tag' ? overrides.robots || '' : '') },
    text: async () =>
      overrides.html || `<html><head><link rel="canonical" href="${url}"></head></html>`,
  };
}

describe('sitemap universal URL audit', () => {
  const xml =
    '<?xml version="1.0"?><urlset>' +
    '<url><loc>https://event-flow.co.uk/</loc></url>' +
    '<url><loc>https://event-flow.co.uk/suppliers</loc></url></urlset>';

  test('requests every emitted URL and accepts terminal 200, indexable self-canonicals', async () => {
    const seen = [];
    const result = await auditEverySitemapUrl(xml, async url => {
      seen.push(url);
      return response(url);
    });
    expect(seen).toEqual(['https://event-flow.co.uk/', 'https://event-flow.co.uk/suppliers']);
    expect(result).toEqual({ checked: 2, failures: [] });
  });

  test.each([
    [{ status: 404 }, 'terminal_status_404'],
    [{ robots: 'noindex, follow' }, 'noindex'],
    [{ html: '<link rel="canonical" href="https://event-flow.co.uk/">' }, 'non_self_canonical'],
  ])('reports an invalid emitted URL (%s)', async (overrides, reason) => {
    const result = await auditEverySitemapUrl(xml, url =>
      Promise.resolve(response(url, url.endsWith('/suppliers') ? overrides : {}))
    );
    expect(result.failures).toContainEqual({ url: 'https://event-flow.co.uk/suppliers', reason });
  });

  test('rejects duplicate sitemap locations', async () => {
    const duplicate = xml.replace(
      '</urlset>',
      '<url><loc>https://event-flow.co.uk/</loc></url></urlset>'
    );
    const result = await auditEverySitemapUrl(duplicate, url => Promise.resolve(response(url)));
    expect(result.failures).toContainEqual({
      url: 'https://event-flow.co.uk/',
      reason: 'duplicate_sitemap_location',
    });
  });
});
