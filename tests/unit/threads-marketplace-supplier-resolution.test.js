const fs = require('fs');
const path = require('path');

const threadsRoutePath = path.join(process.cwd(), 'routes/threads.js');
(fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
  'Threads start route marketplace supplier resolution',
  () => {
    const threadsRoute = fs.existsSync(threadsRoutePath)
      ? fs.readFileSync(threadsRoutePath, 'utf8')
      : '';

    it('resolves supplier using marketplace listing fallback fields', () => {
      expect(threadsRoute).toContain('if (!effectiveSupplierId && marketplaceListingId)');
      expect(threadsRoute).toContain(
        'const listingSellerUserId = resolveListingSellerUserId(listing);'
      );
      expect(threadsRoute).toContain('s => s.ownerUserId === listingSellerUserId && s.approved');
    });

    it('prevents users from messaging their own listing', () => {
      expect(threadsRoute).toContain("error: 'Cannot message your own listing'");
    });
  }
);
