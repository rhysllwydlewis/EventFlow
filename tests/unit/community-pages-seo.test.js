/**
 * Unit tests for the server-rendered community pages: metadata, structured
 * data, canonical handling, redirects and the no-JavaScript fallback.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const { applyMeta, applyContent, renderDiscussionList, escapeHtml } =
  require('../../routes/community-pages').__internal;

describe('community page metadata', () => {
  const shell = '<head>\n    <!--COMMUNITY_HEAD-->\n</head><body><!--COMMUNITY_CONTENT--></body>';

  it('sets the title, description and canonical', () => {
    const html = applyMeta(shell, {
      title: 'Venues — EventFlow Community',
      description: 'Discussions about venues.',
      canonical: 'https://event-flow.co.uk/community/category/venues',
    });
    expect(html).toContain('<title>Venues — EventFlow Community</title>');
    expect(html).toContain('name="description" content="Discussions about venues."');
    expect(html).toContain(
      '<link rel="canonical" href="https://event-flow.co.uk/community/category/venues" />'
    );
  });

  it('emits Open Graph tags for sharing', () => {
    const html = applyMeta(shell, {
      title: 'A discussion',
      description: 'Body',
      canonical: 'https://event-flow.co.uk/community',
      ogType: 'article',
    });
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:site_name" content="EventFlow"');
  });

  it('adds noindex only when asked', () => {
    const indexed = applyMeta(shell, { title: 'T', description: 'D', canonical: 'C' });
    const hidden = applyMeta(shell, {
      title: 'T',
      description: 'D',
      canonical: 'C',
      noindex: true,
    });
    expect(indexed).not.toContain('noindex');
    expect(hidden).toContain('<meta name="robots" content="noindex,follow" />');
  });

  it('emits rel=prev and rel=next for paginated views', () => {
    const html = applyMeta(shell, {
      title: 'T',
      description: 'D',
      canonical: 'C',
      prev: 'https://event-flow.co.uk/community/category/venues?page=1',
      next: 'https://event-flow.co.uk/community/category/venues?page=3',
    });
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });

  it('escapes metadata taken from user content', () => {
    const html = applyMeta(shell, {
      title: 'Watch out for "<script>alert(1)</script>"',
      description: 'Body',
      canonical: 'C',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes the closing script sequence inside JSON-LD', () => {
    const html = applyMeta(shell, {
      title: 'T',
      description: 'D',
      canonical: 'C',
      structuredData: { '@type': 'DiscussionForumPosting', headline: '</script><img>' },
    });
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain('</script><img>');
  });

  it('injects the server-rendered content into the fallback region', () => {
    const html = applyContent(shell, '<h1>Hello</h1>');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).not.toContain('<!--COMMUNITY_CONTENT-->');
  });
});

describe('community server-rendered lists', () => {
  const card = {
    url: '/community/discussion/aaaabbbbcccc/marquee-hire',
    title: 'Marquee hire in Kent',
    excerpt: 'We need a marquee for 120 guests.',
    replyCount: 3,
    uniqueViews: 42,
    category: { name: 'Venues' },
    regionLabel: 'South East',
    eventTypeLabel: 'Wedding',
    author: { displayName: 'Sam' },
    lastActivityAt: '2026-07-20T00:00:00.000Z',
    solved: true,
    hasOfficialAnswer: false,
    isOld: false,
  };

  it('renders a readable list without JavaScript', () => {
    const html = renderDiscussionList([card]);
    expect(html).toContain('Marquee hire in Kent');
    expect(html).toContain('3 replies');
    expect(html).toContain('42 views');
    expect(html).toContain('Solved');
  });

  it('renders a useful empty state rather than a blank box', () => {
    const html = renderDiscussionList([]);
    expect(html).toContain('No discussions here yet');
  });

  it('escapes discussion titles', () => {
    const html = renderDiscussionList([{ ...card, title: '<img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('flags an older discussion in the fallback markup too', () => {
    const html = renderDiscussionList([{ ...card, isOld: true }]);
    expect(html).toContain('Older discussion');
  });
});

describe('escapeHtml', () => {
  it('escapes every dangerous character', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('renders null and undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('community page shells', () => {
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const shells = [
    'community.html',
    'community-discussions.html',
    'community-category.html',
    'community-discussion.html',
    'community-new.html',
    'community-member.html',
    'community-search.html',
    'community-saved.html',
    'community-following.html',
    'community-guidelines.html',
    'community-help.html',
    'admin-community.html',
  ];

  it.each(shells)('%s exists and carries the metadata placeholder', file => {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    expect(html).toContain('<!--COMMUNITY_HEAD-->');
    expect(html).toContain('<!--COMMUNITY_CONTENT-->');
  });

  it.each(shells)('%s includes a skip link and a main landmark', file => {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    expect(html).toContain('class="efc-skip"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('role="banner"');
    expect(html).toContain('role="contentinfo"');
  });

  it.each(shells)('%s loads the shared community stylesheet and core script', file => {
    const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
    expect(html).toContain('/assets/css/community.css');
    expect(html).toContain('/assets/js/community/core.js');
  });
});
