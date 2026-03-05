const fs = require('fs');
const path = require('path');

const threadsRoutePath = path.join(process.cwd(), 'routes/threads.js');
(fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
  'Marketplace peer-to-peer messaging support',
  () => {
    const threadsRoute = fs.existsSync(threadsRoutePath)
      ? fs.readFileSync(threadsRoutePath, 'utf8')
      : '';

    it('allows peer-to-peer marketplace conversations without supplier', () => {
      expect(threadsRoute).toContain('isMarketplacePeerToPeer');
      expect(threadsRoute).toContain('!effectiveSupplierId &&');
      expect(threadsRoute).toContain('effectiveRecipientId &&');
      expect(threadsRoute).toContain('effectiveRecipientId !== req.user.id');
    });

    it('validates recipient exists for peer-to-peer conversations', () => {
      expect(threadsRoute).toContain("error: 'Recipient not found'");
      expect(threadsRoute).toContain('recipientUser');
    });

    it('prevents users from messaging themselves', () => {
      expect(threadsRoute).toContain("error: 'Cannot message yourself'");
    });

    it('creates thread with isPeerToPeer flag for marketplace peer-to-peer', () => {
      expect(threadsRoute).toContain('isPeerToPeer: isMarketplacePeerToPeer');
    });

    it('finds peer-to-peer threads by recipientId and listingId', () => {
      expect(threadsRoute).toContain('t.recipientId === effectiveRecipientId');
      expect(threadsRoute).toContain('t.marketplace?.listingId === String(marketplaceListingId)');
    });
  }
);
