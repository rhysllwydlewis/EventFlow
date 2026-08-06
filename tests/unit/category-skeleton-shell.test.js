'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const categoryHtml = fs.readFileSync(path.join(root, 'public/category.html'), 'utf8');
const lifecycle = fs.readFileSync(
  path.join(root, 'public/assets/js/pages/category-skeleton-lifecycle.js'),
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

  it('loads the lifecycle companion after the existing category renderer', () => {
    const rendererIndex = categoryHtml.indexOf('/assets/js/pages/category-init.js');
    const lifecycleIndex = categoryHtml.indexOf(
      '/assets/js/pages/category-skeleton-lifecycle.js'
    );
    expect(rendererIndex).toBeGreaterThan(-1);
    expect(lifecycleIndex).toBeGreaterThan(rendererIndex);
  });

  it('clears stale hero and accessibility loading state after a terminal result', () => {
    expect(lifecycle).toContain("elements.hero.replaceChildren()");
    expect(lifecycle).toContain("removeAttribute('aria-busy')");
    expect(lifecycle).toContain("removeAttribute('data-skeleton-state')");
    expect(lifecycle).toContain(".category-hero-img-wrap");
  });

  it('observes the legacy renderer and disconnects after title and packages resolve', () => {
    expect(lifecycle).toContain('new MutationObserver');
    expect(lifecycle).toContain('titleResolved && packagesResolved');
    expect(lifecycle).toContain('observer.disconnect()');
  });
});
