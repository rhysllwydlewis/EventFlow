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

  it('preserves Gallery base styles behind a canonical skeleton entry point', () => {
    const entry = read('public/assets/css/gallery.css');
    const base = read('public/assets/css/gallery-base.css');
    expect(entry).toContain("@import url('/assets/css/skeleton.css?v=2.0.0')");
    expect(entry).toContain("@import url('/assets/css/gallery-base.css?v=18.3.1')");
    expect(base).toContain('.gallery-grid');
    expect(base).toContain('.gallery-item');
    expect(base).toContain('.upload-dropzone');
  });

  it('renders the existing Gallery loading element as responsive skeleton tiles', () => {
    const css = read('public/assets/css/gallery.css');
    expect(css).toContain(".loading[style*='display: block']");
    expect(css).toContain('grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))');
    expect(css).toContain('@keyframes gallery-skeleton-shimmer');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('preserves Calendar base styles behind a canonical skeleton entry point', () => {
    const entry = read('public/assets/css/calendar.css');
    const base = read('public/assets/css/calendar-base.css');
    expect(entry).toContain("@import url('/assets/css/skeleton.css?v=2.0.0')");
    expect(entry).toContain("@import url('/assets/css/calendar-base.css?v=18.3.1')");
    expect(base).toContain('.pc-event-card');
    expect(base).toContain('.pc-filters');
    expect(base).toContain('.pc-hero');
  });

  it('upgrades public-calendar placeholders to event-card-shaped skeletons', () => {
    const css = read('public/assets/css/calendar.css');
    expect(css).toContain('#pc-loading-skeleton .pc-skeleton-card::before');
    expect(css).toContain('#pc-loading-skeleton .pc-skeleton-card::after');
    expect(css).toContain('@keyframes public-calendar-skeleton-shimmer');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
