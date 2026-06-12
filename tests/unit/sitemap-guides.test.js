'use strict';

jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => {
    if (collection === 'suppliers') {
      return [{ id: 'supplier&one', approved: true, updatedAt: '2026-04-10T00:00:00.000Z' }];
    }
    if (collection === 'packages') {
      return [{ slug: 'photo&video', updatedAt: '2026-04-11T00:00:00.000Z' }];
    }
    return [];
  }),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const guides = require('../../public/assets/data/guides.json');
const { generateSitemap, loadGuideEntries, xmlEscape } = require('../../sitemap');

describe('dynamic sitemap guide mop-up', () => {
  test('loadGuideEntries mirrors guide lastUpdated metadata', () => {
    const entries = loadGuideEntries();
    expect(entries).toHaveLength(guides.length);
    expect(entries[0]).toEqual({
      slug: guides[0].href.replace('/articles/', ''),
      lastmod: guides[0].lastUpdated || guides[0].publishedDate,
    });
  });

  test('generateSitemap escapes dynamic URL values and uses guide lastmod dates', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk/');
    expect(xml).toContain(
      '<loc>https://event-flow.co.uk/articles/wedding-venue-selection-guide</loc>'
    );
    expect(xml).toContain(`<lastmod>${guides[0].lastUpdated}</lastmod>`);
    expect(xml).toContain('<loc>https://event-flow.co.uk/supplier.html?id=supplier&amp;one</loc>');
    expect(xml).toContain('<loc>https://event-flow.co.uk/package.html?slug=photo&amp;video</loc>');
  });

  test('xmlEscape protects sitemap XML text nodes', () => {
    expect(xmlEscape('https://example.test/a?x=1&name="wed"')).toBe(
      'https://example.test/a?x=1&amp;name=&quot;wed&quot;'
    );
  });
});
