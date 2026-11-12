'use strict';

/**
 * The collage endpoint the homepage actually calls is served by routes/admin.js
 * (it is mounted ahead of routes/admin-homepage-collage-active.js, which has a
 * second copy of the same route). Both must return a right-sized video file, so
 * this covers the live one; pexels-collage-video-size.test.js covers the other.
 *
 * Before, it returned the first `hd` file Pexels listed for each video: often a
 * 1080p or portrait 1080x1920 file of 5-9 MB for a tile a few hundred px wide.
 */

const express = require('express');
const request = require('supertest');

const mockSearchVideos = jest.fn();
const mockSearchPhotos = jest.fn();

jest.mock('../../utils/pexels-service', () => ({
  ...jest.requireActual('../../utils/pexels-service'),
  getPexelsService: () => ({
    isConfigured: () => true,
    searchVideos: (...args) => mockSearchVideos(...args),
    searchPhotos: (...args) => mockSearchPhotos(...args),
  }),
}));

const dbUnified = require('../../db-unified');
const adminRouter = require('../../routes/admin');

const file = (quality, width, height, fileType = 'video/mp4') => ({
  id: `${quality}-${width}x${height}`,
  quality,
  fileType,
  width,
  height,
  link: `https://videos.pexels.com/video-files/9/9-${quality}_${width}_${height}_25fps.mp4`,
});

// Listed the way the live API lists them: the large portrait HD file first.
const video = id => ({
  id,
  url: `https://www.pexels.com/video/${id}/`,
  image: `https://images.pexels.com/videos/${id}/poster.jpeg`,
  duration: 12,
  width: 1080,
  height: 1920,
  user: { name: 'Videographer', url: 'https://www.pexels.com/@v' },
  videoFiles: [
    file('hd', 1080, 1920),
    file('hd', 1920, 1080),
    file('hd', 1280, 720),
    file('sd', 960, 540),
    file('sd', 640, 360),
    { ...file('hls', 640, 360, 'application/x-mpegURL'), link: 'https://x/y.m3u8' },
  ],
});

describe('live collage endpoint (routes/admin.js) video rendition', () => {
  let app;
  let originalSettings;

  beforeAll(async () => {
    await dbUnified.initializeDatabase();
    originalSettings = await dbUnified.read('settings');
  });

  afterAll(async () => {
    if (originalSettings !== undefined) {
      await dbUnified.write('settings', originalSettings);
    }
  });

  beforeEach(async () => {
    mockSearchVideos.mockReset();
    mockSearchPhotos.mockReset();
    mockSearchPhotos.mockResolvedValue({ photos: [] });
    mockSearchVideos.mockResolvedValue({ videos: [video(1), video(2)] });

    const settings = (await dbUnified.read('settings')) || {};
    settings.features = { ...(settings.features || {}), pexelsCollage: true };
    settings.collageWidget = {
      ...(settings.collageWidget || {}),
      enabled: true,
      source: 'pexels',
      mediaTypes: { photos: true, videos: true },
    };
    await dbUnified.write('settings', settings);

    app = express();
    app.use(express.json());
    app.use('/api', adminRouter);
  });

  test('returns the 640x360 rendition for collage tiles, not the 1080 portrait HD file', async () => {
    const res = await request(app).get(
      '/api/public/pexels-collage?category=venues&photos=false&videos=true'
    );

    expect(res.status).toBe(200);
    expect(res.body.videos).toHaveLength(2);
    for (const item of res.body.videos) {
      expect(item.src.large).toContain('640_360');
      expect(item.src.large).not.toMatch(/1080_1920|1920_1080|1280_720/);
      expect(item.src.large).not.toContain('.m3u8');
      expect(item.src.original).toBe(item.src.large);
    }
  });

  test('drops a video that has no playable file instead of returning an empty link', async () => {
    mockSearchVideos.mockResolvedValue({
      videos: [{ ...video(3), videoFiles: [{ quality: 'hd', fileType: 'video/mp4' }] }, video(4)],
    });

    const res = await request(app).get(
      '/api/public/pexels-collage?category=venues&photos=false&videos=true'
    );

    expect(res.body.videos.map(v => v.id)).toEqual([4]);
  });
});
