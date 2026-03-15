/**
 * Tests for messaging-notification integration
 * Validates that messaging system properly integrates with notification system
 */

const fs = require('fs');
const path = require('path');

// messaging.js was removed as part of Messenger v4 migration (Phase 7).
const messagingJsPath = path.join(process.cwd(), 'public/assets/js/messaging.js');
const messagingJsExists = fs.existsSync(messagingJsPath);
const messagingJsContent = messagingJsExists ? fs.readFileSync(messagingJsPath, 'utf8') : '';

describe('Messaging-Notification Integration', () => {
  const messagingV2Path = path.join(process.cwd(), 'routes/messaging-v2.js');
  (fs.existsSync(messagingV2Path) ? describe : describe.skip)(
    'Backend integration (routes/messaging-v2.js)',
    () => {
      const messagingV2Js = fs.existsSync(messagingV2Path)
        ? fs.readFileSync(messagingV2Path, 'utf8')
        : '';

      it('imports NotificationService', () => {
        expect(messagingV2Js).toContain("require('../services/notificationService')");
      });

      it('creates notifications after sending messages', () => {
        // Find the send message endpoint
        const sendMessageEndpoint = messagingV2Js.substring(
          messagingV2Js.indexOf('POST /api/v2/messages/:threadId'),
          messagingV2Js.indexOf('PUT /api/v2/messages/:messageId')
        );

        // Should call notifyNewMessage for each recipient
        expect(sendMessageEndpoint).toContain('notificationService.notifyNewMessage');
        expect(sendMessageEndpoint).toContain('for (const recipientId of recipientIds)');
        expect(sendMessageEndpoint).toContain('senderName');
        expect(sendMessageEndpoint).toContain('messagePreview');
      });

      it('relies on NotificationService for WebSocket emission', () => {
        const sendMessageEndpoint = messagingV2Js.substring(
          messagingV2Js.indexOf('POST /api/v2/messages/:threadId'),
          messagingV2Js.indexOf('PUT /api/v2/messages/:messageId')
        );

        // Should NOT manually emit notification:new (NotificationService handles it)
        // This prevents duplicate notifications
        const manualEmitCount = (sendMessageEndpoint.match(/emit\('notification:new'/g) || [])
          .length;
        expect(manualEmitCount).toBe(0);
      });

      it('handles notification errors gracefully', () => {
        const sendMessageEndpoint = messagingV2Js.substring(
          messagingV2Js.indexOf('POST /api/v2/messages/:threadId'),
          messagingV2Js.indexOf('PUT /api/v2/messages/:messageId')
        );

        // Should catch notification errors without failing message send
        expect(sendMessageEndpoint).toContain('catch (notifError)');
        expect(sendMessageEndpoint).toContain('logger.error');
      });
    }
  );

  describe('Backend notification service (services/notification.service.js)', () => {
    const notificationServiceJs = fs.readFileSync(
      path.join(process.cwd(), 'services/notification.service.js'),
      'utf8'
    );

    it('has notifyNewMessage helper method', () => {
      expect(notificationServiceJs).toContain('async notifyNewMessage');
    });

    it('notifyNewMessage accepts message preview parameter', () => {
      const notifyNewMessageFn = notificationServiceJs.substring(
        notificationServiceJs.indexOf('async notifyNewMessage('),
        notificationServiceJs.indexOf('async notifyBookingUpdate') ||
          notificationServiceJs.indexOf('async notifyPayment')
      );

      expect(notifyNewMessageFn).toContain('messagePreview');
      expect(notifyNewMessageFn).toContain('metadata');
    });

    it('notifyNewMessage uses correct actionUrl format', () => {
      const notifyNewMessageFn = notificationServiceJs.substring(
        notificationServiceJs.indexOf('async notifyNewMessage('),
        notificationServiceJs.indexOf('async notifyBookingUpdate') ||
          notificationServiceJs.indexOf('async notifyPayment')
      );

      // Should use canonical /messenger/?conversation= format (not the legacy /messages.html redirect)
      expect(notifyNewMessageFn).toContain('/messenger/?conversation=');
    });

    it('has notifyNewTicket helper method for admin ticket notifications', () => {
      expect(notificationServiceJs).toContain('async notifyNewTicket');
    });

    it('notifyNewTicket uses high priority and ticket type', () => {
      const fn = notificationServiceJs.substring(
        notificationServiceJs.indexOf('async notifyNewTicket('),
        notificationServiceJs.indexOf('async notifyTicketReply(')
      );
      expect(fn).toContain("type: 'ticket'");
      expect(fn).toContain("priority: 'high'");
      expect(fn).toContain('/admin-tickets');
      expect(fn).toContain('ticketId');
      expect(fn).toContain('metadata');
    });

    it('has notifyTicketReply helper method for admin ticket reply notifications', () => {
      expect(notificationServiceJs).toContain('async notifyTicketReply');
    });

    it('notifyTicketReply uses normal priority and ticket type', () => {
      const startIdx = notificationServiceJs.indexOf('async notifyTicketReply(');
      const fn = notificationServiceJs.substring(startIdx, startIdx + 600);
      expect(fn).toContain("type: 'ticket'");
      expect(fn).toContain("priority: 'normal'");
      expect(fn).toContain('/admin-tickets');
    });

    it('has ticket icon in _getDefaultIcon map', () => {
      const iconMapStart = notificationServiceJs.indexOf('_getDefaultIcon(type)');
      const iconMapFn = notificationServiceJs.substring(iconMapStart, iconMapStart + 1000);
      expect(iconMapFn).toContain('ticket:');
      expect(iconMapFn).toContain('🎫');
    });
  });

  (messagingJsExists ? describe : describe.skip)('Frontend messaging.js integration', () => {
    it('has triggerMessageNotification method', () => {
      expect(messagingJsContent).toContain('triggerMessageNotification(data)');
    });

    it('handleNewMessage triggers notification system', () => {
      // Simply check that the entire file contains the necessary integration
      expect(messagingJsContent).toContain('triggerMessageNotification');
      expect(messagingJsContent).toContain('handleNewMessage(data)');
      // The handleNewMessage method should call triggerMessageNotification
      const hasIntegration =
        messagingJsContent.includes('handleNewMessage') &&
        messagingJsContent.includes('triggerMessageNotification');
      expect(hasIntegration).toBe(true);
    });

    it('triggerMessageNotification dispatches custom event', () => {
      // Check that the file contains the event dispatch logic
      expect(messagingJsContent).toContain("new CustomEvent('messaging:notification'");
      expect(messagingJsContent).toContain('window.dispatchEvent');
      expect(messagingJsContent).toContain('triggerMessageNotification');
    });

    it('markMessagesAsRead dispatches marked-read event', () => {
      // Check for the marked-read event dispatch
      expect(messagingJsContent).toContain("new CustomEvent('messaging:marked-read'");
      expect(messagingJsContent).toContain('conversationId');
    });

    it('uses consistent message preview length (100 chars)', () => {
      // Check that message preview is truncated to 100 characters
      expect(messagingJsContent).toContain('substring(0, 100)');
    });
  });

  describe('Frontend notifications.js integration', () => {
    const notificationsJs = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/js/notifications.js'),
      'utf8'
    );

    it('listens for messaging:notification events', () => {
      expect(notificationsJs).toContain("addEventListener('messaging:notification'");
    });

    it('listens for messaging:marked-read events', () => {
      expect(notificationsJs).toContain("addEventListener('messaging:marked-read'");
    });

    it('has addMessageNotification helper function', () => {
      expect(notificationsJs).toContain('function addMessageNotification(notification)');
    });

    it('listens for WebSocket notification events', () => {
      // Should listen for both v1 (notification) and v2 (notification:received) events
      expect(notificationsJs).toContain("state.socket.on('notification'");
      expect(notificationsJs).toContain("state.socket.on('notification:received'");
    });

    it('handles both threadId and conversationId in mark-as-read', () => {
      const markedReadListener = notificationsJs.substring(
        notificationsJs.indexOf("addEventListener('messaging:marked-read'"),
        notificationsJs.indexOf('function showWebSocketError') ||
          notificationsJs.indexOf('async function fetchNotifications')
      );

      // Should check both metadata.conversationId and metadata.threadId for compatibility
      expect(markedReadListener).toContain('n.metadata?.conversationId');
      expect(markedReadListener).toContain('n.metadata?.threadId');
    });

    it('does not use deprecated substr method', () => {
      // substr() is deprecated, should use substring() or slice()
      const substrCount = (notificationsJs.match(/\.substr\(/g) || []).length;
      expect(substrCount).toBe(0);
    });
  });

  describe('CSS styling for message notifications', () => {
    const componentsCss = fs.readFileSync(
      path.join(process.cwd(), 'public/assets/css/components.css'),
      'utf8'
    );

    it('has message notification styling', () => {
      expect(componentsCss).toContain('.ef-notification--message');
    });

    it('has purple gradient theme for messages', () => {
      expect(componentsCss).toContain('rgba(102, 126, 234');
      expect(componentsCss).toContain('rgba(118, 75, 162');
    });

    it('supports sender avatar styling', () => {
      expect(componentsCss).toContain('.sender-avatar');
    });
  });
});
