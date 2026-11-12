'use strict';

const {
  COLLAGE_TILE_MIN_WIDTH,
  HERO_CARD_MIN_WIDTH,
  pickVideoFile,
} = require('../../utils/pexels-video-files');

const mp4 = (quality, width, height, extra = {}) => ({
  id: `${quality}-${width}x${height}`,
  quality,
  fileType: 'video/mp4',
  width,
  height,
  link: `https://videos.pexels.com/video-files/1/1-${quality}_${width}_${height}_25fps.mp4`,
  ...extra,
});

// What the Pexels API typically lists for one landscape clip, HD first (the
// order that made "first hd file" ship a 1080p download to a tiny tile).
const landscapeClip = [
  mp4('hd', 1920, 1080),
  mp4('hd', 1280, 720),
  mp4('sd', 960, 540),
  mp4('sd', 640, 360),
  mp4('sd', 426, 240),
  { id: 'hls', quality: 'hls', fileType: 'application/x-mpegURL', link: 'https://x/y.m3u8' },
];

describe('pickVideoFile', () => {
  test('exports the slot widths the routes use', () => {
    expect(COLLAGE_TILE_MIN_WIDTH).toBe(640);
    expect(HERO_CARD_MIN_WIDTH).toBe(960);
  });

  test('picks the smallest rendition that is big enough for a collage tile', () => {
    const file = pickVideoFile(landscapeClip);
    expect(file.width).toBe(640);
    expect(file.height).toBe(360);
  });

  test('picks a larger rendition for a larger slot, but never the biggest', () => {
    const file = pickVideoFile(landscapeClip, { minWidth: HERO_CARD_MIN_WIDTH });
    expect(file.width).toBe(960);
  });

  test('never prefers a portrait 1080x1920 file over a small landscape one', () => {
    const files = [mp4('hd', 1080, 1920), mp4('hd', 720, 1280), mp4('sd', 640, 360)];
    expect(pickVideoFile(files)).toMatchObject({ width: 640, height: 360 });
  });

  test('uses a portrait file only when it is the smallest one that fits', () => {
    const files = [mp4('hd', 1080, 1920), mp4('sd', 540, 960)];
    expect(pickVideoFile(files)).toMatchObject({ width: 540, height: 960 });
  });

  test('prefers landscape when two renditions have the same pixel area', () => {
    const files = [mp4('sd', 360, 640), mp4('sd', 640, 360)];
    expect(pickVideoFile(files)).toMatchObject({ width: 640, height: 360 });
    expect(pickVideoFile([...files].reverse())).toMatchObject({ width: 640, height: 360 });
  });

  test('returns the largest available when nothing reaches the minimum', () => {
    const files = [mp4('sd', 426, 240), mp4('sd', 320, 180)];
    expect(pickVideoFile(files)).toMatchObject({ width: 426 });
  });

  test('ignores HLS playlists and non-mp4 files', () => {
    const files = [
      { quality: 'hd', fileType: 'application/x-mpegURL', width: 640, height: 360, link: 'x.m3u8' },
      mp4('hd', 1280, 720),
    ];
    expect(pickVideoFile(files)).toMatchObject({ width: 1280 });
  });

  test('accepts the snake_case file_type the raw API uses', () => {
    const files = [
      { quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: 'a.mp4' },
      {
        quality: 'hd',
        file_type: 'application/x-mpegURL',
        width: 640,
        height: 360,
        link: 'b.m3u8',
      },
    ];
    expect(pickVideoFile(files).link).toBe('a.mp4');
  });

  test('treats files with no declared type as mp4 (the curated fallbacks)', () => {
    const files = [{ quality: 'sd', width: 640, height: 360, link: 'a.mp4' }];
    expect(pickVideoFile(files).link).toBe('a.mp4');
  });

  test('falls back to sd, then hd, when files report no dimensions', () => {
    expect(
      pickVideoFile([
        { quality: 'hd', link: 'hd.mp4' },
        { quality: 'sd', link: 'sd.mp4' },
      ]).link
    ).toBe('sd.mp4');
    expect(
      pickVideoFile([
        { quality: 'hd', link: 'hd.mp4' },
        { quality: 'uhd', link: 'uhd.mp4' },
      ]).link
    ).toBe('hd.mp4');
    expect(pickVideoFile([{ quality: 'uhd', link: 'uhd.mp4' }]).link).toBe('uhd.mp4');
  });

  test('skips files without a link and returns null when nothing is playable', () => {
    expect(pickVideoFile([{ quality: 'sd', width: 640, height: 360 }])).toBeNull();
    expect(pickVideoFile([])).toBeNull();
    expect(pickVideoFile(undefined)).toBeNull();
    expect(pickVideoFile(null)).toBeNull();
  });

  test('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(landscapeClip));
    pickVideoFile(landscapeClip);
    expect(landscapeClip).toEqual(copy);
  });
});
