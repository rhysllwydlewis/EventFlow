'use strict';

/**
 * CSS Snapshot Assertions — Gallery Carousel Layout
 * Ensures key vh sizing values in p3-features.css don't drift unintentionally.
 */
const fs = require('fs');
const path = require('path');

describe('Carousel layout CSS snapshot', () => {
  let css;

  beforeAll(() => {
    css = fs.readFileSync(
      path.resolve(__dirname, '../public/assets/css/p3-features.css'),
      'utf-8'
    );
  });

  test('carousel-content height is 84vh', () => {
    expect(css).toMatch(/\.carousel-content\s*\{[\s\S]*?height:\s*84vh/);
  });

  test('carousel-image desktop max-height is 82vh', () => {
    // The base (non-media-query) rule
    expect(css).toMatch(/\.carousel-image\s*\{[\s\S]*?max-height:\s*82vh/);
  });

  test('mobile carousel-image max-height uses calc(84vh - 220px)', () => {
    expect(css).toContain('calc(84vh - 220px)');
  });

  test('carousel-counter bottom is 12px (desktop)', () => {
    expect(css).toMatch(/\.carousel-counter\s*\{[\s\S]*?bottom:\s*12px/);
  });

  test('landscape mobile media query exists', () => {
    expect(css).toContain('orientation: landscape');
    expect(css).toContain('max-height: 450px');
  });
});
