'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const indexPath = path.join(ROOT, 'public/index.html');
const enhancementPath = path.join(ROOT, 'public/assets/js/pages/homepage-approved-lower.js');
const footerPath = path.join(ROOT, 'public/assets/js/components/eventflow-footer.js');
const stylesheetPath = path.join(ROOT, 'public/assets/css/homepage-approved-lower.css');

describe('approved homepage lower-section implementation', () => {
  const index = fs.readFileSync(indexPath, 'utf8');
  const enhancement = fs.readFileSync(enhancementPath, 'utf8');
  const footer = fs.readFileSync(footerPath, 'utf8');
  const stylesheet = fs.readFileSync(stylesheetPath, 'utf8');

  test('is wired directly into the production homepage with cache-busted assets', () => {
    // The version is deliberately not pinned: these files are edited, and a
    // returning visitor must be served the new bytes. What matters is that each
    // asset is wired in and carries a cache-busting version at all.
    expect(index).toMatch(/\/assets\/css\/homepage-approved-lower\.css\?v=\d+/);
    expect(index).toMatch(/\/assets\/js\/pages\/homepage-approved-lower\.js\?v=\d+/);
    expect(index).toMatch(/\/assets\/js\/components\/eventflow-footer\.js\?v=\d+/);
  });

  test('targets the production homepage rather than the home-v2 preview', () => {
    expect(enhancement).toContain("document.querySelector('.home-category-section')");
    expect(enhancement).toContain("document.getElementById('marketplace-preview-section')");
    expect(enhancement).toContain("document.getElementById('guides-section')");
    expect(enhancement).not.toContain('.hv2-overview');
  });

  test('implements every approved section from categories through the footer', () => {
    [
      'ef-approved-category-grid',
      'ef-approved-benefits',
      'ef-approved-step-grid',
      'ef-approved-marketplace-card',
      'ef-approved-guide-grid',
      'removeHowItWorks',
      'ef-approved-supplier-panel',
    ].forEach(marker => expect(enhancement).toContain(marker));

    expect(footer).toContain('ef-approved-home-footer');
    expect(footer).toContain('Everything you need to plan amazing events.');
    expect(footer).toContain('Account links');
  });

  test('uses live marketplace data and the published guide data source', () => {
    expect(enhancement).toContain('/api/v1/marketplace/listings?limit=12');
    expect(enhancement).toContain('/assets/data/guides.json');
    expect(enhancement).not.toContain('/articles/wedding-catering-trends-guide');
    expect(enhancement).not.toContain('/articles/event-photography-guide');
    expect(enhancement).not.toContain('images.pexels.com');
  });

  test('keeps the visual treatment scoped to the production homepage', () => {
    expect(stylesheet).toContain('body.ef-approved-lower-home');
    expect(stylesheet).toContain('.ef-approved-category-icon');
    expect(stylesheet).toContain('.ef-approved-home-footer .ef-nl-card');
  });

  test('does not introduce unsupported supplier, event or rating claims', () => {
    expect(enhancement).not.toMatch(/1,?000\+|5,?000\+|4\.9/);
  });
});
