/**
 * V1 Thread Compatibility Tests
 * Tests for helper methods that handle both v1 and v2 thread formats
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { ObjectId } = require('mongodb');

const messagingServicePath = path.join(process.cwd(), 'services/messagingService.js');
const _messagingServiceExists = fs.existsSync(messagingServicePath);

// eslint-disable-next-line node/no-missing-require
const MessagingService = _messagingServiceExists
  ? require('../../services/messagingService')
  : null;

// Mock database
const mockDb = {
  collection: () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    insertOne: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    countDocuments: jest.fn(),
  }),
};

(_messagingServiceExists ? describe : describe.skip)(
  'V1 Thread Compatibility - MessagingService Helper Methods',
  () => {
    let messagingService;

    beforeEach(() => {
      messagingService = new MessagingService(mockDb);
    });

    describe('isParticipant', () => {
      it('should return true for v2 thread when user is in participants array', () => {
        const thread = {
          _id: new ObjectId(),
          participants: ['user1', 'user2'],
        };
        expect(messagingService.isParticipant(thread, 'user1')).toBe(true);
        expect(messagingService.isParticipant(thread, 'user2')).toBe(true);
      });

      it('should return false for v2 thread when user is not in participants array', () => {
        const thread = {
          _id: new ObjectId(),
          participants: ['user1', 'user2'],
        };
        expect(messagingService.isParticipant(thread, 'user3')).toBe(false);
      });

      it('should return true for v1 thread when user is customerId', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'supplier1',
        };
        expect(messagingService.isParticipant(thread, 'customer1')).toBe(true);
      });

      it('should return true for v1 thread when user is supplierId', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'supplier1',
        };
        expect(messagingService.isParticipant(thread, 'supplier1')).toBe(true);
      });

      it('should return true for v1 thread when user is recipientId', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'recipient1',
        };
        expect(messagingService.isParticipant(thread, 'recipient1')).toBe(true);
      });

      it('should return false for v1 thread when user is not a participant', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'supplier1',
        };
        expect(messagingService.isParticipant(thread, 'user3')).toBe(false);
      });

      it('should return false when thread is null', () => {
        expect(messagingService.isParticipant(null, 'user1')).toBe(false);
      });

      it('should return false when userId is null', () => {
        const thread = {
          participants: ['user1', 'user2'],
        };
        expect(messagingService.isParticipant(thread, null)).toBe(false);
      });
    });

    describe('getParticipantIds', () => {
      it('should return participants array for v2 thread', () => {
        const thread = {
          _id: new ObjectId(),
          participants: ['user1', 'user2', 'user3'],
        };
        const result = messagingService.getParticipantIds(thread);
        expect(result).toEqual(['user1', 'user2', 'user3']);
      });

      it('should return array of customerId and supplierId for v1 thread', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
        };
        const result = messagingService.getParticipantIds(thread);
        expect(result).toContain('customer1');
        expect(result).toContain('supplier1');
        expect(result).toHaveLength(2);
      });

      it('should include recipientId for v1 thread if different from supplierId', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'recipient1',
        };
        const result = messagingService.getParticipantIds(thread);
        expect(result).toContain('customer1');
        expect(result).toContain('supplier1');
        expect(result).toContain('recipient1');
        expect(result).toHaveLength(3);
      });

      it('should not duplicate recipientId if same as supplierId', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          supplierId: 'supplier1',
          recipientId: 'supplier1',
        };
        const result = messagingService.getParticipantIds(thread);
        expect(result).toContain('customer1');
        expect(result).toContain('supplier1');
        expect(result).toHaveLength(2);
      });

      it('should return empty array when thread is null', () => {
        const result = messagingService.getParticipantIds(null);
        expect(result).toEqual([]);
      });

      it('should return array with only available v1 fields', () => {
        const thread = {
          id: 'thd_abc123',
          customerId: 'customer1',
          // supplierId missing
        };
        const result = messagingService.getParticipantIds(thread);
        expect(result).toEqual(['customer1']);
      });
    });

    describe('Integration scenarios', () => {
      it('should handle v1 thread without participants array', () => {
        const v1Thread = {
          id: 'thd_rm06tio9p54y0d',
          customerId: 'cust_001',
          supplierId: 'supp_001',
          recipientId: 'supp_001',
          supplierName: 'Supplier Co',
          customerName: 'Customer Inc',
          subject: 'Test Subject',
        };

        // Test isParticipant
        expect(messagingService.isParticipant(v1Thread, 'cust_001')).toBe(true);
        expect(messagingService.isParticipant(v1Thread, 'supp_001')).toBe(true);
        expect(messagingService.isParticipant(v1Thread, 'other_user')).toBe(false);

        // Test getParticipantIds
        const participants = messagingService.getParticipantIds(v1Thread);
        expect(participants).toContain('cust_001');
        expect(participants).toContain('supp_001');
        expect(participants).toHaveLength(2);
      });

      it('should handle v2 thread with participants array', () => {
        const v2Thread = {
          _id: new ObjectId(),
          participants: ['user_a', 'user_b'],
          metadata: {
            createdBy: 'user_a',
            otherPartyName: 'User B',
          },
        };

        // Test isParticipant
        expect(messagingService.isParticipant(v2Thread, 'user_a')).toBe(true);
        expect(messagingService.isParticipant(v2Thread, 'user_b')).toBe(true);
        expect(messagingService.isParticipant(v2Thread, 'user_c')).toBe(false);

        // Test getParticipantIds
        const participants = messagingService.getParticipantIds(v2Thread);
        expect(participants).toEqual(['user_a', 'user_b']);
      });
    });
  }
);
