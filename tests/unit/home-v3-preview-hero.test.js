'use strict';

const fs = require('fs');
const path = require('path');
const {
  addPreviewRobotsMeta,
  buildHomepageV3Preview,
  replacePlaceholders,
  sanitizeAnonymousPublicHtml,
} = require('../../utils/template-renderer');

const ROOT = path.resolve(__dirname, '../..');

function renderHomeV3Preview() {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const sanitized = sanitizeAnonymousPublicHtml(replacePlaceholders(source), '/index.html', {});
  return addPreviewRobotsMeta(buildHomepageV3Preview(sanitized));
}

describe('homepage V3 preview hero', () => {
  test('renders the bespoke V3 hero above the existing V1 page content', () => {
    const html = renderHomeV3Preview();

    expect(html).toMatch(/<body[^>]*class="[^"]*home-v3-page/i);
    expect(html).toContain('/assets/css/home-v3.css?v=15');
    expect(html).toContain('/assets/js/pages/home-v3.js?v=12');
    expect(html).toContain('hv3-hero__stage');
    expect(html).toContain('hv3-search__header');
    expect(html).toContain('hv3-console__steps');
    expect(html).toContain('Build your shortlist');
    expect(html).not.toContain('class="hero hero-modern"');
  });

  test('keeps the supplier search contract and preview noindex protection', () => {
    const html = renderHomeV3Preview();

    expect(html).toContain('action="/suppliers"');
    expect(html).toContain('name="category"');
    expect(html).toContain('name="eventType"');
    expect(html).toContain('name="location"');
    expect(html).toContain('name="q"');
    expect(html).toMatch(/name="robots" content="noindex,nofollow"/i);
  });
});
