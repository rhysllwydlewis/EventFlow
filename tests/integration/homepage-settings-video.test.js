/**
 * Integration tests for homepage settings endpoint video query support
 * Tests that pexelsVideoQueries are returned correctly
 */

const request = require('supertest');
const express = require('express');
const dbUnified = require('../../db-unified');
const publicRouter = require('../../routes/public');

describe('Homepage Settings Video Support Integration', () => {
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
    // Mount public router at /api/public
    app.use('/api/public', publicRouter);

    // Set up collage widget with video queries
    const settings = await dbUnified.read('settings');
    const updatedSettings = {
      ...(settings || {}),
      collageWidget: {
        enabled: true,
        source: 'pexels',
        mediaTypes: { photos: true, videos: true },
        intervalSeconds: 2.5,
        pexelsQueries: {
          venues: 'wedding venue elegant',
          catering: 'wedding catering food',
          entertainment: 'live band wedding',
          photography: 'wedding photography',
        },
        pexelsVideoQueries: {
          venues: 'wedding venue video aerial',
          catering: 'catering food preparation video',
          entertainment: 'live band music performance video',
          photography: 'wedding videography cinematic',
        },
        heroVideo: {
          enabled: true,
          autoplay: true,
          muted: true,
          loop: false,
          quality: 'auto',
        },
        videoQuality: {
          preference: 'sd',
          adaptive: true,
          mobileOptimized: true,
        },
        transition: {
          effect: 'crossfade',
          duration: 1200,
        },
        preloading: {
          enabled: false,
          count: 1,
        },
        mobileOptimizations: {
          slowerTransitions: false,
          disableVideos: true,
          touchControls: false,
        },
        contentFiltering: {
          aspectRatio: '16:9',
          orientation: 'landscape',
          minResolution: 'HD',
        },
        playbackControls: {
          showControls: false,
          pauseOnHover: false,
          fullscreen: true,
        },
      },
    };
    await dbUnified.write('settings', updatedSettings);
  });

  describe('GET /api/public/homepage-settings', () => {
    it('should return pexelsVideoQueries in collageWidget', async () => {
      const response = await request(app).get('/api/public/homepage-settings');

      expect(response.status).toBe(200);
      expect(response.body.collageWidget).toBeDefined();
      expect(response.body.collageWidget.pexelsVideoQueries).toBeDefined();
      expect(typeof response.body.collageWidget.pexelsVideoQueries).toBe('object');
    });

    it('should have video queries for all categories', async () => {
      const response = await request(app).get('/api/public/homepage-settings');

      const videoQueries = response.body.collageWidget.pexelsVideoQueries;
      expect(videoQueries).toHaveProperty('venues');
      expect(videoQueries).toHaveProperty('catering');
      expect(videoQueries).toHaveProperty('entertainment');
      expect(videoQueries).toHaveProperty('photography');
    });

    it('should expose safe admin hero video controls for the public V3 hero', async () => {
      const response = await request(app).get('/api/public/homepage-settings');

      expect(response.status).toBe(200);
      expect(response.body.collageWidget.heroVideo).toMatchObject({
        enabled: true,
        autoplay: true,
        muted: true,
        loop: false,
        quality: 'auto',
      });
      expect(response.body.collageWidget.videoQuality).toMatchObject({
        preference: 'sd',
        adaptive: true,
        mobileOptimized: true,
      });
      expect(response.body.collageWidget.transition).toMatchObject({
        effect: 'crossfade',
        duration: 1200,
      });
      expect(response.body.collageWidget.preloading).toMatchObject({
        enabled: false,
        count: 1,
      });
      expect(response.body.collageWidget.mobileOptimizations).toMatchObject({
        slowerTransitions: false,
        disableVideos: true,
        touchControls: false,
      });
      expect(response.body.collageWidget.contentFiltering).toMatchObject({
        aspectRatio: '16:9',
        orientation: 'landscape',
        minResolution: 'HD',
      });
      expect(response.body.collageWidget.playbackControls).toMatchObject({
        showControls: false,
        pauseOnHover: false,
        fullscreen: true,
      });
    });

    it('should return default video queries and hero controls if not configured', async () => {
      // Clear video settings from settings
      const settings = await dbUnified.read('settings');
      delete settings.collageWidget.pexelsVideoQueries;
      delete settings.collageWidget.heroVideo;
      delete settings.collageWidget.videoQuality;
      delete settings.collageWidget.transition;
      delete settings.collageWidget.preloading;
      delete settings.collageWidget.mobileOptimizations;
      delete settings.collageWidget.contentFiltering;
      delete settings.collageWidget.playbackControls;
      await dbUnified.write('settings', settings);

      const response = await request(app).get('/api/public/homepage-settings');

      expect(response.status).toBe(200);
      const videoQueries = response.body.collageWidget.pexelsVideoQueries;
      expect(videoQueries).toBeDefined();
      expect(typeof videoQueries).toBe('object');
      // Should have default queries
      expect(Object.keys(videoQueries).length).toBeGreaterThan(0);
      expect(response.body.collageWidget.heroVideo).toMatchObject({
        enabled: true,
        autoplay: false,
        muted: true,
        loop: true,
        quality: 'hd',
      });
      expect(response.body.collageWidget.videoQuality).toMatchObject({
        preference: 'hd',
        adaptive: true,
        mobileOptimized: true,
      });
      expect(response.body.collageWidget.transition).toMatchObject({
        effect: 'fade',
        duration: 1000,
      });
      expect(response.body.collageWidget.preloading).toMatchObject({
        enabled: true,
        count: 3,
      });
      expect(response.body.collageWidget.contentFiltering).toMatchObject({
        aspectRatio: 'any',
        orientation: 'any',
        minResolution: 'SD',
      });
    });

    it('should expose a public homepage video playlist for upload fallback mode', async () => {
      const settings = await dbUnified.read('settings');
      settings.collageWidget.source = 'uploads';
      settings.collageWidget.uploadGallery = [];
      settings.collageWidget.fallbackToPexels = true;
      await dbUnified.write('settings', settings);

      const response = await request(app).get('/api/public/homepage-video?query=wedding');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.videos)).toBe(true);
      expect(response.body.videos.length).toBeGreaterThan(1);
    });

    it('should reject public homepage video fallback when uploads disable Pexels fallback', async () => {
      const settings = await dbUnified.read('settings');
      settings.collageWidget.source = 'uploads';
      settings.collageWidget.uploadGallery = [];
      settings.collageWidget.fallbackToPexels = false;
      await dbUnified.write('settings', settings);

      const response = await request(app).get('/api/public/homepage-video?query=wedding');

      expect(response.status).toBe(400);
      expect(response.body.errorType).toBe('pexels_fallback_disabled');
    });
  });
});
