/**
 * Chat v5 Service Tests
 * Comprehensive unit tests for the chat v5 system
 */

'use strict';

const fs = require('fs');
const path = require('path');

const chatV5ServicePath = path.join(process.cwd(), 'services/chat-v5.service.js');
const _chatV5Exists = fs.existsSync(chatV5ServicePath);

// Conditional requires to avoid errors when legacy files have been deleted
// eslint-disable-next-line node/no-missing-require
const ChatV5Service = _chatV5Exists ? require('../../services/chat-v5.service') : null;
const {
  CONVERSATION_TYPES,
  MESSAGE_TYPES,
  CONVERSATION_STATUS,
  // eslint-disable-next-line node/no-missing-require
} = _chatV5Exists ? require('../../models/ChatMessage') : {};

// Valid 24-char hex ObjectId strings for use in mock data
// These must be valid hex strings so the service can call new ObjectId(id) safely.
const CONV_ID = '507f1f77bcf86cd799439011';
const EXISTING_CONV_ID = '507f1f77bcf86cd799439013';
const MSG_ID = '507f1f77bcf86cd799439012';
const MSG1_ID = '507f1f77bcf86cd799439014';
const MSG2_ID = '507f1f77bcf86cd799439015';
const CONV1_ID = '507f1f77bcf86cd799439016';
const CONV2_ID = '507f1f77bcf86cd799439017';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Mock database
let mockDb;
let mockConversationsCollection;
let mockMessagesCollection;
let chatService;

beforeEach(() => {
  // Reset mocks
  jest.clearAllMocks();

  // Mock collections
  mockConversationsCollection = {
    findOne: jest.fn(),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
      project: jest.fn().mockReturnThis(),
    }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: CONV_ID }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };

  mockMessagesCollection = {
    findOne: jest.fn(),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: MSG_ID }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };

  mockDb = {
    collection: jest.fn(name => {
      if (name === 'chat_conversations') {
        return mockConversationsCollection;
      }
      if (name === 'chat_messages') {
        return mockMessagesCollection;
      }
      throw new Error(`Unknown collection: ${name}`);
    }),
  };

  chatService = _chatV5Exists ? new ChatV5Service(mockDb, mockLogger) : null;
});

(_chatV5Exists ? describe : describe.skip)('ChatV5Service', () => {
  describe('createConversation', () => {
    it('should create a new conversation with valid data', async () => {
      const params = {
        type: CONVERSATION_TYPES.DIRECT,
        participants: [
          { userId: 'user1', displayName: 'User 1', avatar: null, role: 'customer' },
          { userId: 'user2', displayName: 'User 2', avatar: null, role: 'supplier' },
        ],
        context: null,
        metadata: {},
        userId: 'user1',
      };

      mockConversationsCollection.findOne.mockResolvedValue(null);

      const result = await chatService.createConversation(params);

      expect(result).toBeDefined();
      expect(result._id).toBe(CONV_ID);
      expect(mockConversationsCollection.insertOne).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should return existing conversation for duplicate direct messages', async () => {
      const params = {
        type: CONVERSATION_TYPES.DIRECT,
        participants: [
          { userId: 'user1', displayName: 'User 1', avatar: null, role: 'customer' },
          { userId: 'user2', displayName: 'User 2', avatar: null, role: 'supplier' },
        ],
        context: null,
        metadata: {},
        userId: 'user1',
      };

      const existingConv = { _id: EXISTING_CONV_ID, type: CONVERSATION_TYPES.DIRECT };
      mockConversationsCollection.findOne.mockResolvedValue(existingConv);

      const result = await chatService.createConversation(params);

      expect(result).toBe(existingConv);
      expect(mockConversationsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('should throw error for invalid conversation type', async () => {
      const params = {
        type: 'invalid_type',
        participants: [{ userId: 'user1', displayName: 'User 1', avatar: null, role: 'customer' }],
        userId: 'user1',
      };

      await expect(chatService.createConversation(params)).rejects.toThrow(
        'Invalid conversation type'
      );
    });

    it('should throw error for insufficient participants', async () => {
      const params = {
        type: CONVERSATION_TYPES.DIRECT,
        participants: [{ userId: 'user1', displayName: 'User 1', avatar: null, role: 'customer' }],
        userId: 'user1',
      };

      await expect(chatService.createConversation(params)).rejects.toThrow(
        'At least 2 participants are required'
      );
    });
  });

  describe('sendMessage', () => {
    it('should send a message in a valid conversation', async () => {
      const conversation = {
        _id: CONV_ID,
        participants: [
          { userId: 'user1', unreadCount: 0 },
          { userId: 'user2', unreadCount: 0 },
        ],
        status: CONVERSATION_STATUS.ACTIVE,
      };

      mockConversationsCollection.findOne.mockResolvedValue(conversation);

      const params = {
        conversationId: CONV_ID,
        senderId: 'user1',
        senderName: 'User 1',
        senderAvatar: null,
        content: 'Hello, world!',
        type: MESSAGE_TYPES.TEXT,
      };

      const result = await chatService.sendMessage(params);

      expect(result).toBeDefined();
      expect(result._id).toBe(MSG_ID);
      expect(mockMessagesCollection.insertOne).toHaveBeenCalled();
      expect(mockConversationsCollection.updateOne).toHaveBeenCalled();
      expect(mockConversationsCollection.updateMany).toHaveBeenCalled();
    });

    it('should throw error for non-existent conversation', async () => {
      mockConversationsCollection.findOne.mockResolvedValue(null);

      const params = {
        conversationId: '507f1f77bcf86cd799439099', // valid ObjectId that doesn't exist
        senderId: 'user1',
        senderName: 'User 1',
        content: 'Hello',
      };

      await expect(chatService.sendMessage(params)).rejects.toThrow('Conversation not found');
    });

    it('should sanitize message content', async () => {
      const conversation = {
        _id: CONV_ID,
        participants: [{ userId: 'user1' }],
        status: CONVERSATION_STATUS.ACTIVE,
      };

      mockConversationsCollection.findOne.mockResolvedValue(conversation);

      const params = {
        conversationId: CONV_ID,
        senderId: 'user1',
        senderName: 'User 1',
        content: '<script>alert("xss")</script>Hello',
        type: MESSAGE_TYPES.TEXT,
      };

      await chatService.sendMessage(params);

      // Verify that insertOne was called (content should be sanitized)
      expect(mockMessagesCollection.insertOne).toHaveBeenCalled();
      const insertedMessage = mockMessagesCollection.insertOne.mock.calls[0][0];
      expect(insertedMessage.content).not.toContain('<script>');
    });
  });

  describe('getMessages', () => {
    it('should retrieve messages for a conversation', async () => {
      const conversation = {
        _id: CONV_ID,
        participants: [{ userId: 'user1' }],
        status: CONVERSATION_STATUS.ACTIVE,
      };

      const messages = [
        { _id: MSG1_ID, content: 'Hello', createdAt: new Date() },
        { _id: MSG2_ID, content: 'Hi', createdAt: new Date() },
      ];

      mockConversationsCollection.findOne.mockResolvedValue(conversation);
      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(messages),
      });

      const result = await chatService.getMessages(CONV_ID, 'user1');

      expect(result.messages).toEqual(messages);
      expect(mockMessagesCollection.find).toHaveBeenCalled();
    });

    it('should throw error if user not in conversation', async () => {
      mockConversationsCollection.findOne.mockResolvedValue(null);

      await expect(chatService.getMessages(CONV_ID, 'user1')).rejects.toThrow(
        'Conversation not found'
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark conversation as read', async () => {
      mockMessagesCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ _id: MSG1_ID }]),
      });

      const result = await chatService.markAsRead(CONV_ID, 'user1');

      expect(result.success).toBe(true);
      expect(mockConversationsCollection.updateOne).toHaveBeenCalled();
      expect(mockMessagesCollection.updateMany).toHaveBeenCalled();
    });
  });

  describe('editMessage', () => {
    it('should edit a message within time limit', async () => {
      const message = {
        _id: MSG_ID,
        senderId: 'user1',
        content: 'Updated content',
        editedAt: new Date(),
      };

      mockMessagesCollection.findOne.mockResolvedValue(message);

      const result = await chatService.editMessage(MSG_ID, 'user1', 'Updated content');

      expect(result).toBeDefined();
      expect(mockMessagesCollection.updateOne).toHaveBeenCalled();
    });
  });

  describe('deleteMessage', () => {
    it('should soft delete a message', async () => {
      const result = await chatService.deleteMessage(MSG_ID, 'user1');

      expect(result.success).toBe(true);
      expect(mockMessagesCollection.updateOne).toHaveBeenCalled();
    });
  });

  describe('toggleReaction', () => {
    it('should add a reaction to a message', async () => {
      const message = {
        _id: MSG_ID,
        reactions: [],
      };

      mockMessagesCollection.findOne.mockResolvedValueOnce(message).mockResolvedValueOnce({
        ...message,
        reactions: [{ emoji: '👍', userId: 'user1', userName: 'User 1' }],
      });

      const result = await chatService.toggleReaction(MSG_ID, 'user1', 'User 1', '👍');

      expect(result).toBeDefined();
      expect(mockMessagesCollection.updateOne).toHaveBeenCalled();
    });

    it('should remove a reaction if already exists', async () => {
      const message = {
        _id: MSG_ID,
        reactions: [{ emoji: '👍', userId: 'user1', userName: 'User 1' }],
      };

      mockMessagesCollection.findOne.mockResolvedValueOnce(message).mockResolvedValueOnce({
        ...message,
        reactions: [],
      });

      const result = await chatService.toggleReaction(MSG_ID, 'user1', 'User 1', '👍');

      expect(result).toBeDefined();
      expect(mockMessagesCollection.updateOne).toHaveBeenCalled();
    });
  });

  describe('getUnreadCount', () => {
    it('should calculate total unread count for a user', async () => {
      const conversations = [
        {
          _id: CONV1_ID,
          participants: [{ userId: 'user1', unreadCount: 5, isMuted: false, isArchived: false }],
          status: CONVERSATION_STATUS.ACTIVE,
        },
        {
          _id: CONV2_ID,
          participants: [{ userId: 'user1', unreadCount: 3, isMuted: false, isArchived: false }],
          status: CONVERSATION_STATUS.ACTIVE,
        },
      ];

      mockConversationsCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(conversations),
      });

      const result = await chatService.getUnreadCount('user1');

      expect(result.unreadCount).toBe(8);
    });

    it('should exclude muted and archived conversations', async () => {
      const conversations = [
        {
          _id: CONV1_ID,
          participants: [{ userId: 'user1', unreadCount: 5, isMuted: true, isArchived: false }],
          status: CONVERSATION_STATUS.ACTIVE,
        },
        {
          _id: CONV2_ID,
          participants: [{ userId: 'user1', unreadCount: 3, isMuted: false, isArchived: true }],
          status: CONVERSATION_STATUS.ACTIVE,
        },
      ];

      mockConversationsCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(conversations),
      });

      const result = await chatService.getUnreadCount('user1');

      expect(result.unreadCount).toBe(0);
    });
  });

  describe('updateConversation', () => {
    it('should update conversation settings', async () => {
      const conversation = { _id: CONV_ID };
      mockConversationsCollection.findOne.mockResolvedValue(conversation);

      const result = await chatService.updateConversation(CONV_ID, 'user1', {
        isPinned: true,
        isMuted: false,
      });

      expect(result).toBeDefined();
      expect(mockConversationsCollection.updateOne).toHaveBeenCalled();
    });

    it('should throw error for invalid updates', async () => {
      await expect(
        chatService.updateConversation(CONV_ID, 'user1', {
          invalidField: true,
        })
      ).rejects.toThrow('No valid updates provided');
    });
  });

  describe('searchMessages', () => {
    it('should search messages across conversations', async () => {
      const conversations = [{ _id: CONV1_ID }, { _id: CONV2_ID }];

      const messages = [
        { _id: MSG1_ID, content: 'Hello world' },
        { _id: MSG2_ID, content: 'Hello there' },
      ];

      mockConversationsCollection.find.mockReturnValue({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(conversations),
      });

      mockMessagesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(messages),
      });

      const result = await chatService.searchMessages('user1', 'hello');

      expect(result.messages).toHaveLength(2);
    });
  });
});

(_chatV5Exists ? describe : describe.skip)('ChatMessage Model', () => {
  const {
    createConversation,
    createMessage,
    validateParticipant,
    isValidConversationType,
    isValidMessageType,
    // eslint-disable-next-line node/no-missing-require
  } = _chatV5Exists ? require('../../models/ChatMessage') : {};

  describe('createConversation', () => {
    it('should create a conversation document', () => {
      const conv = createConversation({
        type: CONVERSATION_TYPES.DIRECT,
        participants: [
          { userId: 'user1', displayName: 'User 1', avatar: null, role: 'customer' },
          { userId: 'user2', displayName: 'User 2', avatar: null, role: 'supplier' },
        ],
      });

      expect(conv.type).toBe(CONVERSATION_TYPES.DIRECT);
      expect(conv.participants).toHaveLength(2);
      expect(conv.status).toBe(CONVERSATION_STATUS.ACTIVE);
      expect(conv.messageCount).toBe(0);
    });
  });

  describe('createMessage', () => {
    it('should create a message document', () => {
      const msg = createMessage({
        conversationId: CONV_ID,
        senderId: 'user1',
        senderName: 'User 1',
        content: 'Hello',
        type: MESSAGE_TYPES.TEXT,
      });

      expect(msg.conversationId).toBe(CONV_ID);
      expect(msg.senderId).toBe('user1');
      expect(msg.content).toBe('Hello');
      expect(msg.type).toBe(MESSAGE_TYPES.TEXT);
      expect(msg.reactions).toHaveLength(0);
    });
  });

  describe('validateParticipant', () => {
    it('should validate valid participant', () => {
      const result = validateParticipant({
        userId: 'user1',
        displayName: 'User 1',
        role: 'customer',
      });

      expect(result.valid).toBe(true);
    });

    it('should reject participant without userId', () => {
      const result = validateParticipant({
        displayName: 'User 1',
        role: 'customer',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('userId');
    });

    it('should reject participant with invalid role', () => {
      const result = validateParticipant({
        userId: 'user1',
        displayName: 'User 1',
        role: 'invalid',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('role');
    });
  });

  describe('isValidConversationType', () => {
    it('should accept valid conversation types', () => {
      expect(isValidConversationType(CONVERSATION_TYPES.DIRECT)).toBe(true);
      expect(isValidConversationType(CONVERSATION_TYPES.MARKETPLACE)).toBe(true);
    });

    it('should reject invalid conversation types', () => {
      expect(isValidConversationType('invalid')).toBe(false);
    });
  });

  describe('isValidMessageType', () => {
    it('should accept valid message types', () => {
      expect(isValidMessageType(MESSAGE_TYPES.TEXT)).toBe(true);
      expect(isValidMessageType(MESSAGE_TYPES.IMAGE)).toBe(true);
    });

    it('should reject invalid message types', () => {
      expect(isValidMessageType('invalid')).toBe(false);
    });
  });
});
