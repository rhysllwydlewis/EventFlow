const fs = require('fs');
const path = require('path');

describe('Marketplace own listing edit button', () => {
  const marketplaceJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/marketplace.js'),
    'utf8'
  );

  it('displays Edit Listing button for own listings', () => {
    expect(marketplaceJs).toContain('Edit Listing');
    expect(marketplaceJs).toContain('/supplier/marketplace-new-listing?edit=');
  });

  it('displays View My Listings link as secondary action', () => {
    expect(marketplaceJs).toContain('View My Listings');
    expect(marketplaceJs).toContain('/my-marketplace-listings');
  });

  it('wraps actions in listing-own-notice-actions div', () => {
    expect(marketplaceJs).toContain('listing-own-notice-actions');
  });

  it('includes informative text about listing ownership', () => {
    expect(marketplaceJs).toContain('This is your listing');
  });
});

describe('Marketplace own listing CSS styling', () => {
  const marketplaceCSS = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/css/marketplace.css'),
    'utf8'
  );

  it('has proper styling for listing-own-notice', () => {
    expect(marketplaceCSS).toContain('.listing-own-notice');
    expect(marketplaceCSS).toContain('background: #f6faf9');
    expect(marketplaceCSS).toContain('border-radius: 8px');
  });

  it('has action buttons container with flex layout', () => {
    expect(marketplaceCSS).toContain('.listing-own-notice-actions');
    expect(marketplaceCSS).toContain('display: flex');
    expect(marketplaceCSS).toContain('gap:');
  });

  it('ensures buttons have minimum width for usability', () => {
    expect(marketplaceCSS).toContain('min-width: 0');
    expect(marketplaceCSS).toContain('flex: 1');
  });
});
