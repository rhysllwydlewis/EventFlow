'use strict';

const fs = require('fs');
const path = require('path');

// These regression tests intentionally inspect source files on disk (similar to
// other unit tests in this repository) to lock CSS/JS behavior that is not
// exposed as importable modules in Node/Jest.
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
    expect(carouselCss).toContain('left: 96px;');
    expect(carouselCss).toContain('.carousel-side-preview--next');
    expect(carouselCss).toContain('right: 96px;');
  });

  it('disables nav hover scale in reduced-motion mode', () => {
    const prmIdx = carouselCss.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(prmIdx).toBeGreaterThan(-1);
    const afterPrm = carouselCss.slice(prmIdx);
    const nextMediaMatch = afterPrm.match(/@media\s*\(max-width:\s*640px\)/);
    const nextMediaIdx = nextMediaMatch ? nextMediaMatch.index : -1;
    const prmBlock = nextMediaIdx > -1 ? afterPrm.slice(0, nextMediaIdx) : afterPrm;
    expect(prmBlock).toContain('.carousel-nav:hover');
    expect(prmBlock).toContain('transform: translateY(-50%);');
    expect(prmBlock).not.toContain('transform: translateY(-50%) scale(1.06);');
    expect(prmBlock).toContain('.carousel-image');
    expect(prmBlock).toContain('transition: none;');
    expect(prmBlock).toContain('.carousel-image.is-loading');
    expect(prmBlock).toContain('animation: none;');
  });

  it('uses object-fit: cover (not contain) for thumbnail strip images', () => {
    // cover fills the 44×44 tile cleanly; contain leaves letterbox gaps
    expect(carouselCss).toContain('.carousel-thumb-item img');
    const thumbIdx = carouselCss.indexOf('.carousel-thumb-item img');
    // Grab the rule block following the selector
    const afterThumb = carouselCss.slice(thumbIdx);
    const ruleEnd = afterThumb.indexOf('}');
    const ruleBlock = afterThumb.slice(0, ruleEnd);
    expect(ruleBlock).toContain('object-fit: cover;');
    expect(ruleBlock).not.toContain('object-fit: contain;');
  });

  it('repositions counter to bottom: 12px when thumb strip is hidden', () => {
    expect(carouselCss).toContain('.carousel-content--no-strip .carousel-counter');
    expect(carouselCss).toContain('.carousel-content--no-strip .carousel-image');
  });

  it('includes a short-landscape viewport fallback for carousel sizing', () => {
    expect(carouselCss).toContain('@media (min-height: 451px) and (max-height: 500px) and (orientation: landscape)');
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

  it('hides thumb strip for single-image galleries and adds carousel-content--no-strip class', () => {
    // Strip must be explicitly hidden so it does not occupy space on mobile
    expect(carouselJs).toContain("strip.style.display = hasMultiple ? '' : 'none'");
    // Parent content container gets a modifier class so CSS can reposition counter + image
    expect(carouselJs).toContain("'carousel-content--no-strip'");
    expect(carouselJs).toContain('classList.toggle');
  });
});
