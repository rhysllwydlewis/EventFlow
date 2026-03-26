const fs = require('fs');
const path = require('path');

describe('Shortlist drawer image fallback', () => {
  const shortlistDrawerJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/components/shortlist-drawer.js'),
    'utf8'
  );

  it('uses CSP-safe data-fallback-src for broken images instead of inline onerror', () => {
    expect(shortlistDrawerJs).toContain('data-fallback-src="/assets/images/marketplace-placeholder.svg"');
    expect(shortlistDrawerJs).not.toContain('onerror=');
    expect(shortlistDrawerJs).toContain('/assets/images/marketplace-placeholder.svg');
  });

  it('uses marketplace-placeholder.svg as default image', () => {
    expect(shortlistDrawerJs).toContain(
      "const imageUrl = item.imageUrl || '/assets/images/marketplace-placeholder.svg';"
    );
  });

  it('has increased SVG icon size to 24x24', () => {
    expect(shortlistDrawerJs).toContain('width="24" height="24"');
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
