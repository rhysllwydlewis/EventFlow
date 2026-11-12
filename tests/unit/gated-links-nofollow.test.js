/**
 * Crawler hygiene for links to login-gated pages.
 *
 * /settings, /budget, /guests, /timeline, /notifications and
 * /my-marketplace-listings answer a logged-out visitor (and a crawler) with a
 * 302 to /auth. Search Console reports every such link as a "Page with
 * redirect" URL. The links stay for real users, but on any page a crawler can
 * index they must say rel="nofollow" so crawlers leave them alone — the same
 * rule site-navigation-consistency.test.js already enforces for the settings
 * link.
 *
 * /partner is different: it is a real page, but its canonical form is
 * /partner/ and the bare path 301s there, so links must use the final URL.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');

const GATED_PATHS = [
  '/settings',
  '/budget',
  '/guests',
  '/timeline',
  '/notifications',
  '/my-marketplace-listings',
];

/**
 * Public, indexable HTML pages: every .html in public/ and public/articles/
 * that is neither an admin page nor itself noindexed. A noindexed page is a
 * logged-in tool (or a demo) where these links are real navigation, not
 * something a crawler is meant to be steered away from.
 * @returns {Array<{name: string, html: string}>} The pages.
 */
function indexablePages() {
  const pages = [];
  for (const dir of [PUBLIC, path.join(PUBLIC, 'articles')]) {
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith('.html') || entry.startsWith('admin')) {
        continue;
      }
      const html = fs.readFileSync(path.join(dir, entry), 'utf8');
      if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) {
        continue;
      }
      pages.push({ name: path.relative(PUBLIC, path.join(dir, entry)), html });
    }
  }
  return pages;
}

const anchorsTo = (html, hrefs) =>
  [...html.matchAll(/<a\s[^>]*>/g)]
    .map(match => match[0])
    .filter(tag => hrefs.includes((tag.match(/\shref="([^"#?]+)/) || [])[1]));

// Homepage preview prototypes. Their files carry no robots meta, but
// routes/public.js and scripts/serve-static.js serve them noindex, so they are
// not crawler-facing pages either.
const NOINDEXED_BY_ROUTE = new Set(['home-v2.html', 'home-v3.html']);

const pages = indexablePages().filter(page => !NOINDEXED_BY_ROUTE.has(page.name));

describe('links to login-gated pages on indexable pages', () => {
  test('there are enough indexable pages for this to be worth asserting', () => {
    expect(pages.length).toBeGreaterThan(60);
  });

  test.each(pages.map(page => [page.name, page]))(
    '%s: every link to a gated page is rel="nofollow"',
    (_name, page) => {
      const offenders = anchorsTo(page.html, GATED_PATHS).filter(
        tag => !/\srel="[^"]*nofollow/.test(tag)
      );
      expect(offenders).toEqual([]);
    }
  );

  test.each(pages.map(page => [page.name, page]))(
    '%s: links to the partner programme use the final /partner/ URL',
    (_name, page) => {
      const bare = [...page.html.matchAll(/<a\s[^>]*\shref="([^"]+)"/g)]
        .map(match => match[1])
        .filter(href => /^(https:\/\/event-flow\.co\.uk)?\/partner$/.test(href));
      expect(bare).toEqual([]);
    }
  );
});
