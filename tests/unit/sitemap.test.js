/**
 * Unit tests for sitemap.js
 *
 * Verifies that the generated sitemap includes:
 *  - The /guides index page
 *  - All article URLs derived from guides.json
 *  - Core static pages
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Mock database calls so we don't need a real DB in tests
jest.mock('../../db-unified', () => ({
  read: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { generateSitemap } = require('../../sitemap');

const BASE_URL = 'https://event-flow.co.uk';

// Load guides.json once to derive expected article slugs
const guidesData = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../public/assets/data/guides.json'),
    'utf8'
  )
);
const expectedArticleSlugs = guidesData.map(g => g.href.replace('/articles/', ''));

describe('generateSitemap', () => {
  let xml;

  beforeAll(async () => {
    xml = await generateSitemap(BASE_URL);
  });

  test('returns valid XML opening', () => {
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
  });

  test('includes core static pages', () => {
    expect(xml).toContain(`<loc>${BASE_URL}/</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/suppliers</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/marketplace</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/pricing</loc>`);
  });

  test('includes /guides page exactly once', () => {
    // Use split count to avoid regex metacharacter issues with BASE_URL
    const count = xml.split(`<loc>${BASE_URL}/guides</loc>`).length - 1;
    expect(count).toBe(1);
  });

  test('includes all article URLs from guides.json', () => {
    for (const slug of expectedArticleSlugs) {
      expect(xml).toContain(`<loc>${BASE_URL}/articles/${slug}</loc>`);
    }
  });

  test('includes all 25 article entries matching guides.json', () => {
    const matches = [...xml.matchAll(/<loc>[^<]*\/articles\/[^<]+<\/loc>/g)];
    expect(matches.length).toBe(expectedArticleSlugs.length);
  });

  test('uses BASE_URL correctly in all article URLs', () => {
    const allArticleUrls = [...xml.matchAll(/<loc>([^<]*\/articles\/[^<]+)<\/loc>/g)].map(
      m => m[1]
    );
    for (const url of allArticleUrls) {
      // Each article URL must begin with the exact base URL string
      expect(url.indexOf(BASE_URL)).toBe(0);
    }
  });

  test('does not contain .html extensions in article URLs', () => {
    const articleUrls = [...xml.matchAll(/<loc>[^<]*\/articles\/[^<]+<\/loc>/g)].map(
      m => m[0]
    );
    for (const url of articleUrls) {
      expect(url).not.toContain('.html');
    }
  });
});
