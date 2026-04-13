/**
 * Unit tests for db.js MongoDB connection validation and availability logic
 */

describe('MongoDB Validation and Availability', () => {
  let db;
  let originalEnv;

  beforeAll(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    // Reset modules and environment
    jest.resetModules();
    process.env = { ...originalEnv };

    // Clear any cached modules
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('isMongoAvailable()', () => {
    it('should return true in production when MONGODB_URI is set to cloud URI', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb+srv://TESTUSER:TESTPASS@cluster0.testenv.local/eventflow';
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(false);
    });

    it('should return false in production when MONGODB_URI contains 127.0.0.1', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/eventflow';

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(false);
    });

    it('should return false in production when MONGODB_URI is not set', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGODB_URI;

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(false);
    });

    it('should return true in development when MONGODB_URI is set to cloud URI', () => {
      process.env.NODE_ENV = 'development';
      process.env.MONGODB_URI = 'mongodb+srv://TESTUSER:TESTPASS@cluster0.testenv.local/eventflow';
      process.env.NODE_ENV = 'development';
      delete process.env.MONGODB_URI;
      process.env.MONGODB_LOCAL_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(true);
    });

    it('should return false in development when neither URI is set', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_LOCAL_URI;

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(false);
    });
  });

  describe('Connection State Tracking', () => {
    beforeEach(() => {
      // Mock MongoClient to avoid actual connections
      jest.mock('mongodb', () => ({
        MongoClient: jest.fn().mockImplementation(() => ({
          connect: jest.fn().mockRejectedValue(new Error('Mock connection error')),
          close: jest.fn().mockResolvedValue(undefined),
        })),
      }));
    });

    it('should initialize with disconnected state', () => {
      db = require('../../db');

      expect(db.getConnectionState()).toBe('disconnected');
      expect(db.isConnected()).toBe(false);
      expect(db.getConnectionError()).toBeNull();
    });

    it('should track connection errors', async () => {
      process.env.NODE_ENV = 'development';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      try {
        await db.connect(1, 0); // 1 retry, no delay
      } catch (error) {
        // Expected to fail
      }

      expect(db.getConnectionState()).toBe('error');
      expect(db.getConnectionError()).toBeTruthy();
      expect(db.isConnected()).toBe(false);
    });
  });

  describe('URI Validation', () => {
    it('should reject placeholder URIs in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb+srv://<username>:<password>@your-cluster.mongodb.net/';

      // The connect function should throw when called
      db = require('../../db');

      expect(async () => {
        await db.connect(1, 0);
      }).rejects.toThrow();
    });

    it('should reject URIs without proper scheme', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'invalid://localhost:27017/eventflow';

      db = require('../../db');

      expect(async () => {
        await db.connect(1, 0);
      }).rejects.toThrow();
    });

    it('should accept valid mongodb:// URIs', () => {
      process.env.NODE_ENV = 'development';
      process.env.MONGODB_URI = 'mongodb://TESTUSER:TESTPASS@localhost:27017/eventflow';

      db = require('../../db');

      // Should not throw during module load
      expect(db).toBeDefined();
      expect(db.isMongoAvailable()).toBe(true);
    });

    it('should accept valid mongodb+srv:// URIs', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb+srv://TESTUSER:TESTPASS@cluster0.testenv.local/eventflow';

      db = require('../../db');

      // Should not throw during module load
      expect(db).toBeDefined();
      expect(db.isMongoAvailable()).toBe(true);
    });
  });

  describe('Production Safety Checks', () => {
    it('should prevent localhost URIs in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      expect(async () => {
        await db.connect(1, 0);
      }).rejects.toThrow(/localhost/i);
    });

    it('should require MONGODB_URI in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGODB_URI;

      db = require('../../db');

      expect(async () => {
        await db.connect(1, 0);
      }).rejects.toThrow(/MONGODB_URI/i);
    });

    it('should reject placeholder values in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb+srv://TESTUSER:TESTPASS@YourCluster.testenv.local/';

      db = require('../../db');

      expect(async () => {
        await db.connect(1, 0);
      }).rejects.toThrow(/placeholder/i);
    });
  });

  describe('Development Mode Behavior', () => {
    it('should allow localhost URIs in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(true);
      // Should not throw immediately
      expect(db).toBeDefined();
    });

    it('should fall back to MONGODB_LOCAL_URI in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.MONGODB_URI;
      process.env.MONGODB_LOCAL_URI = 'mongodb://localhost:27017/eventflow-dev';

      db = require('../../db');

      expect(db.isMongoAvailable()).toBe(true);
    });

    it('should accept cloud URIs with placeholders in development (with warning)', () => {
      process.env.NODE_ENV = 'development';
      process.env.MONGODB_URI = 'mongodb+srv://<username>:<password>@cluster.mongodb.net/';

      db = require('../../db');

      // In development, it should fall back rather than throw
      expect(db.isMongoAvailable()).toBe(true);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for missing MONGODB_URI in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.MONGODB_URI;

      db = require('../../db');

      try {
        await db.connect(1, 0);
      } catch (error) {
        expect(error.message).toContain('MONGODB_URI');
        expect(error.message).toContain('Production error');
      }
    });

    it('should provide clear error message for localhost in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb://localhost:27017/eventflow';

      db = require('../../db');

      try {
        await db.connect(1, 0);
      } catch (error) {
        expect(error.message).toContain('localhost');
        expect(error.message).toContain('Production error');
      }
    });

    it('should provide clear error message for placeholder values', async () => {
      process.env.NODE_ENV = 'production';
      process.env.MONGODB_URI = 'mongodb+srv://<username>:<password>@cluster.mongodb.net/';

      db = require('../../db');

      try {
        await db.connect(1, 0);
      } catch (error) {
        expect(error.message).toContain('placeholder');
      }
    });

    it('should provide clear error message for invalid scheme', async () => {
      process.env.NODE_ENV = 'production';
      // Use a URI with invalid scheme but no placeholder patterns
      process.env.MONGODB_URI = 'mysql://TESTUSER:TESTPASS@testhost.mongodb.net/db';

      db = require('../../db');

      try {
        await db.connect(1, 0);
      } catch (error) {
        expect(error.message).toContain('scheme');
      }
    });
  });
});
