'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('skeleton surface compatibility layers', () => {
  it('routes Marketplace placeholders through the canonical skeleton stylesheet', () => {
    const css = read('public/assets/css/marketplace-skeleton.css');
    const page = read('public/marketplace.html');
    expect(page).toContain('/assets/css/skeleton.css?v=2.0.1');
    expect(page).toContain('/assets/css/marketplace-skeleton.css?v=2.0.1');
    expect(page.indexOf('/assets/css/skeleton.css')).toBeLessThan(
      page.indexOf('/assets/css/marketplace-skeleton.css')
    );
    expect(css).not.toContain('@import');
    expect(css).toContain('var(--skeleton-surface)');
    expect(css).toContain('var(--skeleton-border)');
    expect(css).toContain('var(--skeleton-highlight)');
    expect(css).toContain('animation: ef-skeleton-shimmer 1.35s linear infinite');
    expect(css).toContain('.marketplace-skeleton-card .skeleton-image');
    expect(css).not.toContain('@keyframes skeleton-pulse');
    expect(css).not.toContain('@keyframes skeleton-shimmer');
  });

  it('keeps Marketplace responsive behaviour while removing duplicate animation code', () => {
    const css = read('public/assets/css/marketplace-skeleton.css');
    expect(css).toContain('@media (max-width: 768px)');
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('grid-template-columns: 1fr');
  });

  it('stops every Marketplace placeholder animation for reduced motion', () => {
    const css = read('public/assets/css/marketplace-skeleton.css');
    const renderer = read('public/assets/js/marketplace.js');
    expect(renderer).toContain('class="marketplace-skeleton-card"');
    expect(renderer).toContain('class="skeleton-image"');
    expect(renderer).toContain('class="skeleton-text skeleton-title"');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.marketplace-skeleton-card .skeleton-image,');
    expect(css).toContain('.marketplace-skeleton-card .skeleton-text {');
    expect(css).toContain('animation: none !important');
  });

  it('busts caches for every stylesheet changed by the consolidation', () => {
    const canonicalConsumers = [
      'public/category.html',
      'public/dashboard-customer.html',
      'public/dashboard-supplier.html',
      'public/event-detail.html',
      'public/marketplace.html',
      'public/supplier.html',
      'public/suppliers.html',
    ];
    const legacyConsumers = ['public/guides.html', 'public/home-v2.html', 'public/index.html'];

    canonicalConsumers.forEach(file =>
      expect(read(file)).toContain('/assets/css/skeleton.css?v=2.0.1')
    );
    legacyConsumers.forEach(file =>
      expect(read(file)).toContain('/assets/css/loading-skeleton.css?v=2.0.1')
    );
    expect(read('public/assets/js/utils/skeleton-loader.js')).toContain(
      "link.href = '/assets/css/skeleton.css?v=2.0.1'"
    );
  });

  it('keeps the established supplier-profile loading contract in its original file', () => {
    const profileCss = read('public/assets/css/supplier-profile-commercial-polish.css');
    expect(profileCss).toContain("html:not([data-sp-theme-ready='true'])");
    expect(profileCss).toContain('#supplier-package-cards-root:empty::before');
    expect(profileCss).toContain('#sp-section-reviews:empty::before');
    expect(profileCss).toContain('#sp-sidebar-enquiry:empty::before');
    expect(profileCss).not.toContain('supplier-profile-commercial-base.css');
  });

  it('keeps supplier profile icon actions inside the mobile loading viewport', () => {
    const profileTheme = read('public/assets/css/supplier-profile-theme.css');
    expect(profileTheme).toMatch(/#btn-save,\s*#btn-share\s*\{[^}]*min-width:\s*42px !important;/);
  });

  it('adds only the missing supplier gallery placeholder through the shared stylesheet', () => {
    const css = read('public/assets/css/skeleton.css');
    expect(css).toContain(
      "html:not([data-sp-theme-ready='true']) body.sp-profile-page #sp-section-gallery:empty"
    );
    expect(css).not.toContain('body.sp-profile-page #sp-section-reviews:empty::after');
  });

  it('retains renderer-owned valid empty outcomes for supplier gallery and packages', () => {
    const profileRenderer = read('public/assets/js/supplier-profile.js');
    const packageRenderer = read('public/assets/js/supplier-profile-packages-v2.js');
    expect(profileRenderer).toContain("container.style.display = 'none'");
    expect(packageRenderer).toContain('setPackagesSectionVisible(root, false)');
  });
});
