/**
 * Unit tests for utils/webSocketMiddleware.js's isThreadParticipant() helper,
 * including the prefetchedThread parameter added to avoid a redundant
 * messagingService.getThread() call when the caller already has the thread
 * (see websocket-server-v2.js's handleMessageSend).
 */

'use strict';

const { isThreadParticipant } = require('../../utils/webSocketMiddleware');

describe('isThreadParticipant', () => {
  function buildMessagingService(thread) {
    return { getThread: jest.fn(async () => thread) };
  }

  describe('fetching the thread itself (no prefetchedThread passed)', () => {
    it('returns true for a v2 thread when userId is in participants', async () => {
      const messagingService = buildMessagingService({ participants: ['user-1', 'user-2'] });
      const result = await isThreadParticipant('user-1', 'thread-1', messagingService);
      expect(result).toBe(true);
      expect(messagingService.getThread).toHaveBeenCalledWith('thread-1');
      expect(messagingService.getThread).toHaveBeenCalledTimes(1);
    });

    it('returns false for a v2 thread when userId is not in participants', async () => {
      const messagingService = buildMessagingService({ participants: ['user-1', 'user-2'] });
      const result = await isThreadParticipant('attacker-id', 'thread-1', messagingService);
      expect(result).toBe(false);
    });

    it('returns true for a v1 thread via customerId/recipientId/supplierId', async () => {
      const customerThread = buildMessagingService({ customerId: 'cust-1' });
      expect(await isThreadParticipant('cust-1', 't1', customerThread)).toBe(true);

      const recipientThread = buildMessagingService({ recipientId: 'recip-1' });
      expect(await isThreadParticipant('recip-1', 't1', recipientThread)).toBe(true);

      const supplierThread = buildMessagingService({ supplierId: 'sup-1' });
      expect(await isThreadParticipant('sup-1', 't1', supplierThread)).toBe(true);
    });

    it('returns false when the thread does not exist', async () => {
      const messagingService = buildMessagingService(null);
      expect(await isThreadParticipant('user-1', 'missing-thread', messagingService)).toBe(false);
    });

    it('fails closed when messagingService.getThread throws', async () => {
      const messagingService = {
        getThread: jest.fn(async () => {
          throw new Error('db down');
        }),
      };
      expect(await isThreadParticipant('user-1', 'thread-1', messagingService)).toBe(false);
    });
  });

  describe('prefetchedThread parameter (avoids a redundant getThread() call)', () => {
    it('uses the prefetched thread and never calls messagingService.getThread', async () => {
      const messagingService = buildMessagingService({ participants: [] });
      const prefetchedThread = { participants: ['user-1'] };

      const result = await isThreadParticipant(
        'user-1',
        'thread-1',
        messagingService,
        prefetchedThread
      );

      expect(result).toBe(true);
      expect(messagingService.getThread).not.toHaveBeenCalled();
    });

    it('returns false when the prefetched thread does not include the user', async () => {
      const messagingService = buildMessagingService({ participants: ['user-1'] });
      const prefetchedThread = { participants: ['user-2'] };

      const result = await isThreadParticipant(
        'user-1',
        'thread-1',
        messagingService,
        prefetchedThread
      );

      expect(result).toBe(false);
      expect(messagingService.getThread).not.toHaveBeenCalled();
    });

    it('treats an explicit null prefetchedThread as "thread not found" rather than fetching', async () => {
      const messagingService = buildMessagingService({ participants: ['user-1'] });

      const result = await isThreadParticipant('user-1', 'thread-1', messagingService, null);

      expect(result).toBe(false);
      expect(messagingService.getThread).not.toHaveBeenCalled();
    });
  });
});
