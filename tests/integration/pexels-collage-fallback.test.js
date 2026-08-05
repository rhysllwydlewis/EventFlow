/**
 * Integration tests for Pexels collage endpoint fallback functionality
 * Tests that fallback URLs are returned when Pexels API is not configured
 */

const request = require('supertest');
const express = require('express');
const dbUnified = require('../../db-unified');
const adminRouter = require('../../routes/admin');

describe('Pexels Collage Fallback Integration', () => {
  let app;
  let originalSettings;

  beforeAll(async () => {
    // Initialize database
    await dbUnified.initializeDatabase();
    // Snapshot settings so we can restore after the suite (avoids cross-test pollution)
    originalSettings = await dbUnified.read('settings');
  });

  afterAll(async () => {
    // Restore original settings to prevent pollution of other tests
    if (originalSettings !== undefined) {
      await dbUnified.write('settings', originalSettings);
    }
  });

  beforeEach(async () => {
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    // Mount admin router at /api to match actual server setup
    app.use('/api', adminRouter);

    // The endpoint is enabled by EITHER the new collageWidget configuration or
    // the legacy pexelsCollage feature flag — the `||` in the route is
    // deliberate backward compatibility. This setup used to manage only the
    // legacy flag, which meant every assertion here silently depended on
    // whatever `collageWidget` happened to be in the database: on a clean
    // store it is absent and the tests pass, but wherever a widget has been
    // configured the "disabled" case stayed enabled and failed. Both switches
    // are now set explicitly so the state under test is the state asserted.
    const settings = (await dbUnified.read('settings')) || {};
    settings.features = settings.features || {};
    settings.features.pexelsCollage = true;
    settings.collageWidget = { ...(settings.collageWidget || {}), enabled: true };
    await dbUnified.write('settings', settings);
  });

  describe('GET /api/public/pexels-collage', () => {
    it('should return fallback photos when Pexels API not configured', async () => {
      // Make request for venues category
      const response = await request(app).get('/api/public/pexels-collage?category=venues');

      // Verify response
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.category).toBe('venues');
      expect(response.body.photos).toBeDefined();
      expect(Array.isArray(response.body.photos)).toBe(true);
      expect(response.body.photos.length).toBeGreaterThan(0);

      // Verify photo structure matches Pexels API format
      const photo = response.body.photos[0];
      expect(photo).toHaveProperty('id');
      expect(photo).toHaveProperty('url');
      expect(photo).toHaveProperty('photographer');
      expect(photo).toHaveProperty('src');
      expect(photo.src).toHaveProperty('original');
      expect(photo.src).toHaveProperty('large');
      expect(photo.src).toHaveProperty('medium');

      // When API is not configured, should use fallback
      // Note: This test assumes PEXELS_API_KEY is not set in test environment
      // If API is configured, usingFallback will be false
      if (response.body.usingFallback !== undefined) {
        expect(typeof response.body.usingFallback).toBe('boolean');
      }
    });

    it('should return 400 for missing category parameter', async () => {
      const response = await request(app).get('/api/public/pexels-collage');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Category parameter required');
    });

    it('should return 400 for invalid category', async () => {
      const response = await request(app).get('/api/public/pexels-collage?category=invalid');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid category');
      expect(response.body.errorType).toBe('validation');
    });

    it('should work for all valid categories', async () => {
      const categories = ['venues', 'catering', 'entertainment', 'photography'];

      for (const category of categories) {
        const response = await request(app).get(`/api/public/pexels-collage?category=${category}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.category).toBe(category);
        expect(response.body.photos).toBeDefined();
        expect(Array.isArray(response.body.photos)).toBe(true);
        expect(response.body.photos.length).toBeGreaterThan(0);
      }
    });

    it('should return 404 when feature flag is disabled', async () => {
      // Disable Pexels collage feature
      const settings = await dbUnified.read('settings');
      // beforeEach guarantees settings exist; if not, fail clearly rather than corrupting DB
      if (!settings || typeof settings !== 'object' || !settings.features) {
        throw new Error('Test setup failed: settings not initialized by beforeEach');
      }
      // Both switches have to go off: either one on keeps the endpoint enabled.
      settings.features.pexelsCollage = false;
      settings.collageWidget = { ...(settings.collageWidget || {}), enabled: false };
      await dbUnified.write('settings', settings);

      const response = await request(app).get('/api/public/pexels-collage?category=venues');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Pexels collage feature is not enabled');

      // Clean up: re-enable both for other tests
      settings.features.pexelsCollage = true;
      settings.collageWidget = { ...(settings.collageWidget || {}), enabled: true };
      await dbUnified.write('settings', settings);
    });
  });

  describe('Video Support', () => {
    it('should return videos by default when videos parameter is not specified', async () => {
      const response = await request(app).get('/api/public/pexels-collage?category=venues');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.category).toBe('venues');

      // Should have both photos and videos arrays by default
      expect(response.body.photos).toBeDefined();
      expect(Array.isArray(response.body.photos)).toBe(true);
      expect(response.body.videos).toBeDefined();
      expect(Array.isArray(response.body.videos)).toBe(true);

      // Both should have items (fallback data should include videos)
      expect(response.body.photos.length).toBeGreaterThan(0);
      expect(response.body.videos.length).toBeGreaterThan(0);
    });

    it('should return videos when videos parameter is true', async () => {
      const response = await request(app).get(
        '/api/public/pexels-collage?category=venues&photos=true&videos=true'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.category).toBe('venues');

      // Should have both photos and videos arrays
      expect(response.body.photos).toBeDefined();
      expect(Array.isArray(response.body.photos)).toBe(true);
      expect(response.body.videos).toBeDefined();
      expect(Array.isArray(response.body.videos)).toBe(true);
    });

    it('should return only photos when videos parameter is false', async () => {
      const response = await request(app).get(
        '/api/public/pexels-collage?category=venues&photos=true&videos=false'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.photos).toBeDefined();
      expect(Array.isArray(response.body.photos)).toBe(true);
      expect(response.body.photos.length).toBeGreaterThan(0);

      // Videos should be empty array
      expect(response.body.videos).toBeDefined();
      expect(Array.isArray(response.body.videos)).toBe(true);
      expect(response.body.videos.length).toBe(0);
    });

    it('should return only videos when photos parameter is false', async () => {
      const response = await request(app).get(
        '/api/public/pexels-collage?category=venues&photos=false&videos=true'
      );

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.videos).toBeDefined();
      expect(Array.isArray(response.body.videos)).toBe(true);
      expect(response.body.videos.length).toBeGreaterThan(0);

      // Photos should be empty array
      expect(response.body.photos).toBeDefined();
      expect(Array.isArray(response.body.photos)).toBe(true);
      expect(response.body.photos.length).toBe(0);
    });

    it('should validate video structure', async () => {
      const response = await request(app).get(
        '/api/public/pexels-collage?category=venues&photos=false&videos=true'
      );

      expect(response.status).toBe(200);

      if (response.body.videos && response.body.videos.length > 0) {
        const video = response.body.videos[0];
        expect(video).toHaveProperty('type', 'video');
        expect(video).toHaveProperty('id');
        expect(video).toHaveProperty('src');
        expect(video.src).toHaveProperty('large');
        expect(video).toHaveProperty('thumbnail');
        expect(video).toHaveProperty('videographer');
        expect(video).toHaveProperty('videographer_url');
      }
    });
  });
});
