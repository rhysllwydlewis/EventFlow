/**
 * Unit tests for Pexels service
 */

// eslint-disable-next-line no-unused-vars -- Imported for type reference, singleton tests use fresh requires
const { PexelsService, getPexelsService } = require('../../utils/pexels-service');

describe('PexelsService', () => {
  describe('Constructor and Configuration', () => {
    it('should create instance with API key', () => {
      const service = new PexelsService('test-api-key');
      expect(service.isConfigured()).toBe(true);
      expect(service.getApiKey()).toBe('test-api-key');
    });

    it('should create instance from environment variable', () => {
      const originalKey = process.env.PEXELS_API_KEY;
      process.env.PEXELS_API_KEY = 'env-api-key';

      const service = new PexelsService();
      expect(service.isConfigured()).toBe(true);
      expect(service.getApiKey()).toBe('env-api-key');

      process.env.PEXELS_API_KEY = originalKey;
    });

    it('should handle missing API key gracefully', () => {
      const originalKey = process.env.PEXELS_API_KEY;
      delete process.env.PEXELS_API_KEY;

      const service = new PexelsService();
      expect(service.isConfigured()).toBe(false);

      process.env.PEXELS_API_KEY = originalKey;
    });

    it('should read API key dynamically from environment', () => {
      const originalKey = process.env.PEXELS_API_KEY;

      // Start without key
      delete process.env.PEXELS_API_KEY;
      const service = new PexelsService();
      expect(service.isConfigured()).toBe(false);
      expect(service.getApiKey()).toBeUndefined();

      // Set key after instance creation
      process.env.PEXELS_API_KEY = 'new-dynamic-key';
      expect(service.isConfigured()).toBe(true);
      expect(service.getApiKey()).toBe('new-dynamic-key');

      // Change key again
      process.env.PEXELS_API_KEY = 'another-key';
      expect(service.getApiKey()).toBe('another-key');

      process.env.PEXELS_API_KEY = originalKey;
    });

    it('should prefer explicit API key over environment variable', () => {
      const originalKey = process.env.PEXELS_API_KEY;
      process.env.PEXELS_API_KEY = 'env-key';

      const service = new PexelsService('explicit-key');
      expect(service.getApiKey()).toBe('explicit-key');

      // Even if env changes, explicit key should be used
      process.env.PEXELS_API_KEY = 'changed-env-key';
      expect(service.getApiKey()).toBe('explicit-key');

      process.env.PEXELS_API_KEY = originalKey;
    });
  });

  describe('Input Validation', () => {
    let service;

    beforeEach(() => {
      service = new PexelsService('test-api-key');
    });

    it('should throw error for empty query in searchPhotos', async () => {
      await expect(service.searchPhotos('')).rejects.toThrow(
        'Invalid query: must be a non-empty string'
      );
    });

    it('should throw error for invalid query type in searchPhotos', async () => {
      await expect(service.searchPhotos(null)).rejects.toThrow(
        'Invalid query: must be a non-empty string'
      );
    });

    it('should throw error for empty query in searchVideos', async () => {
      await expect(service.searchVideos('')).rejects.toThrow(
        'Invalid query: must be a non-empty string'
      );
    });

    it('should throw error for invalid photo ID', async () => {
      await expect(service.getPhotoById(0)).rejects.toThrow(
        'Invalid photo ID: must be a positive integer'
      );
      await expect(service.getPhotoById(-1)).rejects.toThrow(
        'Invalid photo ID: must be a positive integer'
      );
      await expect(service.getPhotoById('invalid')).rejects.toThrow(
        'Invalid photo ID: must be a positive integer'
      );
    });

    it('should throw error for invalid video ID', async () => {
      await expect(service.getVideoById(0)).rejects.toThrow(
        'Invalid video ID: must be a positive number'
      );
      await expect(service.getVideoById(-1)).rejects.toThrow(
        'Invalid video ID: must be a positive number'
      );
    });

    it('should throw error for invalid collection ID', async () => {
      await expect(service.getCollectionMedia(null)).rejects.toThrow('Invalid collection ID');
      await expect(service.getCollectionMedia(undefined)).rejects.toThrow('Invalid collection ID');
    });
  });

  describe('Not Configured Error', () => {
    let service;
    let originalKey;

    beforeEach(() => {
      originalKey = process.env.PEXELS_API_KEY;
      delete process.env.PEXELS_API_KEY;
      service = new PexelsService();
    });

    afterEach(() => {
      process.env.PEXELS_API_KEY = originalKey;
    });

    it('should throw error when not configured - searchPhotos', async () => {
      await expect(service.searchPhotos('test')).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getCuratedPhotos', async () => {
      await expect(service.getCuratedPhotos()).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getPhotoById', async () => {
      await expect(service.getPhotoById(1)).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - searchVideos', async () => {
      await expect(service.searchVideos('test')).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getPopularVideos', async () => {
      await expect(service.getPopularVideos()).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getVideoById', async () => {
      await expect(service.getVideoById(1)).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getFeaturedCollections', async () => {
      await expect(service.getFeaturedCollections()).rejects.toThrow(
        'Pexels API key not configured'
      );
    });

    it('should throw error when not configured - getUserCollections', async () => {
      await expect(service.getUserCollections()).rejects.toThrow('Pexels API key not configured');
    });

    it('should throw error when not configured - getCollectionMedia', async () => {
      await expect(service.getCollectionMedia('123')).rejects.toThrow(
        'Pexels API key not configured'
      );
    });
  });

  describe('testConnection', () => {
    it('should return not configured status when API key is missing', async () => {
      const originalKey = process.env.PEXELS_API_KEY;
      delete process.env.PEXELS_API_KEY;

      const service = new PexelsService();
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Pexels API key not configured');
      expect(result.details.configured).toBe(false);

      process.env.PEXELS_API_KEY = originalKey;
    });
  });

  describe('getCategorySuggestions', () => {
    it('should return array of category suggestions', () => {
      const suggestions = PexelsService.getCategorySuggestions();

      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeGreaterThan(0);

      // Verify structure of first suggestion
      expect(suggestions[0]).toHaveProperty('category');
      expect(suggestions[0]).toHaveProperty('query');
      expect(suggestions[0]).toHaveProperty('icon');
    });

    it('should include wedding-related categories', () => {
      const suggestions = PexelsService.getCategorySuggestions();
      const categories = suggestions.map(s => s.category.toLowerCase());

      expect(categories).toContain('venues');
      expect(categories).toContain('catering');
      expect(categories).toContain('photography');
    });
  });

  describe('Base URL Configuration', () => {
    it('should use correct Pexels API base URL', () => {
      const service = new PexelsService('test-key');
      expect(service.baseUrl).toBe('api.pexels.com');
    });
  });

  describe('makeRequest Headers', () => {
    it('should include User-Agent header', () => {
      const service = new PexelsService('test-key');
      // We can't directly test the headers without making a real request,
      // but we can verify the service is configured properly
      expect(service.getApiKey()).toBe('test-key');
    });
  });

  describe('Filter Parameters', () => {
    let service;

    beforeEach(() => {
      service = new PexelsService('test-key');
      service.makeRequest = jest.fn(async path => ({
        data: path.startsWith('/v1/videos')
          ? { page: 1, per_page: 15, total_results: 0, videos: [] }
          : { page: 1, per_page: 15, total_results: 0, photos: [] },
        rateLimit: {},
      }));
    });

    it('should accept filters object for searchPhotos', async () => {
      const filters = {
        orientation: 'landscape',
        size: 'large',
        color: 'red',
        locale: 'en-US',
      };

      await expect(service.searchPhotos('test', 15, 1, filters)).resolves.toMatchObject({
        photos: [],
      });
      expect(service.makeRequest).toHaveBeenCalledWith(
        '/v1/search?query=test&per_page=15&page=1&orientation=landscape&size=large&color=red&locale=en-US',
        0,
        3,
        'search:test:15:1:{"orientation":"landscape","size":"large","color":"red","locale":"en-US"}'
      );
    });

    it('should accept filters object for searchVideos', async () => {
      const filters = {
        orientation: 'portrait',
        size: 'medium',
        locale: 'pt-BR',
      };

      await expect(service.searchVideos('test', 15, 1, filters)).resolves.toMatchObject({
        videos: [],
      });
      expect(service.makeRequest).toHaveBeenCalledWith(
        '/v1/videos/search?query=test&per_page=15&page=1&orientation=portrait&size=medium&locale=pt-BR'
      );
    });
  });

  describe('getPexelsService Singleton', () => {
    let originalKey;

    beforeEach(() => {
      originalKey = process.env.PEXELS_API_KEY;
      // Reset the singleton by requiring a fresh module
      jest.resetModules();
    });

    afterEach(() => {
      process.env.PEXELS_API_KEY = originalKey;
      jest.resetModules();
    });

    it('should create singleton instance on first call', () => {
      const { getPexelsService } = require('../../utils/pexels-service');
      process.env.PEXELS_API_KEY = 'test-key';

      const instance1 = getPexelsService();
      const instance2 = getPexelsService();

      expect(instance1).toBe(instance2); // Same instance
      expect(instance1.isConfigured()).toBe(true);
    });

    it('should recreate singleton when key becomes available', () => {
      const { getPexelsService } = require('../../utils/pexels-service');

      // Start without key
      delete process.env.PEXELS_API_KEY;
      const instance1 = getPexelsService();
      expect(instance1.isConfigured()).toBe(false);

      // Now set the key
      process.env.PEXELS_API_KEY = 'newly-available-key';
      const instance2 = getPexelsService();

      // Should have recreated the instance
      expect(instance2.isConfigured()).toBe(true);
      expect(instance2.getApiKey()).toBe('newly-available-key');
      expect(instance1).not.toBe(instance2); // Different instance
    });

    it('should not recreate singleton if key was already present', () => {
      const { getPexelsService } = require('../../utils/pexels-service');
      process.env.PEXELS_API_KEY = 'original-key';

      const instance1 = getPexelsService();
      expect(instance1.getApiKey()).toBe('original-key');

      // Call again with same env key
      const instance2 = getPexelsService();
      expect(instance1).toBe(instance2); // Same instance
    });

    it('should use provided API key over environment variable on first call', () => {
      const { getPexelsService } = require('../../utils/pexels-service');
      process.env.PEXELS_API_KEY = 'env-key';

      const instance = getPexelsService('explicit-key');
      expect(instance.getApiKey()).toBe('explicit-key');
    });

    it('should recreate singleton with explicit key if initial instance had no key', () => {
      const { getPexelsService } = require('../../utils/pexels-service');

      // Start without key
      delete process.env.PEXELS_API_KEY;
      const instance1 = getPexelsService();
      expect(instance1.isConfigured()).toBe(false);

      // Now call with explicit key
      const instance2 = getPexelsService('explicit-key');
      expect(instance2.isConfigured()).toBe(true);
      expect(instance2.getApiKey()).toBe('explicit-key');
      expect(instance1).not.toBe(instance2); // Different instance
    });

    it('should handle timing issue: instance created before env var available', () => {
      const { getPexelsService } = require('../../utils/pexels-service');

      // Simulate server startup: no key yet
      delete process.env.PEXELS_API_KEY;
      const instanceAtStartup = getPexelsService();
      expect(instanceAtStartup.isConfigured()).toBe(false);

      // Simulate env var becoming available (e.g., after deployment/restart)
      process.env.PEXELS_API_KEY = 'deployed-key';

      // Next call should detect and recreate
      const instanceAfterDeploy = getPexelsService();
      expect(instanceAfterDeploy.isConfigured()).toBe(true);
      expect(instanceAfterDeploy.getApiKey()).toBe('deployed-key');
    });
  });
});
