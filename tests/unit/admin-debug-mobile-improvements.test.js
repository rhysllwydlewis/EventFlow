'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('admin debug mobile improvements', () => {
  test('loads the isolated mobile enhancement assets from the existing debug bundle', () => {
    const loader = read('public/assets/js/pages/admin-debug-background-jobs.js');
    expect(loader).toContain('/assets/css/admin-debug-mobile-improvements.css');
    expect(loader).toContain('/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(loader).toContain('data-admin-debug-mobile-improvements');
  });

  test('adds scrollable tabs, mutually exclusive summary figures and grouped results', () => {
    const script = read('public/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(script).toContain("tabs.classList.add('sc-tabs--mobile-enhanced')");
    expect(script).toContain("button.scrollIntoView({ behavior: 'smooth'");
    expect(script).toContain("['Clean passes', counts.passed");
    expect(script).toContain("['Protected', counts.protected");
    expect(script).toContain("['Needs attention'");
    expect(script).toContain("label: 'Expected authentication redirects'");
    expect(script).toContain("label: 'Successful checks'");
  });

  test('only reclassifies redirects that point to authentication routes', () => {
    const script = read('public/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(script).toContain('AUTH_REDIRECT_PATTERN');
    expect(script).toContain('REDIRECT_CODES');
    expect(script).toContain("result.textContent = 'PROTECTED'");
    expect(script).toContain("status.setAttribute('aria-label', 'Protected route')");
  });

  test('keeps existing text sizes while improving narrow-screen hierarchy', () => {
    const styles = read('public/assets/css/admin-debug-mobile-improvements.css');
    expect(styles).not.toMatch(/font-size\s*:/);
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('position: sticky');
    expect(styles).toContain('grid-template-columns: auto minmax(0, 1fr)');
    expect(styles).toContain('.sc-summary-card.sc-summary-card--mobile-enhanced');
    expect(styles).toContain("[class*='floating'][style*='position: fixed']");
  });
});
