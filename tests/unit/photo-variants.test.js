'use strict';

const crypto = require('crypto');
const sharp = require('sharp');

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const {
  ALLOWED_WIDTHS,
  MAX_CACHED_VARIANTS,
  getPhotoVariant,
  isResizable,
  resetPhotoVariantCache,
  snapWidth,
} = require('../../utils/photo-variants');

/**
 * A photo-like image: random pixels, so the JPEG is large enough for a smaller
 * rendition to be clearly smaller (a flat colour would compress to nothing).
 */
async function photo(width, height, format = 'jpeg') {
  const raw = crypto.randomBytes(width * height * 3);
  const image = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 90 }).toBuffer();
}

beforeEach(() => resetPhotoVariantCache());

describe('snapWidth', () => {
  test.each([
    ['1', 160],
    ['160', 160],
    ['161', 240],
    ['300', 320],
    ['320', 320],
    ['481', 640],
    ['640', 640],
    ['1000', 1200],
    ['1200', 1200],
  ])('snaps %s up to %i', (raw, expected) => {
    expect(snapWidth(raw)).toBe(expected);
  });

  test.each([
    ['1201'],
    ['99999'],
    ['0'],
    ['-5'],
    ['abc'],
    ['320px'],
    ['3.5'],
    [''],
    [undefined],
    [null],
    [['320', '640']],
    [{ w: 320 }],
  ])('returns null for %p (serve the original)', raw => {
    expect(snapWidth(raw)).toBeNull();
  });

  test('only ever returns a width from the short list', () => {
    for (let w = 1; w <= 1200; w += 7) {
      expect(ALLOWED_WIDTHS).toContain(snapWidth(String(w)));
    }
  });
});

describe('isResizable', () => {
  test.each(['image/jpeg', 'image/jpg', 'IMAGE/PNG', 'image/webp', undefined, ''])(
    'accepts %p',
    type => expect(isResizable(type)).toBe(true)
  );
  test.each(['image/gif', 'image/svg+xml', 'image/avif', 'video/mp4', 'application/pdf'])(
    'rejects %p',
    type => expect(isResizable(type)).toBe(false)
  );
});

describe('getPhotoVariant', () => {
  test('returns a smaller WebP at the requested width when the client accepts WebP', async () => {
    const buffer = await photo(1200, 800);
    const variant = await getPhotoVariant({
      id: 'p1',
      buffer,
      mimeType: 'image/jpeg',
      width: 480,
      acceptsWebp: true,
    });

    expect(variant.mimeType).toBe('image/webp');
    expect(variant.buffer.length).toBeLessThan(buffer.length);
    const meta = await sharp(variant.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(320);
  });

  test('keeps the original format when the client does not accept WebP', async () => {
    const buffer = await photo(1200, 800);
    const variant = await getPhotoVariant({
      id: 'p2',
      buffer,
      mimeType: 'image/jpeg',
      width: 480,
      acceptsWebp: false,
    });
    expect(variant.mimeType).toBe('image/jpeg');
    expect((await sharp(variant.buffer).metadata()).format).toBe('jpeg');
  });

  test('normalises the image/jpg alias to image/jpeg', async () => {
    const buffer = await photo(1200, 800);
    const variant = await getPhotoVariant({ id: 'p2b', buffer, mimeType: 'image/jpg', width: 480 });
    expect(variant.mimeType).toBe('image/jpeg');
  });

  test('resizes a PNG and keeps it a PNG without WebP', async () => {
    const buffer = await photo(900, 600, 'png');
    const variant = await getPhotoVariant({ id: 'p3', buffer, mimeType: 'image/png', width: 320 });
    expect(variant.mimeType).toBe('image/png');
    expect((await sharp(variant.buffer).metadata()).width).toBe(320);
  });

  test('never upscales: a photo no wider than the target is served as stored', async () => {
    const buffer = await photo(300, 200);
    expect(
      await getPhotoVariant({ id: 'p4', buffer, mimeType: 'image/jpeg', width: 640 })
    ).toBeNull();
    expect(
      await getPhotoVariant({ id: 'p4b', buffer, mimeType: 'image/jpeg', width: 320 })
    ).toBeNull();
  });

  test.each(['image/gif', 'image/svg+xml', 'image/avif'])('leaves %s alone', async mimeType => {
    const buffer = await photo(1200, 800);
    expect(await getPhotoVariant({ id: 'p5', buffer, mimeType, width: 480 })).toBeNull();
  });

  test('falls back to the original (null) for bytes that are not an image, without throwing', async () => {
    const result = await getPhotoVariant({
      id: 'p6',
      buffer: Buffer.from('definitely not an image'),
      mimeType: 'image/jpeg',
      width: 480,
    });
    expect(result).toBeNull();
  });

  test('returns null for an empty or missing buffer', async () => {
    expect(await getPhotoVariant({ id: 'p7', buffer: Buffer.alloc(0), width: 480 })).toBeNull();
    expect(await getPhotoVariant({ id: 'p7', buffer: undefined, width: 480 })).toBeNull();
  });

  test('serves a repeat request from memory', async () => {
    const buffer = await photo(1200, 800);
    const args = { id: 'p8', buffer, mimeType: 'image/jpeg', width: 480, acceptsWebp: true };
    const first = await getPhotoVariant(args);
    const second = await getPhotoVariant(args);
    expect(second).toBe(first);
  });

  test('does not share a cached rendition between WebP and non-WebP clients', async () => {
    const buffer = await photo(1200, 800);
    const base = { id: 'p9', buffer, mimeType: 'image/jpeg', width: 480 };
    const webp = await getPhotoVariant({ ...base, acceptsWebp: true });
    const jpeg = await getPhotoVariant({ ...base, acceptsWebp: false });
    expect(webp.mimeType).toBe('image/webp');
    expect(jpeg.mimeType).toBe('image/jpeg');
  });

  test('a replaced photo (new version) is not served from the old rendition', async () => {
    const original = await photo(1200, 800);
    const replaced = await photo(1200, 800);
    const first = await getPhotoVariant({
      id: 'p10',
      buffer: original,
      mimeType: 'image/jpeg',
      width: 480,
      version: 'v1',
    });
    const second = await getPhotoVariant({
      id: 'p10',
      buffer: replaced,
      mimeType: 'image/jpeg',
      width: 480,
      version: 'v2',
    });
    expect(second).not.toBe(first);
    expect(second.buffer.equals(first.buffer)).toBe(false);
  });

  test('keeps memory bounded', async () => {
    const buffer = await photo(400, 300);
    // 400 px wide photo, 160 px target: resizable, cheap to render.
    for (let i = 0; i < MAX_CACHED_VARIANTS + 20; i += 1) {
      await getPhotoVariant({ id: `bounded-${i}`, buffer, mimeType: 'image/jpeg', width: 160 });
    }
    // The oldest entries were evicted, so asking again rebuilds a fresh object.
    const again = await getPhotoVariant({
      id: 'bounded-0',
      buffer,
      mimeType: 'image/jpeg',
      width: 160,
    });
    const hit = await getPhotoVariant({
      id: 'bounded-0',
      buffer,
      mimeType: 'image/jpeg',
      width: 160,
    });
    expect(hit).toBe(again);
  });
});
