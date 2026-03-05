const fs = require('fs');
const path = require('path');

describe('Marketplace seller identity resolution', () => {
  const marketplaceJs = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/marketplace.js'),
    'utf8'
  );
  const marketplaceRoute = fs.readFileSync(
    path.join(process.cwd(), 'routes/marketplace.js'),
    'utf8'
  );

  it('frontend messaging uses normalized seller user id fallback chain', () => {
    expect(marketplaceJs).toContain('listing.sellerUserId ||');
    expect(marketplaceJs).toContain('listing.ownerUserId ||');
    expect(marketplaceJs).toContain(
      "listing.createdBy && !String(listing.createdBy).includes('@')"
    );
    expect(marketplaceJs).toContain('participantIds: [sellerUserId]');
  });

  it('marketplace listings API attaches sellerUserId and sellerSupplierId', () => {
    expect(marketplaceRoute).toContain('function resolveListingSellerUserId(listing)');
    expect(marketplaceRoute).toContain('sellerUserId,');
    expect(marketplaceRoute).toContain(
      'sellerSupplierId: sellerUserId ? supplierByOwner.get(sellerUserId) || null : null'
    );
  });
});
