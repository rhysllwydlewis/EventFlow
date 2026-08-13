'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/supplier-dashboard-visual-refresh.css'),
  'utf8',
);

describe('supplier dashboard section navigation layout', () => {
  it('finishes the cascade with sticky positioning and the header offset', () => {
    const selector = '.supplier-dashboard-page .dashboard-mobile-nav {';
    const finalRuleStart = css.lastIndexOf(selector);
    const finalRuleEnd = css.indexOf('}', finalRuleStart);
    const finalRule = css.slice(finalRuleStart, finalRuleEnd + 1);

    expect(finalRuleStart).toBeGreaterThanOrEqual(0);
    expect(finalRule).toContain('position: sticky;');
    expect(finalRule).toContain('top: var(--ef-header-height, 64px);');
    expect(finalRule).toContain('z-index: 12;');

    const earlierRelativeRule = css.indexOf(`${selector}\n  position: relative;`);
    expect(finalRuleStart).toBeGreaterThan(earlierRelativeRule);
  });

  it('disables the old absolutely positioned Settings icon marker', () => {
    const selector = '.supplier-dashboard-page .mobile-nav-pill[data-href] .pill-icon::after {';
    const finalRuleStart = css.lastIndexOf(selector);
    const finalRuleEnd = css.indexOf('}', finalRuleStart);
    const finalRule = css.slice(finalRuleStart, finalRuleEnd + 1);

    expect(finalRule).toContain('content: none;');
    expect(css).toContain('.supplier-dashboard-page .mobile-nav-pill[data-href]::after {');
  });
});
