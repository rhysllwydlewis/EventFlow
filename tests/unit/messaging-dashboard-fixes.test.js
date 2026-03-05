const fs = require('fs');
const path = require('path');

// Guard hoisted files removed in Messenger v4 migration (Phase 7)
const messagingJsPath = path.join(process.cwd(), 'public/assets/js/messaging.js');
const messagingJsExists = fs.existsSync(messagingJsPath);
const messagingJs = messagingJsExists ? fs.readFileSync(messagingJsPath, 'utf8') : '';

const customerMsgJsPath = path.join(process.cwd(), 'public/assets/js/customer-messages.js');
const customerMsgJsExists = fs.existsSync(customerMsgJsPath);
const customerMessagesJs = customerMsgJsExists ? fs.readFileSync(customerMsgJsPath, 'utf8') : '';

const supplierMsgJsPath = path.join(process.cwd(), 'public/assets/js/supplier-messages.js');
const supplierMsgJsExists = fs.existsSync(supplierMsgJsPath);
const supplierMessagesJs = supplierMsgJsExists ? fs.readFileSync(supplierMsgJsPath, 'utf8') : '';

describe('Messaging Dashboard Fixes', () => {
  (messagingJsExists ? describe : describe.skip)('messaging.js client-side fixes', () => {
    it('transforms message field to content field in sendMessageViaAPI', () => {
      const sendMessageFn = messagingJs
        .split('async sendMessageViaAPI(conversationId, messageData)')[1]
        .split('async ')[0];

      // Should transform message to content for v2 API compatibility
      expect(sendMessageFn).toContain('if (payload.message && !payload.content)');
      expect(sendMessageFn).toContain('payload.content = payload.message');
      expect(sendMessageFn).toContain('delete payload.message');
    });

    it('extracts error messages from API responses in sendMessageViaAPI', () => {
      const sendMessageFn = messagingJs
        .split('async sendMessageViaAPI(conversationId, messageData)')[1]
        .split('async ')[0];

      // Should extract error message from response
      expect(sendMessageFn).toContain('await response.json().catch(() => ({}))');
      expect(sendMessageFn).toContain('errorData.message || errorData.error');
    });

    it('uses correct v2 endpoint for markMessagesAsReadViaAPI', () => {
      const markAsReadFn = messagingJs
        .split('async markMessagesAsReadViaAPI(conversationId)')[1]
        .split('async ')[0];

      // Should use /api/v2/messages/threads/:threadId/read endpoint
      expect(markAsReadFn).toContain('/api/v2/messages/threads/${conversationId}/read');
      expect(markAsReadFn).not.toContain('/api/v2/messages/${conversationId}/read');
    });

    it('extracts error messages in markMessagesAsReadViaAPI', () => {
      const markAsReadFn = messagingJs
        .split('async markMessagesAsReadViaAPI(conversationId)')[1]
        .split('async ')[0];

      // Should extract error message from response
      expect(markAsReadFn).toContain('await response.json().catch(() => ({}))');
      expect(markAsReadFn).toContain('errorData.message || errorData.error');
    });

    it('uses correct v2 endpoint in MessagingManager.markMessagesAsRead', () => {
      const markAsReadFn = messagingJs
        .split('async markMessagesAsRead(threadId)')[1]
        .split('async ')[0];

      // Should use /api/v2/messages/threads/:threadId/read endpoint
      expect(markAsReadFn).toContain('/api/v2/messages/threads/${threadId}/read');
      expect(markAsReadFn).not.toContain('/mark-read');
    });

    it('extracts error messages in MessagingManager.markMessagesAsRead', () => {
      const markAsReadFn = messagingJs
        .split('async markMessagesAsRead(threadId)')[1]
        .split('async ')[0];

      // Should extract error message from response
      expect(markAsReadFn).toContain('await response.json().catch(() => ({}))');
      expect(markAsReadFn).toContain('errorData.message || errorData.error');
    });
  });

  const messagingV2Path = path.join(process.cwd(), 'routes/messaging-v2.js');
  (fs.existsSync(messagingV2Path) ? describe : describe.skip)(
    'messaging-v2.js server-side fixes',
    () => {
      const messagingV2Js = fs.existsSync(messagingV2Path)
        ? fs.readFileSync(messagingV2Path, 'utf8')
        : '';

      it('supports both content and message fields in send message endpoint', () => {
        // Find the route handler code between the comment and the next router call
        const startMarker = '* Send message in thread';
        const startIdx = messagingV2Js.indexOf(startMarker);
        const endIdx = messagingV2Js.indexOf('router.post', startIdx + 100);
        const sendMessageRoute = messagingV2Js.substring(startIdx, endIdx);

        // Should destructure both content and message (as legacyMessage)
        expect(sendMessageRoute).toContain('message: legacyMessage');

        // Should use message as content if content is not provided
        expect(sendMessageRoute).toContain('if (!content && legacyMessage)');
        expect(sendMessageRoute).toContain('content = legacyMessage');
      });

      it('maintains backward compatibility with message field', () => {
        const startMarker = '* Send message in thread';
        const startIdx = messagingV2Js.indexOf(startMarker);
        const endIdx = messagingV2Js.indexOf('router.post', startIdx + 100);
        const sendMessageRoute = messagingV2Js.substring(startIdx, endIdx);

        // Should still validate that content or attachments are required
        // Updated to match new implementation that checks attachments.length
        expect(sendMessageRoute).toContain('attachments.length === 0');
        expect(sendMessageRoute).toContain("error: 'content or attachments required'");
      });

      it('POST /api/v2/messages/threads/:threadId/read endpoint exists', () => {
        // Endpoint should exist
        expect(messagingV2Js).toContain("'/threads/:threadId/read',");
        expect(messagingV2Js).toContain('Mark all messages in thread as read');
      });
    }
  );

  (customerMsgJsExists ? describe : describe.skip)('customer-messages.js usage', () => {
    it('imports MessagingManager from messaging.js', () => {
      // Should import MessagingManager to avoid "messagingManager is not defined" error
      expect(customerMessagesJs).toContain('import messagingSystem, { MessagingManager }');
      expect(customerMessagesJs).toContain('const messagingManager = new MessagingManager()');
    });

    it('validates conversationId in openConversation', () => {
      // Should validate conversationId before opening conversation modal
      expect(customerMessagesJs).toContain('if (!conversationId)');
      expect(customerMessagesJs).toContain(
        "console.error('Cannot open conversation: conversationId is missing')"
      );
    });

    it('handles authentication errors in openConversation', () => {
      // Should show user-friendly error when not authenticated
      expect(customerMessagesJs).toContain('if (!user)');
      expect(customerMessagesJs).toContain('Please sign in to view messages');
    });

    it('handles message loading errors with try-catch', () => {
      // Should wrap listenToMessages in try-catch for error handling
      expect(customerMessagesJs).toContain('try {');
      expect(customerMessagesJs).toContain(
        'messagesUnsubscribe = messagingSystem.listenToMessages'
      );
      expect(customerMessagesJs).toContain('} catch (error)');
      expect(customerMessagesJs).toContain('Unable to load messages');
    });

    it('handles missing message content defensively', () => {
      // Should use extractMessageText helper function
      expect(customerMessagesJs).toContain('extractMessageText(message)');
    });

    it('sends message with sendMessage method from messaging system', () => {
      // Should use messagingSystem.sendMessage which now handles transformation
      expect(customerMessagesJs).toContain('await messagingSystem.sendMessage(conversationId,');
      expect(customerMessagesJs).toContain('message: messageText');
    });

    it('marks messages as read using markMessagesAsRead', () => {
      // Should use messagingSystem.markMessagesAsRead which now uses correct endpoint
      expect(customerMessagesJs).toContain('messagingSystem.markMessagesAsRead(conversationId');
    });

    // New tests for comprehensive fixes
    describe('message field normalization', () => {
      it('should extract content from message field', () => {
        expect(customerMessagesJs).toContain('message.message ||');
      });

      it('should extract content from content field', () => {
        expect(customerMessagesJs).toContain('message.content ||');
      });

      it('should extract content from text field', () => {
        expect(customerMessagesJs).toContain('message.text ||');
      });

      it('should extract content from body field', () => {
        expect(customerMessagesJs).toContain('message.body ||');
      });

      it('should extract content from value field', () => {
        expect(customerMessagesJs).toContain('message.value ||');
      });

      it('should handle string messages directly', () => {
        expect(customerMessagesJs).toContain("typeof message === 'string'");
      });

      it('should provide fallback text for missing content', () => {
        expect(customerMessagesJs).toContain('[No message content]');
      });
    });

    describe('HTTP fallback mechanism', () => {
      it('should have loadMessagesHTTPFallback function', () => {
        expect(customerMessagesJs).toContain('async function loadMessagesHTTPFallback');
      });

      it('should try v2 API first', () => {
        expect(customerMessagesJs).toContain('/api/v2/messages/${conversationId}');
      });

      it('should try v1 API for legacy thread IDs', () => {
        expect(customerMessagesJs).toContain("conversationId.startsWith('thd_')");
        expect(customerMessagesJs).toContain('/api/v1/threads/${conversationId}/messages');
      });

      it('should handle HTTP fallback failure gracefully', () => {
        expect(customerMessagesJs).toContain('HTTP fallback failed');
      });

      it('should implement timeout mechanism', () => {
        expect(customerMessagesJs).toContain('setTimeout');
        expect(customerMessagesJs).toContain('3000');
      });

      it('should implement retry logic', () => {
        expect(customerMessagesJs).toContain('retryCount');
        expect(customerMessagesJs).toContain('maxRetries');
      });

      it('should show error state if all fallbacks fail', () => {
        expect(customerMessagesJs).toContain('Unable to load messages. Please refresh');
      });
    });

    describe('callback error handling', () => {
      it('should catch errors in renderMessages', () => {
        const renderMessagesMatch = customerMessagesJs.match(
          /const renderMessages = messages => \{[\s\S]*?\n\s{2}\};/
        );
        expect(renderMessagesMatch).toBeTruthy();
        expect(renderMessagesMatch[0]).toContain('try {');
        expect(renderMessagesMatch[0]).toContain('} catch (error)');
      });

      it('should continue rendering valid messages on error', () => {
        expect(customerMessagesJs).toContain('} catch (msgError)');
        expect(customerMessagesJs).toContain('// Continue with next message');
      });

      it('should display user-friendly error message', () => {
        expect(customerMessagesJs).toContain('Error displaying messages');
      });

      it('should handle per-message errors', () => {
        expect(customerMessagesJs).toContain('forEach((message, index)');
        expect(customerMessagesJs).toContain('Skipping invalid message');
      });
    });

    describe('logging and debugging', () => {
      it('should import logMessageState from dashboard-logger utility', () => {
        expect(customerMessagesJs).toContain(
          "import { logMessageState } from './utils/dashboard-logger.js'"
        );
      });

      it('should log initialization', () => {
        expect(customerMessagesJs).toContain("logMessageState('INIT'");
      });

      it('should log listener setup', () => {
        expect(customerMessagesJs).toContain("logMessageState('LISTENER_SETUP'");
      });

      it('should log messages received', () => {
        expect(customerMessagesJs).toContain("logMessageState('MESSAGES_RECEIVED'");
      });

      it('should log render completion', () => {
        expect(customerMessagesJs).toContain("logMessageState('RENDER_COMPLETE'");
      });

      it('should log fallback triggers', () => {
        expect(customerMessagesJs).toContain("logMessageState('FALLBACK_TRIGGERED'");
      });
    });

    describe('MessagingSystem validation', () => {
      it('should validate messagingSystem exists (module-scoped)', () => {
        expect(customerMessagesJs).toContain('!messagingSystem');
      });

      it('should validate listenToMessages function exists', () => {
        expect(customerMessagesJs).toContain(
          "typeof messagingSystem.listenToMessages !== 'function'"
        );
      });

      it('should show error state when system not ready', () => {
        expect(customerMessagesJs).toContain('System not ready');
        expect(customerMessagesJs).toContain('Messaging system initialization failed');
      });

      it('should include dashboard logging for debugging', () => {
        expect(customerMessagesJs).toContain(
          "import { logMessageState } from './utils/dashboard-logger.js'"
        );
      });

      it('should validate conversation objects before rendering', () => {
        expect(customerMessagesJs).toContain('Skipping invalid conversation');
        expect(customerMessagesJs).toContain("typeof conversation !== 'object'");
      });

      it('should skip conversations without IDs', () => {
        expect(customerMessagesJs).toContain('Skipping conversation without ID');
        expect(customerMessagesJs).toContain('!conversation.id');
      });

      it('should safely generate initials with fallback', () => {
        expect(customerMessagesJs).toContain('.filter(n => n && n.length > 0)');
        expect(customerMessagesJs).toContain(".toUpperCase() || 'U'");
      });
    });
  });

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
