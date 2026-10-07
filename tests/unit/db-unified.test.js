/**
 * Unit tests for database unified layer status caching
 */

describe('Database Unified - Status Caching', () => {
  // Mock the dependencies
  let dbUnified;
  let mockDb;
  let mockStore;

  beforeEach(() => {
    // Clear the module cache to reset state between tests
    jest.resetModules();

    // Mock the dependencies
    mockDb = {
      isMongoAvailable: jest.fn(() => false),
      connect: jest.fn(),
    };
    mockStore = {
      uid: jest.fn(prefix => `${prefix}_test_123`),
    };

    // Mock the required modules
    jest.mock('../../db', () => mockDb);
    jest.mock('../../store', () => mockStore);

    // Require the module under test after mocking
    dbUnified = require('../../db-unified');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDatabaseStatus', () => {
    it('should return not_started state before initialization', () => {
      const status = dbUnified.getDatabaseStatus();

      expect(status).toBeDefined();
      expect(status.state).toBe('not_started');
      expect(status.type).toBe('unknown');
      expect(status.connected).toBe(false);
      expect(status.error).toBeNull();
    });

    it('should return completed state after successful initialization', async () => {
      // Initialize the database (will use local fallback)
      await dbUnified.initializeDatabase();

      const status = dbUnified.getDatabaseStatus();

      expect(status.state).toBe('completed');
      expect(status.type).toBe('local');
      expect(status.connected).toBe(true);
      expect(status.error).toBeNull();
    });

    it('should return same status on multiple calls without re-initializing', async () => {
      // Initialize once
      await dbUnified.initializeDatabase();

      // Get status multiple times
      const status1 = dbUnified.getDatabaseStatus();
      const status2 = dbUnified.getDatabaseStatus();
      const status3 = dbUnified.getDatabaseStatus();

      // All should be identical
      expect(status1).toEqual(status2);
      expect(status2).toEqual(status3);

      // All should show completed/connected state
      expect(status1.state).toBe('completed');
      expect(status1.connected).toBe(true);
      expect(status2.state).toBe('completed');
      expect(status2.connected).toBe(true);
      expect(status3.state).toBe('completed');
      expect(status3.connected).toBe(true);
    });

    it('should cache the database type correctly', async () => {
      await dbUnified.initializeDatabase();

      const status = dbUnified.getDatabaseStatus();
      const type = dbUnified.getDatabaseType();

      expect(status.type).toBe(type);
      expect(status.type).toBe('local');
    });
  });

  describe('initializeDatabase caching', () => {
    it('should only initialize once on multiple calls', async () => {
      // Call initialize multiple times
      const result1 = await dbUnified.initializeDatabase();
      const result2 = await dbUnified.initializeDatabase();
      const result3 = await dbUnified.initializeDatabase();

      // All should return the same type
      expect(result1).toBe('local');
      expect(result2).toBe('local');
      expect(result3).toBe('local');

      // Status should show completed state
      const status = dbUnified.getDatabaseStatus();
      expect(status.state).toBe('completed');
      expect(status.connected).toBe(true);
    });
  });
});

describe('Database Unified - read fallback counter', () => {
  const loadWithMongo = readError => {
    jest.resetModules();
    const collection = {
      createIndex: jest.fn(async () => undefined),
      find: jest.fn(() => ({
        toArray: readError
          ? jest.fn(async () => Promise.reject(readError))
          : jest.fn(async () => []),
      })),
    };
    jest.doMock('../../db', () => ({
      isMongoAvailable: () => true,
      connect: jest.fn(async () => ({ collection: () => collection })),
    }));
    jest.doMock('../../store', () => ({ read: jest.fn(() => []), uid: jest.fn() }));
    return require('../../db-unified');
  };

  it('counts reads that failed against MongoDB and were served from local storage', async () => {
    const dbUnified = loadWithMongo(new Error('connection lost'));
    expect(dbUnified.getReadFallbackCount()).toBe(0);
    await dbUnified.read('suppliers');
    // The status still describes the initialised backend...
    expect(dbUnified.getDatabaseStatus()).toMatchObject({ type: 'mongodb', connected: true });
    // ...so the counter is what reveals the fallback.
    expect(dbUnified.getReadFallbackCount()).toBe(1);
  });

  it('does not count successful MongoDB reads', async () => {
    const dbUnified = loadWithMongo(null);
    await dbUnified.read('suppliers');
    expect(dbUnified.getReadFallbackCount()).toBe(0);
  });
});
