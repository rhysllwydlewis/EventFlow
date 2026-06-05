/**
 * Integration tests for /api/supplier/reviews/stats endpoint
 * Tests review statistics calculation for supplier dashboard
 */

const request = require('supertest');
const express = require('express');

// Mock db-unified
jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    // Mock authenticated user - can be overridden in tests
    if (!req.user) {
      req.user = { id: 'test-user-123', role: 'supplier' };
    }
    next();
  },
  csrfProtection: (req, res, next) => next(),
}));

describe('Supplier Review Stats Endpoint', () => {
  let app;
  let dbUnified;
  let supplierRoutes;

  beforeAll(() => {
    // Set test environment
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    // Create a minimal Express app for testing
    app = express();
    app.use(express.json());

    // Get mocked modules
    dbUnified = require('../../db-unified');

    // Reset mocks
    jest.clearAllMocks();

    // Mount the supplier routes
    supplierRoutes = require('../../routes/supplier');
    app.use('/api/supplier', supplierRoutes);
  });

  describe('GET /api/supplier/reviews/stats', () => {
    it('should return review stats for authenticated supplier', async () => {
      // Mock data
      const mockSuppliers = [
        { id: 'supplier-1', ownerUserId: 'test-user-123', name: 'Test Supplier' },
      ];
      const mockReviews = [
        { id: 'review-1', supplierId: 'supplier-1', rating: 5, comment: 'Great!' },
        { id: 'review-2', supplierId: 'supplier-1', rating: 4, comment: 'Good' },
        { id: 'review-3', supplierId: 'supplier-1', rating: 5, comment: 'Excellent' },
        { id: 'review-4', supplierId: 'supplier-2', rating: 3, comment: 'Other supplier' },
      ];

      dbUnified.read.mockImplementation(collection => {
        if (collection === 'reviews') {
          return Promise.resolve(mockReviews);
        }
        return Promise.resolve([]);
      });
      dbUnified.find.mockImplementation(async (collection, filter) => {
        if (collection === 'reviews') {
          return mockReviews.filter(r => Object.keys(filter).every(k => r[k] === filter[k]));
        }
        return [];
      });
      dbUnified.findOne.mockImplementation(async (collection, filter) => {
        if (collection === 'suppliers') {
          return mockSuppliers.find(s => s.ownerUserId === filter.ownerUserId) || null;
        }
        return null;
      });

      const response = await request(app).get('/api/supplier/reviews/stats').expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('stats');
      expect(response.body.stats).toHaveProperty('totalReviews', 3);
      expect(response.body.stats).toHaveProperty('averageRating');
      expect(response.body.stats.averageRating).toBeCloseTo(4.67, 1);
      expect(response.body.stats).toHaveProperty('distribution');
      expect(response.body.stats.distribution).toEqual({
        5: 2,
        4: 1,
        3: 0,
        2: 0,
        1: 0,
      });
    });

    it('should return zero stats when supplier has no reviews', async () => {
      const mockSuppliers = [
        { id: 'supplier-1', ownerUserId: 'test-user-123', name: 'Test Supplier' },
      ];
      const mockReviews = [];

      dbUnified.read.mockImplementation(collection => {
        if (collection === 'reviews') {
          return Promise.resolve(mockReviews);
        }
        return Promise.resolve([]);
      });
      dbUnified.find.mockImplementation(async (collection, filter) => {
        if (collection === 'reviews') {
          return mockReviews.filter(r => Object.keys(filter).every(k => r[k] === filter[k]));
        }
        return [];
      });
      dbUnified.findOne.mockImplementation(async (collection, filter) => {
        if (collection === 'suppliers') {
          return mockSuppliers.find(s => s.ownerUserId === filter.ownerUserId) || null;
        }
        return null;
      });

      const response = await request(app).get('/api/supplier/reviews/stats').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.stats.totalReviews).toBe(0);
      expect(response.body.stats.averageRating).toBe(0);
      expect(response.body.stats.distribution).toEqual({
        5: 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
      });
    });

    it('should return 404 when supplier profile not found', async () => {
      const mockSuppliers = [
        { id: 'supplier-2', ownerUserId: 'different-user', name: 'Different Supplier' },
      ];

      // findOne({ ownerUserId }) won't match because ownerUserId is 'different-user'
      dbUnified.findOne.mockImplementation(async (collection, filter) => {
        if (collection === 'suppliers') {
          return mockSuppliers.find(s => s.ownerUserId === filter.ownerUserId) || null;
        }
        return null;
      });

      const response = await request(app).get('/api/supplier/reviews/stats').expect(404);

      expect(response.body).toHaveProperty('error', 'Supplier profile not found');
    });

    it('should return 403 when user is not a supplier', async () => {
      // Create a new app with custom middleware for this test
      const testApp = express();
      testApp.use(express.json());

      // Add custom auth middleware that sets user as customer
      testApp.use((req, res, next) => {
        req.user = { id: 'test-customer-123', role: 'customer' };
        next();
      });

      // Mount routes
      testApp.use('/api/supplier', supplierRoutes);

      const response = await request(testApp).get('/api/supplier/reviews/stats').expect(403);

      expect(response.body).toHaveProperty('error', 'Only suppliers can access review stats');
    });

    it('should handle database errors gracefully', async () => {
      dbUnified.findOne.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/supplier/reviews/stats').expect(500);

      expect(response.body).toHaveProperty('error', 'Failed to fetch review stats');
    });

    it('should handle null/undefined reviews collection', async () => {
      const mockSuppliers = [
        { id: 'supplier-1', ownerUserId: 'test-user-123', name: 'Test Supplier' },
      ];

      dbUnified.read.mockImplementation(collection => {
        if (collection === 'reviews') {
          return Promise.resolve(null);
        }
        return Promise.resolve([]);
      });
      dbUnified.findOne.mockImplementation(async (collection, filter) => {
        if (collection === 'suppliers') {
          return mockSuppliers.find(s => s.ownerUserId === filter.ownerUserId) || null;
        }
        return null;
      });

      const response = await request(app).get('/api/supplier/reviews/stats').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.stats.totalReviews).toBe(0);
    });

    it('should correctly calculate distribution with various ratings', async () => {
      const mockSuppliers = [
        { id: 'supplier-1', ownerUserId: 'test-user-123', name: 'Test Supplier' },
      ];
      const mockReviews = [
        { id: 'review-1', supplierId: 'supplier-1', rating: 5 },
        { id: 'review-2', supplierId: 'supplier-1', rating: 4 },
        { id: 'review-3', supplierId: 'supplier-1', rating: 3 },
        { id: 'review-4', supplierId: 'supplier-1', rating: 2 },
        { id: 'review-5', supplierId: 'supplier-1', rating: 1 },
        { id: 'review-6', supplierId: 'supplier-1', rating: 5 },
      ];

      dbUnified.read.mockImplementation(collection => {
        if (collection === 'reviews') {
          return Promise.resolve(mockReviews);
        }
        return Promise.resolve([]);
      });
      dbUnified.find.mockImplementation(async (collection, filter) => {
        if (collection === 'reviews') {
          return mockReviews.filter(r => Object.keys(filter).every(k => r[k] === filter[k]));
        }
        return [];
      });
      dbUnified.findOne.mockImplementation(async (collection, filter) => {
        if (collection === 'suppliers') {
          return mockSuppliers.find(s => s.ownerUserId === filter.ownerUserId) || null;
        }
        return null;
      });

      const response = await request(app).get('/api/supplier/reviews/stats').expect(200);

      expect(response.body.stats.distribution).toEqual({
        5: 2,
        4: 1,
        3: 1,
        2: 1,
        1: 1,
      });
      expect(response.body.stats.totalReviews).toBe(6);
    });
  });
});
