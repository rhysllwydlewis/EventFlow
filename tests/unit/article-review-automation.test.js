'use strict';

const fs = require('fs');
const path = require('path');
const {
  currentReviewMonth,
  loadArticleMetadata,
  renderArticleDates,
} = require('../../services/articleMetadata.service');
const { loadGuideEntries } = require('../../sitemap');
const { isRelevantPath } = require('../../services/productChangeReview.service');

describe('article review and SEO metadata', () => {
  test('has one metadata record for every article HTML file', () => {
    const files = fs
      .readdirSync(path.resolve(__dirname, '../../public/articles'))
      .filter(file => file.endsWith('.html'))
      .map(file => file.replace(/\.html$/, ''))
      .sort();
    const slugs = loadArticleMetadata({ fresh: true })
      .map(article => article.slug)
      .sort();
    expect(slugs).toEqual(files);
    expect(slugs).toHaveLength(34);
  });

  test('renders truthful material dates and an automatically current review month', () => {
    const article = loadArticleMetadata()[0];
    const source = fs.readFileSync(
      path.resolve(__dirname, `../../public/articles/${article.slug}.html`),
      'utf8'
    );
    const rendered = renderArticleDates(source, article.slug, new Date('2026-08-31T23:30:00Z'));
    expect(rendered).toContain(`"datePublished": "${article.publishedDate}"`);
    expect(rendered).toContain(`"dateModified": "${article.lastMaterialUpdate}"`);
    expect(rendered).toContain('Content checked September 2026');
    expect(rendered.match(/data-article-freshness/g)).toHaveLength(1);
  });

  test('clean article routes reach the server-side date renderer', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8');
    const routeStart = server.indexOf("app.get('/articles/:slug'");
    const routeEnd = server.indexOf("app.get('/articles/:slug.html'", routeStart);
    const route = server.slice(routeStart, routeEnd);
    const middlewareMount = server.indexOf('app.use(templateMiddleware())');
    expect(routeStart).toBeGreaterThan(-1);
    expect(route).toContain('return next()');
    expect(route).not.toContain('sendFile');
    expect(middlewareMount).toBeGreaterThan(routeEnd);
  });

  test('uses Europe/London for month boundaries', () => {
    expect(currentReviewMonth(new Date('2026-08-31T23:30:00Z'))).toBe('September 2026');
  });

  test('the sitemap inventory contains all article records with material dates', () => {
    const entries = loadGuideEntries();
    expect(entries).toHaveLength(34);
    expect(new Set(entries.map(entry => entry.slug)).size).toBe(34);
    expect(entries.every(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod))).toBe(true);
  });

  test('product-change filters cover high-risk features without flagging unrelated docs', () => {
    expect(isRelevantPath('routes/community.js')).toBe(true);
    expect(isRelevantPath('services/subscriptionService.js')).toBe(true);
    expect(isRelevantPath('public/privacy.html')).toBe(true);
    expect(isRelevantPath('docs/README.md')).toBe(false);
  });
});
