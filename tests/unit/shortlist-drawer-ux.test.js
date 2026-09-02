const fs = require('fs');
const path = require('path');

describe('Shortlist drawer image fallback', () => {
  const shortlistDrawerJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/components/shortlist-drawer.js'),
    'utf8'
  );

  it('uses CSP-safe data-fallback-src for broken images instead of inline onerror', () => {
    expect(shortlistDrawerJs).toContain(
      'data-fallback-src="/assets/images/marketplace-placeholder.svg"'
    );
    expect(shortlistDrawerJs).not.toContain('onerror=');
    expect(shortlistDrawerJs).toContain('/assets/images/marketplace-placeholder.svg');
  });

  it('uses marketplace-placeholder.svg as default image', () => {
    expect(shortlistDrawerJs).toContain(
      "const imageUrl = escapeHtml(item.imageUrl || '/assets/images/marketplace-placeholder.svg');"
    );
  });

  it('has increased SVG icon size to 24x24', () => {
    expect(shortlistDrawerJs).toContain('width="24" height="24"');
  });
});

describe('Shortlist drawer XSS protection (regression for stored XSS in renderItem)', () => {
  const shortlistDrawerJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/components/shortlist-drawer.js'),
    'utf8'
  );

  it('imports the shared escapeHtml helper', () => {
    expect(shortlistDrawerJs).toContain("import { escapeHtml } from '../utils/common-helpers.js';");
  });

  it("escapes every user-controlled field before interpolating into renderItem's innerHTML template", () => {
    const renderItemMatch = shortlistDrawerJs.match(/renderItem\(item\) \{[\s\S]*?\n {2}\}/);
    expect(renderItemMatch).toBeTruthy();
    const renderItemSource = renderItemMatch[0];

    // Every user-controlled field must be assigned via escapeHtml(...) before use.
    expect(renderItemSource).toMatch(/const imageUrl = escapeHtml\(/);
    expect(renderItemSource).toMatch(/const name = escapeHtml\(item\.name\)/);
    expect(renderItemSource).toMatch(/const category = escapeHtml\(/);
    expect(renderItemSource).toMatch(/const location = escapeHtml\(/);
    expect(renderItemSource).toMatch(/const priceHint = escapeHtml\(/);

    // The template must use the escaped local variables, not the raw item fields, for
    // every place user-controlled text lands inside an HTML attribute or element body.
    expect(renderItemSource).not.toMatch(/\$\{item\.name\}/);
    expect(renderItemSource).not.toMatch(/\$\{item\.category/);
    expect(renderItemSource).not.toMatch(/\$\{item\.location/);
    expect(renderItemSource).not.toMatch(/\$\{item\.imageUrl/);
    expect(renderItemSource).not.toMatch(/\$\{item\.priceHint/);
  });
});

describe('Shortlist drawer button accessibility', () => {
  const componentsCSS = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/css/components.css'),
    'utf8'
  );

  it('has 44x44px touch target for remove button', () => {
    const buttonMatch = componentsCSS.match(/\.shortlist-item-remove\s*{[^}]*}/s);
    expect(buttonMatch).toBeTruthy();
    const buttonStyles = buttonMatch[0];
    expect(buttonStyles).toContain('width: 44px');
    expect(buttonStyles).toContain('height: 44px');
  });

  it('has focus state with visible outline', () => {
    expect(componentsCSS).toContain('.shortlist-item-remove:focus');
    expect(componentsCSS).toContain('outline:');
  });
});
