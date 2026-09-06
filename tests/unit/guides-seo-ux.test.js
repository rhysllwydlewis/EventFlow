'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const guides = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'public/assets/data/guides.json'), 'utf8')
);

function readPublic(relativePath) {
  return fs.readFileSync(path.join(repoRoot, 'public', relativePath), 'utf8');
}

describe('guides SEO and UX assets', () => {
  test('every guide has preview and SEO metadata required by the card renderer', () => {
    for (const guide of guides) {
      expect(guide.href).toMatch(/^\/articles\/[a-z0-9-]+$/);
      expect(guide.summary).toEqual(expect.any(String));
      expect(guide.summary.length).toBeGreaterThan(20);
      expect(['Beginner', 'Intermediate', 'Advanced']).toContain(guide.difficulty);
      expect(guide.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(guide.primaryTag).toEqual(expect.any(String));
      expect(guide.ogImage).toEqual(expect.any(String));
    }
  });

  test('/guides exposes server-rendered meta and ItemList schema', () => {
    const html = readPublic('guides.html');
    expect(html).toContain('<link rel="canonical" href="https://event-flow.co.uk/guides">');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('"@type": "ItemList"');
    expect(html).toContain('/assets/js/analytics-events.js');
  });

  test('guide index hides the progressive fallback list after enhancement and offers a view-more card', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/guides.css'), 'utf8');
    const init = fs.readFileSync(
      path.join(repoRoot, 'public/assets/js/pages/guides-init.js'),
      'utf8'
    );
    expect(css).toContain('.guides-nojs-list[hidden]');
    expect(css).toContain('.guide-card--more');
    expect(css).toContain('article .article-cta-card');
    expect(css).toContain('white-space: nowrap');
    expect(init).toContain('INITIAL_GUIDE_LIMIT = 23');
    expect(guides.length).toBeGreaterThan(23);
    expect(init).toContain('View all ${list.length} guides');
    expect(init).toContain('function bindMediaQueryChange');
    expect(init).toContain('if (searchClear)');
  });

  test('guide cards and the guide index share the standard visual template', () => {
    const css = fs.readFileSync(path.join(repoRoot, 'public/assets/css/guides.css'), 'utf8');
    const guidesHtml = readPublic('guides.html');
    // Every article moved onto the premium (gp-*) template in the article
    // rollout, so guides.css is no longer loaded by any article page — only
    // by the guide index itself. The per-article assertion this test used to
    // carry (checking a still-legacy reference article) no longer has a
    // subject and was removed rather than repointed.

    expect(css).toContain('--guide-card-template-bg');
    expect(css).toContain('--guide-finale-panel-bg');
    expect(css).toContain('--guide-action-panel-bg');
    expect(css).toContain('.featured-card {');
    expect(css).toContain('.guide-card {');
    expect(css).toContain('article .article-related-card {');
    expect(css).toContain('article .card .article-cta-card h2');
    expect(css).toContain('article .card .article-cta-card a');
    expect(css).not.toContain('PR1023 follow-up');
    expect(guidesHtml).toContain('/assets/css/guides.css?v=19.8.0');
  });

  test('sample article includes schema, feedback, prefilled report link and copy button', () => {
    // event-travel-costs-guide is the premium template's own canonical
    // reference article (see docs/ARTICLE_TEMPLATE.md) — now that every guide
    // has moved onto the gp-* template, it's the stable choice for a "sample
    // article" fixture rather than any one of the 34 equally-valid articles.
    const guide = guides.find(item => item.href === '/articles/event-travel-costs-guide');
    const html = readPublic('articles/event-travel-costs-guide.html');
    expect(html).toContain('"@type": "Article"');
    expect(html).toContain('"@type": "BreadcrumbList"');
    expect(html).toContain('data-guide-feedback');
    expect(html).toContain('Guide%3A%20event-travel-costs-guide');
    expect(html).toContain('labels=content,guides');
    expect(html).toContain('data-share-channel="copy"');
    expect(html).toContain(`data-share-url="https://event-flow.co.uk${guide.href}"`);

    const analytics = fs.readFileSync(
      path.join(repoRoot, 'public/assets/js/analytics-events.js'),
      'utf8'
    );
    expect(analytics).toContain("throw new Error('Clipboard API unavailable')");
  });

  test('Lighthouse CI warms audited routes through the static server without app secrets', () => {
    const desktop = JSON.parse(fs.readFileSync(path.join(repoRoot, '.lighthouserc.json'), 'utf8'));
    const mobile = JSON.parse(
      fs.readFileSync(path.join(repoRoot, '.lighthouserc.mobile.json'), 'utf8')
    );
    const launcher = fs.readFileSync(
      path.join(repoRoot, 'scripts/start-lighthouse-server.sh'),
      'utf8'
    );

    for (const config of [desktop, mobile]) {
      expect(config.ci.collect.startServerCommand).toBe('bash scripts/start-lighthouse-server.sh');
      expect(config.ci.collect.startServerReadyPattern).toBe('Lighthouse server warmed');
    }
    expect(desktop.ci.collect.url).toContain('http://localhost:3000/guides');
    expect(launcher).toContain('node scripts/serve-static.js &');
    expect(launcher).not.toContain('node server.js');
    expect(launcher).toContain('/articles/wedding-venue-selection-guide');
  });
});
