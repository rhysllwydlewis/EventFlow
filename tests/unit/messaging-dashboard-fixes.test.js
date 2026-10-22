const fs = require('fs');
const path = require('path');

// Guard hoisted files removed in Messenger v4 migration (Phase 7)

const supplierMsgJsPath = path.join(process.cwd(), 'public/assets/js/supplier-messages.js');
const supplierMsgJsExists = fs.existsSync(supplierMsgJsPath);
const supplierMessagesJs = supplierMsgJsExists ? fs.readFileSync(supplierMsgJsPath, 'utf8') : '';

describe('Messaging Dashboard Fixes', () => {
  (supplierMsgJsExists ? describe : describe.skip)('supplier-messages.js usage', () => {
    it('validates conversationId in openConversation', () => {
      // Should validate conversationId before opening conversation modal
      expect(supplierMessagesJs).toContain('if (!conversationId)');
      expect(supplierMessagesJs).toContain(
        "console.error('Cannot open conversation: conversationId is missing')"
      );
    });

    it('handles authentication errors in openConversation', () => {
      // Should show user-friendly error when not authenticated
      expect(supplierMessagesJs).toContain('if (!user)');
      expect(supplierMessagesJs).toContain('Please sign in to view messages');
    });

    it('handles message loading errors with try-catch', () => {
      // Should wrap listenToMessages in try-catch for error handling
      expect(supplierMessagesJs).toContain('try {');
      expect(supplierMessagesJs).toContain(
        'messagesUnsubscribe = messagingSystem.listenToMessages'
      );
      expect(supplierMessagesJs).toContain('} catch (error)');
      expect(supplierMessagesJs).toContain('Unable to load messages');
    });

    it('handles missing message content defensively', () => {
      // Should use extractMessageText helper function
      expect(supplierMessagesJs).toContain('extractMessageText(message)');
    });

    it('sends message with sendMessage method from messaging system', () => {
      // Should use messagingSystem.sendMessage which now handles transformation
      expect(supplierMessagesJs).toContain('await messagingSystem.sendMessage(conversationId,');
      expect(supplierMessagesJs).toContain('message: messageText');
    });

    it('marks messages as read using markMessagesAsRead', () => {
      // Should use messagingSystem.markMessagesAsRead which now uses correct endpoint
      expect(supplierMessagesJs).toContain('messagingSystem.markMessagesAsRead(conversationId');
    });

    // New tests for comprehensive fixes
    describe('message field normalization', () => {
      it('should extract content from all field variations', () => {
        expect(supplierMessagesJs).toContain('message.message ||');
        expect(supplierMessagesJs).toContain('message.content ||');
        expect(supplierMessagesJs).toContain('message.text ||');
        expect(supplierMessagesJs).toContain('message.body ||');
        expect(supplierMessagesJs).toContain('message.value ||');
      });

      it('should provide fallback text for missing content', () => {
        expect(supplierMessagesJs).toContain('[No message content]');
      });
    });

    describe('HTTP fallback mechanism', () => {
      it('should have loadMessagesHTTPFallback function', () => {
        expect(supplierMessagesJs).toContain('async function loadMessagesHTTPFallback');
      });

      it('should implement timeout and retry logic', () => {
        expect(supplierMessagesJs).toContain('setTimeout');
        expect(supplierMessagesJs).toContain('retryCount');
        expect(supplierMessagesJs).toContain('maxRetries');
      });

      it('should use v4 API only', () => {
        expect(supplierMessagesJs).toContain(
          '/api/v4/messenger/conversations/${conversationId}/messages'
        );
        expect(supplierMessagesJs).not.toContain('/api/v2/messages/${conversationId}');
        expect(supplierMessagesJs).not.toContain('/api/v1/threads/${conversationId}/messages');
      });
    });

    describe('callback error handling', () => {
      it('should catch errors in renderMessages', () => {
        const renderMessagesMatch = supplierMessagesJs.match(
          /const renderMessages = messages => \{[\s\S]*?\n\s{2}\};/
        );
        expect(renderMessagesMatch).toBeTruthy();
        expect(renderMessagesMatch[0]).toContain('try {');
        expect(renderMessagesMatch[0]).toContain('} catch (error)');
      });

      it('should handle per-message errors', () => {
        expect(supplierMessagesJs).toContain('forEach((message, index)');
        expect(supplierMessagesJs).toContain('Skipping invalid message');
      });
    });

    describe('logging and debugging', () => {
      it('should import logMessageState from dashboard-logger utility', () => {
        expect(supplierMessagesJs).toContain(
          "import { logMessageState } from './utils/dashboard-logger.js'"
        );
      });

      it('should log key events', () => {
        expect(supplierMessagesJs).toContain("logMessageState('INIT'");
        expect(supplierMessagesJs).toContain("logMessageState('LISTENER_SETUP'");
        expect(supplierMessagesJs).toContain("logMessageState('MESSAGES_RECEIVED'");
      });
    });

    describe('MessagingSystem validation', () => {
      it('should validate messagingSystem readiness (module-scoped)', () => {
        expect(supplierMessagesJs).toContain('!messagingSystem');
        expect(supplierMessagesJs).toContain(
          "typeof messagingSystem.listenToMessages !== 'function'"
        );
      });

      it('should show error state when system not ready', () => {
        expect(supplierMessagesJs).toContain('System not ready');
      });

      it('should include dashboard logging for debugging', () => {
        expect(supplierMessagesJs).toContain(
          "import { logMessageState } from './utils/dashboard-logger.js'"
        );
      });

      it('should validate conversation objects before rendering', () => {
        expect(supplierMessagesJs).toContain('Skipping invalid conversation');
        expect(supplierMessagesJs).toContain("typeof conversation !== 'object'");
      });

      it('should skip conversations without IDs', () => {
        expect(supplierMessagesJs).toContain('Skipping conversation without ID');
        expect(supplierMessagesJs).toContain('!conversation.id');
      });
    });
  });

  describe('dashboard-logger.js utility', () => {
    const dashboardLoggerJs = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/js/utils/dashboard-logger.js'),
      'utf8'
    );

    it('should initialize window.dashboardLogs array', () => {
      expect(dashboardLoggerJs).toContain('window.dashboardLogs = []');
    });

    it('should export logMessageState function', () => {
      expect(dashboardLoggerJs).toContain('export function logMessageState');
    });

    it('should maintain last 100 log entries', () => {
      expect(dashboardLoggerJs).toContain('window.dashboardLogs.length > 100');
      expect(dashboardLoggerJs).toContain('window.dashboardLogs.shift()');
    });

    it('should export getDashboardLogs function', () => {
      expect(dashboardLoggerJs).toContain('export function getDashboardLogs');
    });

    it('should export clearDashboardLogs function', () => {
      expect(dashboardLoggerJs).toContain('export function clearDashboardLogs');
    });
  });
});
