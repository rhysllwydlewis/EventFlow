'use strict';

/**
 * GET /api/photos/:id?w= : resized renditions of stored photos.
 *
 * Without `w` the route must behave exactly as before (original bytes, original
 * type). With `w` it returns a rendition no wider than asked for, negotiated on
 * the Accept header, and falls back to the original whenever resizing is
 * pointless or impossible.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');

const mockStore = { marketplace_images: {}, photos: {} };

jest.mock('../../config/database', () => ({
  isMongoAvailable: () => true,
  mongoDb: {
    getDb: async () => ({
      collection: name => ({
        findOne: async ({ _id }) => mockStore[name][_id] || null,
      }),
    }),
  },
}));
jest.mock('../../middleware/rateLimits', () => ({
  uploadLimiter: (_req, _res, next) => next(),
  apiLimiter: (_req, _res, next) => next(),
  authLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../routes/suppliers', () => ({}));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const photosRouter = require('../../routes/photos');
const { resetPhotoVariantCache } = require('../../utils/photo-variants');

async function jpeg(width, height) {
  const raw = crypto.randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const WEBP_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
const binary = (res, callback) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

function app() {
  const server = express();
  server.use('/api', photosRouter);
  return server;
}

const get = (path, headers = {}) =>
  request(app()).get(path).set(headers).buffer(true).parse(binary);

let big;
let small;

beforeAll(async () => {
  big = await jpeg(1200, 800);
  small = await jpeg(300, 200);
});

beforeEach(() => {
  resetPhotoVariantCache();
  mockStore.marketplace_images = {
    big: { _id: 'big', imageData: big.toString('base64'), mimeType: 'image/jpeg' },
    small: { _id: 'small', imageData: small.toString('base64'), mimeType: 'image/jpeg' },
  };
  mockStore.photos = {
    legacy: { _id: 'legacy', data: big.toString('base64'), mimeType: 'image/jpeg' },
  };
});

describe('GET /api/photos/:id without ?w=', () => {
  test('serves the stored bytes exactly as before', async () => {
    const res = await get('/api/photos/big', { Accept: WEBP_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000');
    expect(res.headers.vary).toBeUndefined();
    expect(res.body.equals(big)).toBe(true);
  });

  test('404s an unknown photo', async () => {
    const res = await get('/api/photos/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/photos/:id?w=', () => {
  test('returns a smaller WebP when the browser accepts WebP', async () => {
    const res = await get('/api/photos/big?w=480', { Accept: WEBP_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers.vary).toMatch(/Accept/i);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000');
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
    expect(res.body.length).toBeLessThan(big.length);
    expect((await sharp(res.body).metadata()).width).toBe(480);
  });

  test('returns a JPEG of the same width when WebP is not accepted', async () => {
    const res = await get('/api/photos/big?w=480', { Accept: 'image/jpeg,*/*' });
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect((await sharp(res.body).metadata()).width).toBe(480);
  });

  test('snaps an odd width up to an allowed one', async () => {
    const res = await get('/api/photos/big?w=300', { Accept: WEBP_ACCEPT });
    expect((await sharp(res.body).metadata()).width).toBe(320);
  });

  test('also resizes photos held in the legacy photos collection', async () => {
    const res = await get('/api/photos/legacy?w=640', { Accept: WEBP_ACCEPT });
    expect((await sharp(res.body).metadata()).width).toBe(640);
  });

  test('never upscales: a photo narrower than the target is served as stored', async () => {
    const res = await get('/api/photos/small?w=640', { Accept: WEBP_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body.equals(small)).toBe(true);
  });

  test.each(['abc', '0', '-1', '5000', '320px', ''])(
    'ignores the unusable width %p and serves the original',
    async w => {
      const res = await get(`/api/photos/big?w=${w}`, { Accept: WEBP_ACCEPT });
      expect(res.status).toBe(200);
      expect(res.body.equals(big)).toBe(true);
    }
  );

  test('serves the original when the stored bytes are not a decodable image', async () => {
    const junk = Buffer.from('this is not an image at all');
    mockStore.marketplace_images.junk = {
      _id: 'junk',
      imageData: junk.toString('base64'),
      mimeType: 'image/jpeg',
    };
    const res = await get('/api/photos/junk?w=480', { Accept: WEBP_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.body.equals(junk)).toBe(true);
  });

  test('leaves types it cannot resize (GIF) as stored', async () => {
    const gif = Buffer.from('GIF89a-stand-in-bytes');
    mockStore.marketplace_images.anim = {
      _id: 'anim',
      imageData: gif.toString('base64'),
      mimeType: 'image/gif',
    };
    const res = await get('/api/photos/anim?w=480', { Accept: WEBP_ACCEPT });
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.body.equals(gif)).toBe(true);
  });

  test('still 404s an unknown photo', async () => {
    const res = await get('/api/photos/nope?w=480');
    expect(res.status).toBe(404);
  });
});
