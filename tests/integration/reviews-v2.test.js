/**
 * Integration tests for review service
 */

'use strict';

const reviewService = require('../../services/reviewService');
const dbUnified = require('../../db-unified');

// Mock database
jest.mock('../../db-unified');

describe('Review Service Integration Tests', () => {
  let mockReviews;
  let mockUsers;
  let mockSuppliers;
  let mockThreads;

  beforeEach(() => {
    mockReviews = [];
    mockUsers = [
      {
        id: 'usr-1',
        name: 'John Doe',
        email: 'john@example.com',
        verified: true,
        createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
      },
    ];
    mockSuppliers = [
      {
        id: 'sup-1',
        name: 'Test Photographer',
        ownerUserId: 'usr-supplier',
      },
    ];
    mockThreads = [
      {
        id: 'thread-1',
        customerId: 'usr-1',
        supplierId: 'sup-1',
      },
    ];

    dbUnified.read.mockImplementation(async collection => {
      switch (collection) {
        case 'reviews':
          return [...mockReviews];
        case 'users':
          return [...mockUsers];
        case 'suppliers':
          return [...mockSuppliers];
        case 'threads':
          return [...mockThreads];
        default:
          return [];
      }
    });

    dbUnified.write.mockImplementation(async (collection, data) => {
      switch (collection) {
        case 'reviews':
          mockReviews = [...data];
          break;
      }
    });

    dbUnified.insertOne.mockImplementation(async (collection, doc) => {
      if (collection === 'reviews') {
        mockReviews.push(doc);
      }
    });

    dbUnified.updateOne.mockImplementation(async (collection, filter, update) => {
      if (collection === 'reviews') {
        const idx = mockReviews.findIndex(r => Object.keys(filter).every(k => r[k] === filter[k]));
        if (idx >= 0 && update.$set) {
          mockReviews[idx] = { ...mockReviews[idx], ...update.$set };
        }
      }
    });

    dbUnified.findOne.mockImplementation(async (collection, filter) => {
      if (collection === 'reviews') {
        return mockReviews.find(r => Object.keys(filter).every(k => r[k] === filter[k])) || null;
      }
      return null;
    });

    dbUnified.find.mockImplementation(async (collection, filter) => {
      const arr =
        collection === 'reviews'
          ? mockReviews
          : collection === 'users'
            ? typeof mockUsers !== 'undefined'
              ? mockUsers
              : []
            : collection === 'suppliers'
              ? typeof mockSuppliers !== 'undefined'
                ? mockSuppliers
                : []
              : [];
      if (typeof filter === 'function') {
        return arr.filter(filter);
      }
      return arr.filter(item =>
        Object.keys(filter).every(k => {
          const val = filter[k];
          if (val && typeof val === 'object' && val.$ne !== undefined) {
            return item[k] !== val.$ne;
          }
          if (val && typeof val === 'object' && val.$in !== undefined) {
            return Array.isArray(val.$in) && val.$in.includes(item[k]);
          }
          return item[k] === val;
        })
      );
    });

    // Mock uid to return predictable IDs
    jest.spyOn(require('../../store'), 'uid').mockReturnValue('rev-test-123');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkReviewEligibility', () => {
    it('should allow eligible user to review', async () => {
      const result = await reviewService.checkReviewEligibility('usr-1', 'sup-1');

      expect(result.eligible).toBe(true);
      expect(result.bookingVerified).toBe(true); // Has thread with supplier
    });

    it('should prevent duplicate reviews within cooldown period', async () => {
      // Add existing review
      mockReviews.push({
        _id: 'rev-1',
        authorId: 'usr-1',
        supplierId: 'sup-1',
        rating: 5,
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        moderation: { state: 'approved' },
      });

      const result = await reviewService.checkReviewEligibility('usr-1', 'sup-1');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('already reviewed');
    });

    it('should enforce rate limiting', async () => {
      // Add 5 recent reviews from same user (different suppliers)
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        mockReviews.push({
          _id: `rev-${i}`,
          authorId: 'usr-1',
          supplierId: `sup-${i}`,
          rating: 5,
          createdAt: new Date(now - 10 * 60 * 1000).toISOString(), // 10 minutes ago
          moderation: { state: 'approved' },
        });
      }

      const result = await reviewService.checkReviewEligibility('usr-1', 'sup-new');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('too many reviews');
    });
  });

  describe('createReview', () => {
    it('should create a verified review with positive sentiment', async () => {
      const reviewData = {
        supplierId: 'sup-1',
        bookingId: 'booking-1',
        rating: 5,
        title: 'Amazing photographer!',
        text: 'We had an excellent experience with this professional photographer. The photos were beautiful and captured our special day perfectly. Highly recommended!',
        eventDetails: {
          date: '2024-01-10',
          type: 'wedding',
        },
      };

      const result = await reviewService.createReview(reviewData, 'usr-1', {
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });

      expect(result.reviewId).toBe('rev-test-123');
      expect(result.status).toBe('approved'); // Auto-approved
      expect(result.sentiment.label).toBe('positive');
      expect(mockReviews.length).toBe(1);

      const savedReview = mockReviews[0];
      expect(savedReview.verification.status).toBe('verified_booking');
      expect(savedReview.moderation.state).toBe('approved');
      expect(savedReview.moderation.autoApproved).toBe(true);
    });

    it('should flag spam reviews for moderation', async () => {
      const reviewData = {
        supplierId: 'sup-1',
        rating: 5,
        title: 'CHECK OUT OUR WEBSITE',
        text: 'Visit https://spam.com for amazing deals! Call now at 555-1234 for more info!!!',
      };

      const result = await reviewService.createReview(reviewData, 'usr-1');

      expect(result.status).toBe('pending');
      expect(result.message).toContain('pending moderation');

      const savedReview = mockReviews[0];
      expect(savedReview.moderation.state).toBe('pending');
      expect(savedReview.sentiment.spamScore).toBeGreaterThan(0.5);
    });

    it('should flag negative reviews for moderation', async () => {
      const reviewData = {
        supplierId: 'sup-1',
        rating: 1,
        title: 'Terrible experience',
        text: 'Awful service, terrible quality, very disappointing. Would not recommend to anyone.',
      };

      const result = await reviewService.createReview(reviewData, 'usr-1');

      expect(result.status).toBe('pending');

      const savedReview = mockReviews[0];
      expect(savedReview.sentiment.label).toBe('negative');
      expect(savedReview.moderation.state).toBe('pending');
    });

    it('should reject invalid review data', async () => {
      const reviewData = {
        supplierId: 'sup-1',
        rating: 10, // Invalid rating
        text: 'Too short', // Too short
      };

      await expect(reviewService.createReview(reviewData, 'usr-1')).rejects.toThrow(
        'Validation failed'
      );
    });
  });

  describe('moderateReview', () => {
    beforeEach(() => {
      mockReviews.push({
        _id: 'rev-1',
        authorId: 'usr-1',
        supplierId: 'sup-1',
        rating: 4,
        title: 'Good service',
        text: 'The photographer did a good job overall.',
        moderation: {
          state: 'pending',
          autoApproved: false,
          previousStates: [],
        },
        votes: { helpful: 0, unhelpful: 0, voters: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    it('should approve a review', async () => {
      const review = await reviewService.moderateReview(
        'rev-1',
        'approve',
        'admin-1',
        'Looks good'
      );

      expect(review.moderation.state).toBe('approved');
      expect(review.moderation.moderatorId).toBe('admin-1');
      expect(review.moderation.reason).toBe('Looks good');
    });

    it('should reject a review', async () => {
      const review = await reviewService.moderateReview(
        'rev-1',
        'reject',
        'admin-1',
        'Contains spam'
      );

      expect(review.moderation.state).toBe('rejected');
      expect(review.moderation.reason).toBe('Contains spam');
    });

    it('should throw error for non-existent review', async () => {
      await expect(
        reviewService.moderateReview('rev-nonexistent', 'approve', 'admin-1', 'test')
      ).rejects.toThrow('Review not found');
    });
  });

  describe('addSupplierResponse', () => {
    beforeEach(() => {
      mockReviews.push({
        _id: 'rev-1',
        authorId: 'usr-1',
        supplierId: 'sup-1',
        rating: 5,
        title: 'Great service',
        text: 'Very happy with the photographer',
        moderation: { state: 'approved' },
        response: null,
        votes: { helpful: 0, unhelpful: 0, voters: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    it('should add supplier response', async () => {
      const review = await reviewService.addSupplierResponse(
        'rev-1',
        'sup-1',
        'Thank you so much for the kind words! It was a pleasure working with you.',
        'usr-supplier'
      );

      expect(review.response).toBeDefined();
      expect(review.response.text).toContain('Thank you');
      expect(review.response.supplierId).toBe('sup-1');
    });

    it('should reject short responses', async () => {
      await expect(
        reviewService.addSupplierResponse('rev-1', 'sup-1', 'Thanks', 'usr-supplier')
      ).rejects.toThrow('at least 10 characters');
    });

    it('should reject long responses', async () => {
      const longText = 'a'.repeat(2001);

      await expect(
        reviewService.addSupplierResponse('rev-1', 'sup-1', longText, 'usr-supplier')
      ).rejects.toThrow('cannot exceed 2000 characters');
    });
  });

  describe('voteOnReview', () => {
    beforeEach(() => {
      mockReviews.push({
        _id: 'rev-1',
        authorId: 'usr-1',
        supplierId: 'sup-1',
        rating: 5,
        moderation: { state: 'approved' },
        votes: {
          helpful: 0,
          unhelpful: 0,
          voters: [],
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    it('should record helpful vote', async () => {
      const review = await reviewService.voteOnReview('rev-1', 'usr-2', true);

      expect(review.votes.helpful).toBe(1);
      expect(review.votes.voters).toContain('usr-2');
    });

    it('should record unhelpful vote', async () => {
      const review = await reviewService.voteOnReview('rev-1', 'usr-2', false);

      expect(review.votes.unhelpful).toBe(1);
      expect(review.votes.voters).toContain('usr-2');
    });

    it('should prevent duplicate votes', async () => {
      await reviewService.voteOnReview('rev-1', 'usr-2', true);

      await expect(reviewService.voteOnReview('rev-1', 'usr-2', false)).rejects.toThrow(
        'already voted'
      );
    });
  });

  describe('fileDispute', () => {
    beforeEach(() => {
      mockReviews.push({
        _id: 'rev-1',
        authorId: 'usr-1',
        supplierId: 'sup-1',
        rating: 2,
        moderation: { state: 'approved' },
        dispute: null,
        votes: { helpful: 0, unhelpful: 0, voters: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

    it('should file a dispute', async () => {
      const result = await reviewService.fileDispute(
        'rev-1',
        'usr-supplier',
        'This review contains false information about our services.',
        'Evidence: booking confirmation shows different details'
      );

      expect(result.disputeId).toBe('rev-1');
      expect(result.status).toBe('disputed');

      const review = mockReviews[0];
      expect(review.dispute.filed).toBe(true);
      expect(review.dispute.filedBy).toBe('usr-supplier');
      expect(review.moderation.state).toBe('disputed');
    });

    it('should prevent duplicate disputes', async () => {
      await reviewService.fileDispute(
        'rev-1',
        'usr-supplier',
        'This review contains false information',
        'evidence'
      );

      await expect(
        reviewService.fileDispute('rev-1', 'usr-supplier', 'Another dispute', 'more evidence')
      ).rejects.toThrow('already been filed');
    });
  });

  describe('getSupplierReviews', () => {
    beforeEach(() => {
      // Add multiple reviews
      for (let i = 0; i < 15; i++) {
        mockReviews.push({
          _id: `rev-${i}`,
          authorId: 'usr-1',
          supplierId: 'sup-1',
          rating: 4 + (i % 2),
          title: `Review ${i}`,
          text: 'Good service',
          moderation: { state: 'approved' },
          votes: { helpful: i, unhelpful: 0, voters: [] },
          verification: {
            status: i % 3 === 0 ? 'verified_booking' : 'unverified',
          },
          sentiment: { score: 0.5 },
          createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    it('should return paginated reviews', async () => {
      const result = await reviewService.getSupplierReviews('sup-1', {
        page: 1,
        limit: 10,
      });

      expect(result.reviews.length).toBe(10);
      expect(result.pagination.total).toBe(15);
      expect(result.pagination.pages).toBe(2);
    });

    it('should sort by recent', async () => {
      const result = await reviewService.getSupplierReviews('sup-1', {
        sortBy: 'recent',
      });

      // First review should be most recent (smallest i)
      expect(result.reviews[0]._id).toBe('rev-0');
    });

    it('should sort by helpful votes', async () => {
      const result = await reviewService.getSupplierReviews('sup-1', {
        sortBy: 'helpful',
      });

      // First review should have most helpful votes
      expect(result.reviews[0].votes.helpful).toBeGreaterThanOrEqual(
        result.reviews[1].votes.helpful
      );
    });

    it('should filter verified reviews', async () => {
      const result = await reviewService.getSupplierReviews('sup-1', {
        filter: 'verified',
      });

      result.reviews.forEach(review => {
        expect(review.verification.status).not.toBe('unverified');
      });
    });
  });

  describe('getSupplierAnalytics', () => {
    beforeEach(() => {
      // Add sample reviews with varying ratings and sentiment
      mockReviews.push(
        {
          _id: 'rev-1',
          supplierId: 'sup-1',
          rating: 5,
          sentiment: { score: 0.8, keywords: [{ word: 'excellent', sentiment: 0.95 }] },
          moderation: { state: 'approved' },
          response: { respondedAt: new Date().toISOString() },
          verification: { status: 'verified_booking' },
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          _id: 'rev-2',
          supplierId: 'sup-1',
          rating: 4,
          sentiment: { score: 0.6, keywords: [{ word: 'good', sentiment: 0.6 }] },
          moderation: { state: 'approved' },
          response: null,
          verification: { status: 'unverified' },
          createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        }
      );
    });

    it('should calculate analytics correctly', async () => {
      const analytics = await reviewService.getSupplierAnalytics('sup-1');

      expect(analytics.metrics.totalReviews).toBe(2);
      expect(analytics.metrics.averageRating).toBe(4.5);
      expect(analytics.metrics.verifiedReviews).toBe(1);
      expect(analytics.sentiment).toBeDefined();
      expect(analytics.response.responseRate).toBe(0.5);
    });
  });
});
