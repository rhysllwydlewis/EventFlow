/**
 * Unit Tests for Messaging Bulk Operations (Phase 1)
 * Tests bulk delete, bulk mark read, flag, archive, and undo functionality
 */

'use strict';

const fs = require('fs');
const path = require('path');

const messagingServicePath = path.join(process.cwd(), 'services/messagingService.js');
const _messagingServiceExists = fs.existsSync(messagingServicePath);

/* eslint-disable node/no-missing-require */
const MessagingService = _messagingServiceExists
  ? require('../../services/messagingService')
  : null;
/* eslint-enable node/no-missing-require */
const { ObjectId } = require('mongodb');

(_messagingServiceExists ? describe : describe.skip)('MessagingService - Bulk Operations', () => {
  let messagingService;
  let mockDb;
  let mockMessagesCollection;
  let mockOperationsCollection;

  beforeEach(() => {
    // Mock collections
    mockMessagesCollection = {
      find: jest.fn(),
      updateMany: jest.fn(),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockOperationsCollection = {
      insertOne: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };

    // Mock session for transaction support
    const mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    // Mock database
    mockDb = {
      collection: jest.fn(name => {
        if (name === 'messages') {
          return mockMessagesCollection;
        }
        if (name === 'messageOperations') {
          return mockOperationsCollection;
        }
        return null;
      }),
      client: {
        startSession: jest.fn().mockReturnValue(mockSession),
      },
    };

    messagingService = new MessagingService(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('bulkDeleteMessages', () => {
    it('should soft delete multiple messages and create operation record', async () => {
      const messageIds = [
        new ObjectId().toString(),
        new ObjectId().toString(),
        new ObjectId().toString(),
      ];
      const userId = 'user123';
      const threadId = new ObjectId().toString();
      const reason = 'Test deletion';

      const mockMessages = [
        { _id: new ObjectId(), isStarred: false, isArchived: false, messageStatus: 'new' },
        { _id: new ObjectId(), isStarred: true, isArchived: false, messageStatus: 'new' },
        { _id: new ObjectId(), isStarred: false, isArchived: true, messageStatus: 'resolved' },
      ];

      mockMessagesCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(mockMessages),
      });

      mockMessagesCollection.updateMany.mockResolvedValue({
        modifiedCount: 3,
      });

      mockOperationsCollection.insertOne.mockResolvedValue({
        insertedId: new ObjectId(),
      });

      const result = await messagingService.bulkDeleteMessages(
        messageIds,
        userId,
        threadId,
        reason
      );

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.operationId).toBeDefined();
      expect(result.undoToken).toBeDefined();
      expect(result.undoExpiresAt).toBeDefined();

      // Verify security filters in query
      expect(mockMessagesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          threadId: threadId, // Security: Validate thread ownership
          deletedAt: null, // Security: Don't delete already deleted messages
        }),
        expect.anything() // session option
      );
      expect(mockMessagesCollection.updateMany).toHaveBeenCalled();
      expect(mockOperationsCollection.insertOne).toHaveBeenCalled();
    });

    it('should store previous state for undo functionality', async () => {
      const messageId = new ObjectId();
      const messageIds = [messageId.toString()];
      const userId = 'user123';
      const threadId = new ObjectId().toString();

      const mockMessage = {
        _id: messageId,
        isStarred: true,
        isArchived: false,
        messageStatus: 'waiting_response',
        deletedAt: null,
      };

      mockMessagesCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([mockMessage]),
      });

      mockMessagesCollection.updateMany.mockResolvedValue({
        modifiedCount: 1,
      });

      mockOperationsCollection.insertOne.mockImplementation(doc => {
        expect(doc.previousState).toBeDefined();
        expect(doc.previousState.messages).toHaveLength(1);
        expect(doc.previousState.messages[0].isStarred).toBe(true);
        expect(doc.previousState.messages[0].messageStatus).toBe('waiting_response');
        return Promise.resolve({ insertedId: new ObjectId() });
      });

      await messagingService.bulkDeleteMessages(messageIds, userId, threadId);
    });

    it('should reject deletion when message count mismatch (security check)', async () => {
      const messageIds = [
        new ObjectId().toString(),
        new ObjectId().toString(),
        new ObjectId().toString(),
      ];
      const userId = 'user123';
      const threadId = new ObjectId().toString();

      // Return fewer messages than requested (some don't belong to thread or user)
      mockMessagesCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: new ObjectId(), isStarred: false }]),
      });

      await expect(
        messagingService.bulkDeleteMessages(messageIds, userId, threadId)
      ).rejects.toThrow("Some messages not found or don't belong to thread");
    });
  });

  describe('bulkMarkRead', () => {
    it('should mark multiple messages as read', async () => {
      const messageIds = [new ObjectId().toString(), new ObjectId().toString()];
      const userId = 'user123';

      mockMessagesCollection.updateMany.mockResolvedValue({
        modifiedCount: 2,
      });

      const result = await messagingService.bulkMarkRead(messageIds, userId, true);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      // Verify security filters in query
      expect(mockMessagesCollection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          recipientIds: userId, // Security: User must be recipient
          deletedAt: null, // Security: Don't modify deleted messages
        }),
        expect.objectContaining({
          $addToSet: expect.any(Object),
          $set: expect.objectContaining({
            status: 'read',
            lastActionedBy: userId,
          }),
        }),
        expect.anything() // session option
      );
    });

    it('should mark multiple messages as unread', async () => {
      const messageIds = [new ObjectId().toString(), new ObjectId().toString()];
      const userId = 'user123';

      mockMessagesCollection.updateMany.mockResolvedValue({
        modifiedCount: 2,
      });

      const result = await messagingService.bulkMarkRead(messageIds, userId, false);

      expect(result.success).toBe(true);
      expect(result.updatedCount).toBe(2);
      expect(mockMessagesCollection.updateMany).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $pull: expect.any(Object),
          $set: expect.objectContaining({
            status: 'delivered',
            lastActionedBy: userId,
          }),
        }),
        expect.anything() // session option
      );
    });
  });

  describe('flagMessage', () => {
    it('should flag a message', async () => {
      const messageId = new ObjectId().toString();
      const userId = 'user123';

      const mockMessage = {
        _id: new ObjectId(),
        isStarred: true,
      };

      mockMessagesCollection.findOneAndUpdate.mockResolvedValue({
        value: mockMessage,
      });

      const result = await messagingService.flagMessage(messageId, userId, true);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(mockMessagesCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            isStarred: true,
            lastActionedBy: userId,
          }),
        }),
        expect.any(Object)
      );
    });

    it('should unflag a message', async () => {
      const messageId = new ObjectId().toString();
      const userId = 'user123';

      mockMessagesCollection.findOneAndUpdate.mockResolvedValue({
        value: { _id: new ObjectId(), isStarred: false },
      });

      const result = await messagingService.flagMessage(messageId, userId, false);

      expect(result.success).toBe(true);
      expect(mockMessagesCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            isStarred: false,
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('archiveMessage', () => {
    it('should archive a message', async () => {
      const messageId = new ObjectId().toString();
      const userId = 'user123';

      mockMessagesCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          _id: new ObjectId(),
          isArchived: true,
          archivedAt: new Date(),
        },
      });

      const result = await messagingService.archiveMessage(messageId, userId, 'archive');

      expect(result.success).toBe(true);
      expect(mockMessagesCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            isArchived: true,
            lastActionedBy: userId,
          }),
        }),
        expect.any(Object)
      );
    });

    it('should restore an archived message', async () => {
      const messageId = new ObjectId().toString();
      const userId = 'user123';

      mockMessagesCollection.findOneAndUpdate.mockResolvedValue({
        value: {
          _id: new ObjectId(),
          isArchived: false,
          archivedAt: null,
        },
      });

      const result = await messagingService.archiveMessage(messageId, userId, 'restore');

      expect(result.success).toBe(true);
      expect(mockMessagesCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $set: expect.objectContaining({
            isArchived: false,
            archivedAt: null,
          }),
        }),
        expect.any(Object)
      );
    });
  });

  describe('undoOperation', () => {
    it('should undo a bulk delete operation', async () => {
      const operationId = 'op123';
      const undoToken = 'token456';
      const userId = 'user123';

      const mockOperation = {
        operationId,
        userId,
        undoToken,
        isUndone: false,
        undoExpiresAt: new Date(Date.now() + 10000), // 10 seconds in future
        messageIds: ['msg1', 'msg2'],
        previousState: {
          messages: [
            {
              _id: new ObjectId(),
              isStarred: false,
              isArchived: false,
              messageStatus: 'new',
              deletedAt: null,
            },
            {
              _id: new ObjectId(),
              isStarred: true,
              isArchived: false,
              messageStatus: 'waiting_response',
              deletedAt: null,
            },
          ],
        },
      };

      mockOperationsCollection.findOne.mockResolvedValue(mockOperation);
      mockMessagesCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mockOperationsCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await messagingService.undoOperation(operationId, undoToken, userId);

      expect(result.success).toBe(true);
      expect(result.restoredCount).toBe(2);
      expect(mockMessagesCollection.updateOne).toHaveBeenCalledTimes(2);
      expect(mockOperationsCollection.updateOne).toHaveBeenCalledWith(
        { operationId },
        expect.objectContaining({
          $set: expect.objectContaining({
            isUndone: true,
          }),
        })
      );
    });

    it('should reject undo if operation not found', async () => {
      mockOperationsCollection.findOne.mockResolvedValue(null);

      const result = await messagingService.undoOperation('op123', 'token456', 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation not found or already undone');
    });

    it('should reject undo if window has expired', async () => {
      const mockOperation = {
        operationId: 'op123',
        userId: 'user123',
        undoToken: 'token456',
        isUndone: false,
        undoExpiresAt: new Date(Date.now() - 1000), // 1 second in past
      };

      mockOperationsCollection.findOne.mockResolvedValue(mockOperation);

      const result = await messagingService.undoOperation('op123', 'token456', 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Undo window has expired');
    });
  });

  describe('getMessagesWithFilters', () => {
    it('should fetch messages with sorting', async () => {
      const threadId = new ObjectId().toString();
      const options = {
        sortBy: 'date-asc',
        page: 1,
        pageSize: 50,
      };

      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      });

      mockMessagesCollection.countDocuments.mockResolvedValue(0);

      const result = await messagingService.getMessagesWithFilters(threadId, options);

      expect(result.messages).toBeDefined();
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
    });

    it('should apply read/unread filter', async () => {
      const threadId = new ObjectId().toString();
      const options = {
        filterBy: 'unread',
      };

      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      });

      mockMessagesCollection.countDocuments.mockResolvedValue(0);

      await messagingService.getMessagesWithFilters(threadId, options);

      expect(mockMessagesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'readBy.userId': { $exists: false },
        })
      );
    });

    it('should apply flagged filter', async () => {
      const threadId = new ObjectId().toString();
      const options = {
        filterBy: 'flagged',
      };

      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      });

      mockMessagesCollection.countDocuments.mockResolvedValue(0);

      await messagingService.getMessagesWithFilters(threadId, options);

      expect(mockMessagesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          isStarred: true,
        })
      );
    });

    it('should apply date range filter', async () => {
      const threadId = new ObjectId().toString();
      const dateFrom = '2024-01-01T00:00:00.000Z';
      const dateTo = '2024-12-31T23:59:59.999Z';
      const options = {
        dateFrom,
        dateTo,
      };

      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      });

      mockMessagesCollection.countDocuments.mockResolvedValue(0);

      await messagingService.getMessagesWithFilters(threadId, options);

      expect(mockMessagesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: expect.objectContaining({
            $gte: new Date(dateFrom),
            $lte: new Date(dateTo),
          }),
        })
      );
    });
  });
});
