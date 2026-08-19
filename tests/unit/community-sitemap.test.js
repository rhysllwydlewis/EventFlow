/**
 * The sitemap must advertise community content that is genuinely public, and
 * must never advertise a URL that would answer with a noindex page.
 */

'use strict';

const mockCollections = new Map();

jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => mockCollections.get(name) || []),
}));

const { generateSitemap } = require('../../sitemap');

beforeEach(() => {
  mockCollections.clear();
  mockCollections.set('community_categories', [
    {
      slug: 'venues',
      name: 'Venues',
      visible: true,
      archived: false,
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
    { slug: 'hidden-area', name: 'Hidden', visible: false, archived: false },
    { slug: 'old-area', name: 'Old', visible: true, archived: true },
  ]);
  mockCollections.set('community_discussions', [
    {
      stableId: 'aaaabbbbcccc',
      slug: 'marquee-hire',
      categorySlug: 'venues',
      state: 'published',
      lastActivityAt: '2026-07-20T00:00:00.000Z',
    },
    {
      stableId: 'ddddeeeeffff',
      slug: 'older-thread',
      categorySlug: 'venues',
      state: 'archived',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    { stableId: '111122223333', slug: 'held', state: 'quarantined' },
    { stableId: '444455556666', slug: 'gone', state: 'removed' },
    { stableId: '777788889999', slug: 'hidden', state: 'hidden' },
    { stableId: 'aaaa11112222', slug: 'replaced', state: 'superseded' },
    { slug: 'no-stable-id', state: 'published' },
  ]);
});

describe('community entries in the sitemap', () => {
  it('lists the community entry points', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('<loc>https://event-flow.co.uk/community</loc>');
    expect(xml).toContain('<loc>https://event-flow.co.uk/community/discussions</loc>');
    expect(xml).toContain('<loc>https://event-flow.co.uk/community/guidelines</loc>');
    expect(xml).toContain('<loc>https://event-flow.co.uk/community/help</loc>');
  });

  it('lists visible categories only', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('/community/category/venues');
    expect(xml).not.toContain('/community/category/hidden-area');
    expect(xml).not.toContain('/community/category/old-area');
  });

  it('lists published and archived discussions', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('/community/discussion/aaaabbbbcccc/marquee-hire');
    expect(xml).toContain('/community/discussion/ddddeeeeffff/older-thread');
  });

  it('never lists content that would answer with a noindex page', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    ['111122223333', '444455556666', '777788889999', 'aaaa11112222'].forEach(stableId => {
      expect(xml).not.toContain(stableId);
    });
  });

  it('skips a discussion with no stable identity', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).not.toContain('no-stable-id');
  });

  it('emits a last-modified date from real activity', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('2026-07-20');
  });

  it('normalises a trailing slash on the base URL', async () => {
    const xml = await generateSitemap('https://event-flow.co.uk/');
    expect(xml).toContain('<loc>https://event-flow.co.uk/community</loc>');
    expect(xml).not.toContain('event-flow.co.uk//community');
  });

  it('produces valid XML even when the community is empty', async () => {
    mockCollections.set('community_categories', []);
    mockCollections.set('community_discussions', []);
    const xml = await generateSitemap('https://event-flow.co.uk');
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });
});
