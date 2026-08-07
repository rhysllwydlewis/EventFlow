'use strict';

const fs = require('fs');
const path = require('path');

const categoryHtml = fs.readFileSync(path.join(__dirname, '../../public/category.html'), 'utf8');

describe('category page initial skeleton shell', () => {
  it('loads the canonical skeleton stylesheet before the initial page paint', () => {
    expect(categoryHtml).toContain('/assets/css/skeleton.css?v=2.0.1');
  });

  it('reserves hero, title, description and package-card layout in HTML', () => {
    expect(categoryHtml).toContain('class="section section--muted category-hero-shell"');
    expect(categoryHtml).toContain('id="category-hero-section"');
    expect(categoryHtml).toContain('id="category-title" role="status"');
    expect(categoryHtml).toContain('id="package-list-container"');
    expect(categoryHtml).toContain('skeleton-package-card');
  });

  it('does not expose the legacy loading word before JavaScript runs', () => {
    expect(categoryHtml).not.toContain('<h1 id="category-title">Loading...</h1>');
  });

  it('hides unresolved hero and description placeholders after the category title resolves', () => {
    expect(categoryHtml).toContain('body:has(#category-title:not(:has(.skeleton)))');
    expect(categoryHtml).toContain('.category-hero-shell:not(:has(.category-hero-img-wrap))');
    expect(categoryHtml).toContain('#category-description:has(.skeleton)');
    expect(categoryHtml).toContain('display: none');
  });

  it('does not leave stale loading-state attributes that the legacy renderer cannot clear', () => {
    expect(categoryHtml).not.toContain('id="category-hero-section" aria-busy="true"');
    expect(categoryHtml).not.toContain('id="category-title" aria-busy="true"');
    expect(categoryHtml).not.toContain('data-skeleton-state="loading"');
  });

  it('does not add a separate lifecycle script beside the existing category renderer', () => {
    expect(categoryHtml).toContain('/assets/js/pages/category-init.js');
    expect(categoryHtml).not.toContain('/assets/js/pages/category-skeleton-lifecycle.js');
  });
});
