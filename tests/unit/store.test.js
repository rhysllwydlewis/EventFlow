/**
 * Unit tests for store module
 */

const fs = require('fs');
const path = require('path');
const { read, write, uid, DATA_DIR } = require('../../store');

// Use a test data directory
const TEST_DATA_DIR = path.join(__dirname, '../test-data');

describe('Store Module', () => {
  beforeAll(() => {
    // Clean up test directory before tests
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up test directory after tests
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  });

  describe('uid', () => {
    it('should generate unique ID with default prefix', () => {
      const id1 = uid();
      const id2 = uid();

      expect(id1).toMatch(/^id_[a-z0-9]+$/);
      expect(id2).toMatch(/^id_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate unique ID with custom prefix', () => {
      const id1 = uid('user');
      const id2 = uid('user');

      expect(id1).toMatch(/^user_[a-z0-9]+$/);
      expect(id2).toMatch(/^user_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different prefixes', () => {
      const userId = uid('user');
      const packageId = uid('package');
      const supplierId = uid('supplier');

      expect(userId).toMatch(/^user_/);
      expect(packageId).toMatch(/^package_/);
      expect(supplierId).toMatch(/^supplier_/);
    });

    it('should generate IDs with sufficient length', () => {
      const id = uid();
      expect(id.length).toBeGreaterThan(10);
    });

    it('should generate unique IDs in rapid succession', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(uid('test'));
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('DATA_DIR', () => {
    it('should export DATA_DIR constant', () => {
      expect(DATA_DIR).toBeDefined();
      expect(typeof DATA_DIR).toBe('string');
      expect(DATA_DIR).toContain('data');
    });

    it('should point to valid path', () => {
      expect(path.isAbsolute(DATA_DIR) || DATA_DIR.includes('data')).toBe(true);
    });
  });

  describe('read and write (integration)', () => {
    // Note: These tests use actual collections defined in the store module
    // Tests will create/modify data in the test collections

    it('should write and read empty array', () => {
      write('search_history', []);
      const data = read('search_history');
      expect(Array.isArray(data)).toBe(true);
    });

    it('should write and read data array', () => {
      const testData = [
        { id: '1', name: 'Test Item 1' },
        { id: '2', name: 'Test Item 2' },
      ];

      write('search_history', testData);
      const data = read('search_history');

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].name).toBe('Test Item 1');
      expect(data[1].name).toBe('Test Item 2');
    });

    it('should handle complex objects', () => {
      const testData = [
        {
          id: uid('test'),
          name: 'Complex Object',
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
          },
          tags: ['tag1', 'tag2'],
        },
      ];

      write('search_history', testData);
      const data = read('search_history');

      expect(data[0].nested.array).toEqual([1, 2, 3]);
      expect(data[0].nested.object.key).toBe('value');
      expect(data[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('should overwrite existing data', () => {
      const initialData = [{ id: '1', value: 'initial' }];
      const updatedData = [{ id: '1', value: 'updated' }];

      write('search_history', initialData);
      write('search_history', updatedData);

      const data = read('search_history');
      expect(data[0].value).toBe('updated');
    });

    it('should read known collection', () => {
      const data = read('users');
      expect(Array.isArray(data)).toBe(true);
    });

    // The city and city×category location pages are read from local file
    // storage whenever MongoDB isn't configured (local dev, and any
    // deployment without MONGODB_URI). A collection missing from this
    // module's `files` map throws on every read there, silently breaking
    // the whole /locations section outside a MongoDB deployment — exactly
    // what happened here once already for `location_pages` before it was
    // registered, so both are asserted explicitly.
    it('should read the location page collections without throwing', () => {
      expect(() => read('location_pages')).not.toThrow();
      expect(() => read('location_category_pages')).not.toThrow();
      expect(Array.isArray(read('location_pages'))).toBe(true);
      expect(Array.isArray(read('location_category_pages'))).toBe(true);
    });
  });
});
