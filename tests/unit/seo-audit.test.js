'use strict';

const {
  extractCanonical,
  parseSitemapEntries,
  selectAuditEntries,
  validateIndexableHtml,
  validateSitemapXml,
} = require('../../utils/seoAudit');

describe('technical SEO audit utilities', () => {
  const base = 'https://event-flow.co.uk';

  test('parses sitemap URLs and genuine dates', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>${base}/</loc></url>
      <url><loc>${base}/package/photo-and-video</loc><lastmod>2026-07-18T10:00:00.000Z</lastmod></url>
    </urlset>`;
    expect(parseSitemapEntries(xml)).toEqual([
      { url: `${base}/`, lastmod: '' },
      { url: `${base}/package/photo-and-video`, lastmod: '2026-07-18T10:00:00.000Z' },
    ]);
  });

  test('accepts clean canonical sitemap entries', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>${base}/</loc></url>
      <url><loc>${base}/package/photo-and-video</loc><lastmod>2026-07-18T10:00:00.000Z</lastmod></url>
      <url><loc>${base}/events/cardiff-wedding-fair</loc></url>
    </urlset>`;
    expect(validateSitemapXml(xml, base, new Date('2026-07-19T00:00:00.000Z'))).toEqual(
      expect.objectContaining({ valid: true, issues: [] })
    );
  });

  test('rejects duplicate, legacy, query-string and fabricated sitemap hints', () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>${base}/package.html?slug=photo</loc><priority>0.8</priority></url>
      <url><loc>${base}/events/fair?preview=true</loc><lastmod>2099-01-01</lastmod></url>
      <url><loc>${base}/events/fair?preview=true</loc></url>
    </urlset>`;
    const result = validateSitemapXml(xml, base, new Date('2026-07-19T00:00:00.000Z'));
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toMatch(/priority|changefreq/i);
    expect(result.issues.join(' ')).toMatch(/legacy package URL/i);
    expect(result.issues.join(' ')).toMatch(/query parameters/i);
    expect(result.issues.join(' ')).toMatch(/duplicate URL/i);
    expect(result.issues.join(' ')).toMatch(/future lastmod/i);
  });

  test('validates canonical, title, description, robots and listing-specific JSON-LD', () => {
    const url = `${base}/package/photo`;
    const html = `<!doctype html><html><head>
      <title>Photo Package | Cwm Events | EventFlow</title>
      <meta name="description" content="A full day photography service.">
      <meta name="robots" content="index,follow">
      <meta name="ef-server-seo" content="package">
      <link href="${url}" rel="canonical">
      <script type="application/ld+json" id="package-structured-data">{"@type":"Service"}</script>
    </head><body></body></html>`;
    expect(
      validateIndexableHtml({
        html,
        expectedUrl: url,
        headers: { 'x-robots-tag': 'index, follow' },
        requireStructuredData: true,
      })
    ).toEqual(expect.objectContaining({ valid: true, canonical: url }));
    expect(extractCanonical(html)).toBe(url);
  });

  test('rejects generic, noindex and canonical-mismatched pages', () => {
    const html = `<!doctype html><html><head>
      <title>Package Details — EventFlow</title>
      <meta name="description" content="Generic">
      <meta name="robots" content="noindex">
      <link rel="canonical" href="${base}/package/other">
    </head></html>`;
    const result = validateIndexableHtml({
      html,
      expectedUrl: `${base}/package/photo`,
      requireStructuredData: true,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.join(' ')).toMatch(/canonical mismatch/i);
    expect(result.issues.join(' ')).toMatch(/noindex/i);
    expect(result.issues.join(' ')).toMatch(/placeholder title/i);
    expect(result.issues.join(' ')).toMatch(/structured data/i);
    expect(result.issues.join(' ')).toMatch(/server-rendered listing marker/i);
  });

  test('selects a balanced, bounded crawl sample', () => {
    const entries = [
      { url: `${base}/` },
      ...Array.from({ length: 20 }, (_, index) => ({ url: `${base}/supplier/s-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ url: `${base}/package/p-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ url: `${base}/events/e-${index}` })),
      ...Array.from({ length: 20 }, (_, index) => ({ url: `${base}/articles/a-${index}` })),
    ];
    const selected = selectAuditEntries(entries, 30);
    expect(selected).toHaveLength(30);
    expect(selected.some(entry => entry.url.includes('/supplier/'))).toBe(true);
    expect(selected.some(entry => entry.url.includes('/package/'))).toBe(true);
    expect(selected.some(entry => entry.url.includes('/events/'))).toBe(true);
  });
});
