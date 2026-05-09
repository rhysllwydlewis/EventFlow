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
    expect(init).toContain('INITIAL_GUIDE_LIMIT = 24');
    expect(init).toContain('View all ${list.length} guides');
  });

  test('sample article includes schema, feedback, prefilled report link and copy button', () => {
    const guide = guides.find(item => item.href === '/articles/event-planning-checklist-guide');
    const html = readPublic('articles/event-planning-checklist-guide.html');
    expect(html).toContain('"@type": "Article"');
    expect(html).toContain('"@type": "BreadcrumbList"');
    expect(html).toContain('data-guide-feedback');
    expect(html).toContain('Guide%3A%20event-planning-checklist-guide');
    expect(html).toContain('labels=content,guides');
    expect(html).toContain('data-share-channel="copy"');
    expect(html).toContain(`data-share-url="https://event-flow.co.uk${guide.href}"`);
  });

  test('Lighthouse CI uses the static server so CI does not require app secrets', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, '.lighthouserc.json'), 'utf8'));
    expect(config.ci.collect.startServerCommand).toBe('node scripts/serve-static.js');
    expect(config.ci.collect.url).toContain('http://localhost:3000/guides');
  });
});
