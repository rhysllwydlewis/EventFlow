'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/locations-public-refresh.css'),
  'utf8'
);

describe('compact public location pages on small screens', () => {
  it('keeps the photo overlays small and rectangular', () => {
    expect(css).toMatch(/\.efl-hero__credit\s*\{[\s\S]*?border-radius:\s*7px;/);
    expect(css).toMatch(/\.efl-hero__credit a\s*\{[\s\S]*?min-height:\s*0;/);
    expect(css).toMatch(/\.efl-hero__image-note\s*\{[\s\S]*?max-width:\s*140px;/);
    expect(css).toMatch(/\.efl-hero__image-note small\s*\{\s*display:\s*none;/);
    expect(css).toContain('.efl-coverage-label--short');
  });

  it('reduces the hero and keeps the summary on one adaptive row', () => {
    expect(css).toMatch(/\.efl-hero__visual,[\s\S]*?min-height:\s*190px;[\s\S]*?height:\s*190px;/);
    expect(css).toMatch(
      /\.efl-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(78px, 1fr\)\);/
    );
    expect(css).toMatch(/\.efl-summary li\s*\{[\s\S]*?min-height:\s*62px;/);
  });

  it('uses two compact columns where the content supports it', () => {
    expect(css).toContain("section[aria-labelledby='efl-suppliers'] .efl-grid");
    expect(css).toContain("section[aria-labelledby='efl-packages'] .efl-grid");
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toMatch(
      /section\[aria-labelledby='efl-packages'\] \.efl-card,[\s\S]*?min-height:\s*76px;/
    );
  });
});
