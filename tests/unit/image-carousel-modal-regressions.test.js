'use strict';

const fs = require('fs');
const path = require('path');

const carouselCss = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/css/p3-features.css'),
  'utf8'
);

const carouselJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/image-carousel.js'),
  'utf8'
);

describe('Carousel modal CSS regressions', () => {
  it('keeps the counter pill inside the modal content by default', () => {
    expect(carouselCss).toContain('.carousel-counter');
    expect(carouselCss).toContain('bottom: 12px;');
    expect(carouselCss).not.toContain('bottom: -52px;');
  });

  it('uses overlap-safe mobile image max-height formula', () => {
    expect(carouselCss).toContain('max-height: calc(84vh - 220px);');
  });

  it('keeps mobile counter above thumbnail strip with safe-area handling', () => {
    expect(carouselCss).toContain('bottom: calc(74px + env(safe-area-inset-bottom, 0px));');
  });

  it('adds overflow guard and loading style for carousel images', () => {
    expect(carouselCss).toContain('.carousel-image-container');
    expect(carouselCss).toContain('overflow: hidden;');
    expect(carouselCss).toContain('.carousel-image.is-loading');
  });

  it('uses wider side-preview offsets to reduce visual crowding with nav buttons', () => {
    expect(carouselCss).toContain('.carousel-side-preview--prev');
    expect(carouselCss).toContain('left: 92px;');
    expect(carouselCss).toContain('.carousel-side-preview--next');
    expect(carouselCss).toContain('right: 92px;');
  });

  it('disables nav hover scale in reduced-motion mode', () => {
    const prmIdx = carouselCss.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(prmIdx).toBeGreaterThan(-1);
    const afterPrm = carouselCss.slice(prmIdx);
    const nextMediaIdx = afterPrm.indexOf('\n@media (max-width: 640px)');
    const prmBlock = nextMediaIdx > -1 ? afterPrm.slice(0, nextMediaIdx) : afterPrm;
    expect(prmBlock).toContain('.carousel-nav:hover');
    expect(prmBlock).toContain('transform: translateY(-50%);');
    expect(prmBlock).not.toContain('transform: translateY(-50%) scale(1.06);');
    expect(prmBlock).toContain('.carousel-image');
    expect(prmBlock).toContain('transition: none;');
  });

  it('includes a short-landscape viewport fallback for carousel sizing', () => {
    expect(carouselCss).toContain('@media (max-height: 500px) and (orientation: landscape)');
    expect(carouselCss).toContain('max-height: calc(100vh - 140px);');
  });
});

describe('Carousel modal JS regressions', () => {
  it('sets aria-hidden=true on modal creation before opening', () => {
    expect(carouselJs).toContain("modal.setAttribute('aria-hidden', 'true')");
  });

  it('installs and implements a tab focus trap for modal keyboard navigation', () => {
    expect(carouselJs).toContain("modal.addEventListener('keydown', trapFocusInModal)");
    expect(carouselJs).toContain('function trapFocusInModal(e)');
    expect(carouselJs).toContain("e.key !== 'Tab'");
    expect(carouselJs).toContain('carousel.querySelectorAll(');
  });

  it('gates image fade-in on image load/error and tracks stale loads with a token', () => {
    expect(carouselJs).toContain('let imageLoadToken = 0;');
    expect(carouselJs).toContain('const loadToken = ++imageLoadToken;');
    expect(carouselJs).toContain("img.classList.add('is-loading');");
    expect(carouselJs).toContain('img.onload = () =>');
    expect(carouselJs).toContain('img.onerror = () =>');
    expect(carouselJs).toContain("img.classList.remove('is-loading');");
    expect(carouselJs).toContain("img.style.opacity = '1';");
  });
});
