'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const categoryHtml = fs.readFileSync(path.join(root, 'public/category.html'), 'utf8');
const lifecycle = fs.readFileSync(
  path.join(root, 'public/assets/js/pages/category-skeleton-lifecycle.js'),
  'utf8'
);

function createCategoryDom() {
  return new JSDOM(
    `<!doctype html><html><body>
      <div id="category-hero-section" aria-busy="true">
        <div class="skeleton skeleton-media"></div>
      </div>
      <h1 id="category-title" aria-busy="true"><span class="skeleton"></span></h1>
      <div id="package-list-container" aria-busy="true" data-skeleton-state="loading">
        <div class="skeleton-grid"><div class="skeleton"></div></div>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://event-flow.co.uk/category?slug=venues' }
  );
}

async function initialiseLifecycle(dom) {
  vm.runInContext(lifecycle, dom.getInternalVMContext());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
}

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

  it('clears a stale hero and loading semantics when a category has no hero image', async () => {
    const dom = createCategoryDom();
    await initialiseLifecycle(dom);

    const { document } = dom.window;
    document.getElementById('category-title').textContent = 'Venues';
    document.getElementById('package-list-container').innerHTML =
      '<div class="package-list-grid"></div>';
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));

    const hero = document.getElementById('category-hero-section');
    expect(hero.childElementCount).toBe(0);
    expect(hero.hasAttribute('aria-busy')).toBe(false);
    expect(document.getElementById('category-title').hasAttribute('aria-busy')).toBe(false);
    expect(document.getElementById('package-list-container').hasAttribute('aria-busy')).toBe(
      false
    );
    expect(
      document.getElementById('package-list-container').hasAttribute('data-skeleton-state')
    ).toBe(false);

    dom.window.close();
  });

  it('preserves a real category hero while clearing loading semantics', async () => {
    const dom = createCategoryDom();
    await initialiseLifecycle(dom);

    const { document } = dom.window;
    document.getElementById('category-title').textContent = 'Photography';
    document.getElementById('category-hero-section').innerHTML =
      '<div class="category-hero-img-wrap"><img src="/hero.jpg" alt="Photography"></div>';
    document.getElementById('package-list-container').innerHTML =
      '<div class="package-list-grid"></div>';
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));

    const hero = document.getElementById('category-hero-section');
    expect(hero.querySelector('.category-hero-img-wrap')).not.toBeNull();
    expect(hero.hasAttribute('aria-busy')).toBe(false);

    dom.window.close();
  });
});
