const fs = require('fs');
const path = require('path');

describe('Marketplace messaging flow fixes', () => {
  describe('Bug 1: marketplace.js in-place confirmation', () => {
    const marketplaceJs = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/js/marketplace.js'),
      'utf8'
    );

    it('shows success message after sending', () => {
      expect(marketplaceJs).toContain("statusEl.textContent = '✓ Message sent!'");
      expect(marketplaceJs).toContain("statusEl.style.color = '#10b981'");
    });

    it('changes button to "Go to Conversation"', () => {
      expect(marketplaceJs).toContain("sendBtn.textContent = 'Go to Conversation'");
    });

    it('does not immediately redirect to conversation page', () => {
      // Should not have direct redirect after conversation creation, only in onclick handler
      const afterConvCreation = marketplaceJs.split(
        'conversationId = data.conversation?._id || data.conversation?.id;'
      )[1];
      const beforeOnclick = afterConvCreation
        ? afterConvCreation.split('sendBtn.onclick = () => {')[0]
        : '';
      // Check that redirect is NOT in the immediate flow (before onclick assignment)
      expect(beforeOnclick).not.toContain('window.location.href');
    });

    it('button click handler navigates to conversation', () => {
      expect(marketplaceJs).toContain('sendBtn.onclick = () => {');
      expect(marketplaceJs).toContain(
        'window.location.href = `/messenger/?conversation=${conversationId}`'
      );
    });
  });

  // conversation-handler.js was confirmed dead code (unreferenced by any page — the
  // real messaging UI is Messenger v4) and deleted as part of the 2026-09-02 security
  // audit fix-up (it had an unescaped XSS sink). Skip rather than fail when it's gone.
});
