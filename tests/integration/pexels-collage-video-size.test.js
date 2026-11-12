'use strict';

/**
 * The homepage collage endpoint used to hand back the first `hd` file Pexels
 * listed for each video: often a 1080p or portrait 1080x1920 file of 5-9 MB for
 * a tile that renders a few hundred pixels wide. A desktop visitor could
 * download tens of megabytes of video without scrolling. The endpoint must
 * return the smallest rendition that is still big enough for the slot.
 */

const express = require('express');
const request = require('supertest');

// Production sets mediaTypes explicitly; the homepage manager only enables
// videos when `videos` is literally true.
const mockSettings = {
  collageWidget: {
    enabled: true,
    source: 'pexels',
    mediaTypes: { photos: true, videos: true },
  },
};
const mockSearchVideos = jest.fn();
const mockSearchPhotos = jest.fn();

jest.mock('../../db-unified', () => ({
  read: jest.fn(async () => mockSettings),
  write: jest.fn(async () => {}),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../utils/pexels-service', () => ({
  getPexelsService: () => ({
    isConfigured: () => true,
    searchVideos: (...args) => mockSearchVideos(...args),
    searchPhotos: (...args) => mockSearchPhotos(...args),
  }),
}));

const router = require('../../routes/admin-homepage-collage-active');

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

function app() {
  const server = express();
  server.use('/api/v1/admin', router);
  return server;
}

describe('collage endpoint video rendition', () => {
  beforeEach(() => {
    mockSearchVideos.mockReset();
    mockSearchPhotos.mockReset();
    mockSearchPhotos.mockResolvedValue({ photos: [] });
    mockSearchVideos.mockResolvedValue({ videos: [video(1), video(2)] });
  });

  test('returns the 640x360 rendition for collage tiles, not the 1080 portrait HD file', async () => {
    const res = await request(app()).get(
      '/api/v1/admin/public/pexels-collage?category=venues&photos=false&videos=true'
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

  test('still lists every rendition so a client can choose another', async () => {
    const res = await request(app()).get(
      '/api/v1/admin/public/pexels-collage?category=venues&photos=false&videos=true'
    );
    expect(res.body.videos[0].video_files.length).toBeGreaterThanOrEqual(5);
  });

  test('the hero video endpoint asks for a larger rendition than a tile, but still not the biggest', async () => {
    const res = await request(app()).get('/api/v1/admin/public/pexels-video?query=wedding');

    expect(res.status).toBe(200);
    expect(res.body.videos[0].src.large).toContain('960_540');
  });

  test('drops a video that has no playable file instead of returning an empty link', async () => {
    mockSearchVideos.mockResolvedValue({
      videos: [{ ...video(3), videoFiles: [{ quality: 'hd', fileType: 'video/mp4' }] }, video(4)],
    });
    const res = await request(app()).get(
      '/api/v1/admin/public/pexels-collage?category=venues&photos=false&videos=true'
    );
    expect(res.body.videos.map(v => v.id)).toEqual([4]);
  });
});
