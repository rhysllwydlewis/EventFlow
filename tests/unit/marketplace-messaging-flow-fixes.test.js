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

  const threadsRoutePath = path.join(process.cwd(), 'routes/threads.js');
  (fs.existsSync(threadsRoutePath) ? describe : describe.skip)(
    'Bug 2: threads.js stores customerName and recipientName',
    () => {
      const threadsJs = fs.existsSync(threadsRoutePath)
        ? fs.readFileSync(threadsRoutePath, 'utf8')
        : '';

      it('looks up customer user from users collection', () => {
        const afterThreadCreation = threadsJs.split('if (!thread) {')[1];
        expect(afterThreadCreation).toContain("const users = await dbUnified.read('users')");
        expect(afterThreadCreation).toContain(
          'const customerUser = users.find(u => u.id === req.user.id)'
        );
      });

      it('stores customerName in thread object', () => {
        expect(threadsJs).toContain('customerName: customerUser ? customerUser.name : null');
      });

      it('looks up recipient user for peer-to-peer conversations', () => {
        const afterThreadCreation = threadsJs.split('if (!thread) {')[1];
        expect(afterThreadCreation).toContain('const recipientUser = effectiveRecipientId');
        expect(afterThreadCreation).toContain('users.find(u => u.id === effectiveRecipientId)');
      });

      it('stores recipientName in thread object', () => {
        expect(threadsJs).toContain('recipientName: recipientUser ? recipientUser.name : null');
      });
    }
  );

  describe('Bug 3: conversation-handler.js v1 API fallback removed', () => {
    const conversationHandlerJs = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/js/conversation-handler.js'),
      'utf8'
    );

    it('loadThread shows error message for thd_* thread IDs instead of calling v1 API', () => {
      const loadThreadFn = conversationHandlerJs
        .split('async function loadThread()')[1]
        .split('async function')[0];
      expect(loadThreadFn).toContain("threadId.startsWith('thd_')");
      expect(loadThreadFn).not.toContain('fetch(`/api/v1/threads/${threadId}`');
    });

    it('loadMessages skips v1 API for thd_* thread IDs', () => {
      const loadMessagesFn = conversationHandlerJs
        .split('async function loadMessages()')[1]
        .split('async function')[0];
      expect(loadMessagesFn).toContain("threadId.startsWith('thd_')");
      expect(loadMessagesFn).not.toContain('fetch(`/api/v1/threads/${threadId}/messages`');
    });

    it('renderThreadHeader uses resolveOtherPartyName for displaying other party', () => {
      const renderThreadHeaderFn = conversationHandlerJs
        .split('function renderThreadHeader()')[1]
        .split('function ')[0];
      expect(renderThreadHeaderFn).toContain('resolveOtherPartyName()');
    });

    it('resolveOtherPartyName has proper fallback chain for peer-to-peer threads', () => {
      const resolveOtherPartyNameFn = conversationHandlerJs
        .split('function resolveOtherPartyName()')[1]
        .split('function ')[0];
      // Should check for supplierName, recipientName, and metadata.otherPartyName
      expect(resolveOtherPartyNameFn).toContain('thread.supplierName');
      expect(resolveOtherPartyNameFn).toContain('thread.recipientName');
      expect(resolveOtherPartyNameFn).toContain('thread.metadata?.otherPartyName');
    });
  });
});
