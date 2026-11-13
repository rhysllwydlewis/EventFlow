'use strict';

/**
 * Resized renditions of stored photos for `GET /api/photos/:id?w=`.
 *
 * Photos are stored once, at upload size (up to 1200 px wide), and used to be
 * served exactly as stored everywhere. A homepage card shows one at roughly
 * 300 CSS px, so each card downloaded four to eight times the pixels it could
 * display: eight cards were about 1 MB.
 *
 * `?w=` asks for a rendition no wider than that. Requests are snapped up to a
 * short list of widths so the in-process cache stays small and a caller cannot
 * fill it with arbitrary sizes. A photo that is already no wider than the
 * target is never touched (no upscaling, no needless re-encode), and any
 * failure falls back to the original: an image must never fail because
 * resizing did.
 */

const sharp = require('sharp');
const logger = require('./logger');

/** Widths a rendition can be requested at, in CSS pixels x density. */
const ALLOWED_WIDTHS = Object.freeze([160, 240, 320, 480, 640, 800, 1200]);

/** Most renditions kept in memory (a few tens of KB each). */
const MAX_CACHED_VARIANTS = 150;

/** Source images this module knows how to resize. */
const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const MAX_INPUT_PIXELS = 40e6;

const cache = new Map();

/**
 * Snap a requested width up to an allowed one.
 * @param {unknown} raw Raw `w` query value.
 * @returns {number|null} Allowed width, or null when no resize was asked for or the value is unusable/too large to matter.
 */
function snapWidth(raw) {
  if (typeof raw !== 'string' || !/^\d{1,4}$/.test(raw)) {
    return null;
  }
  const requested = Number.parseInt(raw, 10);
  if (requested <= 0) {
    return null;
  }
  return ALLOWED_WIDTHS.find(width => width >= requested) || null;
}

/**
 * @param {string} mimeType A stored MIME type.
 * @returns {boolean} True when the image can be resized here.
 */
function isResizable(mimeType) {
  return RESIZABLE_TYPES.has(String(mimeType || 'image/jpeg').toLowerCase());
}

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHED_VARIANTS) {
    cache.delete(cache.keys().next().value);
  }
}

/**
 * Build (or fetch from memory) a rendition.
 *
 * @param {Object} input Input.
 * @param {string} input.id Photo id.
 * @param {Buffer} input.buffer Stored image bytes.
 * @param {string} [input.mimeType] Stored MIME type.
 * @param {number} input.width An allowed width from `snapWidth`.
 * @param {boolean} [input.acceptsWebp] Whether the client advertises WebP.
 * @param {string} [input.version] Changes when the stored photo does, so a replaced photo is not served from memory.
 * @returns {Promise<{buffer: Buffer, mimeType: string}|null>} The rendition, or null to serve the original.
 */
async function getPhotoVariant({ id, buffer, mimeType, width, acceptsWebp = false, version = '' }) {
  if (!buffer || !buffer.length || !isResizable(mimeType)) {
    return null;
  }

  const source = String(mimeType || 'image/jpeg').toLowerCase();
  const outputType = acceptsWebp ? 'image/webp' : source === 'image/jpg' ? 'image/jpeg' : source;
  const key = `${id}|${width}|${outputType}|${buffer.length}|${version}`;

  if (cache.has(key)) {
    const hit = cache.get(key);
    remember(key, hit);
    return hit;
  }

  try {
    const image = sharp(buffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS });
    const { width: sourceWidth } = await image.metadata();
    if (!sourceWidth || sourceWidth <= width) {
      remember(key, null);
      return null;
    }

    let pipeline = image.rotate().resize({ width, withoutEnlargement: true });
    if (outputType === 'image/webp') {
      pipeline = pipeline.webp({ quality: 76 });
    } else if (outputType === 'image/png') {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else {
      pipeline = pipeline.jpeg({ quality: 80 });
    }

    const variant = { buffer: await pipeline.toBuffer(), mimeType: outputType };
    // Keep it only when it actually saved something.
    const result = variant.buffer.length < buffer.length ? variant : null;
    remember(key, result);
    return result;
  } catch (error) {
    logger.warn('Could not resize photo; serving the original', { id, error: error.message });
    return null;
  }
}

/** Empty the cache (tests). */
function resetPhotoVariantCache() {
  cache.clear();
}

module.exports = {
  ALLOWED_WIDTHS,
  MAX_CACHED_VARIANTS,
  getPhotoVariant,
  isResizable,
  resetPhotoVariantCache,
  snapWidth,
};
