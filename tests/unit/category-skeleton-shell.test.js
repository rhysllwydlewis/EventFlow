'use strict';

const fs = require('fs');
const path = require('path');

const categoryHtml = fs.readFileSync(
  path.join(__dirname, '../../public/category.html'),
  'utf8'
);

describe('category page initial skeleton shell', () => {
  it('loads the canonical skeleton stylesheet before the initial page paint', () => {
    expect(categoryHtml).toContain('/assets/css/skeleton.css?v=2.0.0');
  });

  it('reserves hero, title, description and package-card layout in HTML', () => {
    expect(categoryHtml).toContain('id="category-hero-section" aria-busy="true"');
    expect(categoryHtml).toContain('id="category-title" aria-busy="true"');
    expect(categoryHtml).toContain('id="package-list-container" aria-busy="true"');
    expect(categoryHtml).toContain('skeleton-package-card');
  });

  it('does not expose the legacy loading word before JavaScript runs', () => {
    expect(categoryHtml).not.toContain('<h1 id="category-title">Loading...</h1>');
  });
});
