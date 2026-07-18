/**
 * Unit tests for sitemap.js
 *
 * Verifies that the generated sitemap includes:
 *  - The /guides index page
 *  - All article URLs derived from guides.json
 *  - Core static pages
 *  - Eligible suppliers at clean canonical URLs
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

const dbUnified = require('../../db-unified');
const { generateSitemap } = require('../../sitemap');
const { buildPublicSupplierSlug } = require('../../services/publicSupplierSeo.service');

const BASE_URL = 'https://event-flow.co.uk';

// Load guides.json once to derive expected article slugs
const guidesData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../public/assets/data/guides.json'), 'utf8')
);
const expectedArticleSlugs = guidesData.map(g => g.href.replace('/articles/', ''));

describe('generateSitemap', () => {
  let xml;

  beforeAll(async () => {
    dbUnified.read.mockResolvedValue([]);
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
    const count = xml.split(`<loc>${BASE_URL}/guides</loc>`).length - 1;
    expect(count).toBe(1);
  });

  test('guide catalogue is intentionally capped at 24 public entries', () => {
    expect(guidesData).toHaveLength(24);
  });

  test('includes all article URLs from guides.json', () => {
    for (const slug of expectedArticleSlugs) {
      expect(xml).toContain(`<loc>${BASE_URL}/articles/${slug}</loc>`);
    }
  });

  test('includes every article entry matching guides.json', () => {
    const matches = [...xml.matchAll(/<loc>[^<]*\/articles\/[^<]+<\/loc>/g)];
    expect(matches.length).toBe(expectedArticleSlugs.length);
  });

  test('uses BASE_URL correctly in all article URLs', () => {
    const allArticleUrls = [...xml.matchAll(/<loc>([^<]*\/articles\/[^<]+)<\/loc>/g)].map(
      match => match[1]
    );
    for (const url of allArticleUrls) {
      expect(url.indexOf(BASE_URL)).toBe(0);
    }
  });

  test('does not contain .html extensions in article URLs', () => {
    const articleUrls = [...xml.matchAll(/<loc>[^<]*\/articles\/[^<]+<\/loc>/g)].map(
      match => match[0]
    );
    for (const url of articleUrls) {
      expect(url).not.toContain('.html');
    }
  });

  test('includes only approved non-orphaned suppliers at clean canonical URLs', async () => {
    const approvedSupplier = {
      id: 'supplier-123',
      ownerUserId: 'user-1',
      approved: true,
      name: 'Cwm Valley Photography',
      updatedAt: '2026-07-18T10:00:00.000Z',
    };
    const orphan = { ...approvedSupplier, id: 'orphan', ownerUserId: 'missing-user' };
    const unapproved = { ...approvedSupplier, id: 'pending', approved: false };
    const data = {
      suppliers: [approvedSupplier, orphan, unapproved],
      users: [{ id: 'user-1' }],
      packages: [],
    };
    dbUnified.read.mockImplementation(async collection => data[collection] || []);

    const supplierXml = await generateSitemap(BASE_URL);
    const canonicalSlug = buildPublicSupplierSlug(approvedSupplier);

    expect(supplierXml).toContain(`<loc>${BASE_URL}/supplier/${canonicalSlug}</loc>`);
    expect(supplierXml).toContain('<lastmod>2026-07-18T10:00:00.000Z</lastmod>');
    expect(supplierXml).not.toContain('/supplier.html?id=');
    expect(supplierXml).not.toContain(buildPublicSupplierSlug(orphan));
    expect(supplierXml).not.toContain(buildPublicSupplierSlug(unapproved));
  });
});
