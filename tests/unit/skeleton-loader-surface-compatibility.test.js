'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('skeleton surface compatibility layers', () => {
  it('routes Marketplace placeholders through the canonical skeleton stylesheet', () => {
    const css = read('public/assets/css/marketplace-skeleton.css');
    expect(css).toContain("@import url('/assets/css/skeleton.css?v=2.0.0')");
    expect(css).toContain('var(--skeleton-surface)');
    expect(css).toContain('var(--skeleton-border)');
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

  it('keeps the established supplier-profile loading contract in its original file', () => {
    const profileCss = read('public/assets/css/supplier-profile-commercial-polish.css');
    expect(profileCss).toContain("html:not([data-sp-theme-ready='true'])");
    expect(profileCss).toContain('#supplier-package-cards-root:empty::before');
    expect(profileCss).toContain('#sp-section-reviews:empty::before');
    expect(profileCss).toContain('#sp-sidebar-enquiry:empty::before');
    expect(profileCss).not.toContain('supplier-profile-commercial-base.css');
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
