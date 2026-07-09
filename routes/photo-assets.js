/**
 * Public Photo Asset Routes
 *
 * Serves stored image binaries with asset-friendly rate limits and long-lived
 * caching. Mounted before the legacy photos router so public image requests do
 * not consume the normal JSON API rate-limit bucket.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const databaseConfig = require('../config/database');
const { photoAssetLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');

const router = express.Router();
const ONE_YEAR_SECONDS = 31536000;
const PHOTO_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function normaliseMimeType(mimeType) {
  const value = typeof mimeType === 'string' ? mimeType.trim() : '';
  return value && /^image\//i.test(value) ? value : 'image/jpeg';
}

function getPhotoBase64(photo) {
  if (!photo || typeof photo !== 'object') {
    return '';
  }
  return typeof photo.data === 'string'
    ? photo.data
    : typeof photo.imageData === 'string'
      ? photo.imageData
      : '';
}

function createPhotoEtag(id, photo, base64Data) {
  const version = photo.updatedAt || photo.uploadedAt || photo.createdAt || photo.modifiedAt || '';
  const length = typeof base64Data === 'string' ? base64Data.length : 0;
  const digest = crypto
    .createHash('sha256')
    .update(`${id}:${version}:${length}`)
    .digest('hex')
    .slice(0, 32);
  return `W/"photo-${digest}"`;
}

function requestHasMatchingEtag(req, etag) {
  const headerValue = String(req.headers['if-none-match'] || '');
  if (!headerValue) {
    return false;
  }
  return headerValue
    .split(',')
    .map(value => value.trim())
    .some(value => value === etag || value === '*');
}

function setPhotoCacheHeaders(res, { mimeType, etag, length } = {}) {
  res.setHeader('Content-Type', normaliseMimeType(mimeType));
  res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
  res.setHeader('Vary', 'Accept');
  if (etag) {
    res.setHeader('ETag', etag);
  }
  if (Number.isFinite(length)) {
    res.setHeader('Content-Length', String(length));
  }
}

function sendPhotoError(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function findStoredPhoto(db, id) {
  const marketplaceImage = await db.collection('marketplace_images').findOne({ _id: id });
  if (marketplaceImage) {
    return { photo: marketplaceImage, source: 'marketplace_images' };
  }

  const genericPhoto = await db.collection('photos').findOne({ _id: id });
  if (genericPhoto) {
    return { photo: genericPhoto, source: 'photos' };
  }

  return { photo: null, source: null };
}

/**
 * GET /api/photos/:id
 * GET /api/v1/photos/:id
 *
 * Public image asset delivery. Keep this unauthenticated and mounted before the
 * legacy photos router, otherwise homepage/package images can be throttled by
 * the normal API limiter and render placeholders intermittently.
 */
router.get('/photos/:id', photoAssetLimiter, async (req, res) => {
  const { id } = req.params;

  if (!id || !PHOTO_ID_PATTERN.test(id)) {
    return sendPhotoError(res, 400, {
      error: 'Invalid photo id',
      errorType: 'InvalidPhotoId',
    });
  }

  try {
    if (!databaseConfig.isMongoAvailable()) {
      logger.warn('Photo asset request failed: MongoDB unavailable', {
        photoId: id,
        path: req.originalUrl,
      });
      return sendPhotoError(res, 503, {
        error: 'Photo storage not available',
        errorType: 'PhotoStorageUnavailable',
      });
    }

    const db = await databaseConfig.mongoDb.getDb();
    const { photo, source } = await findStoredPhoto(db, id);

    if (!photo) {
      logger.info('Photo asset not found', {
        photoId: id,
        path: req.originalUrl,
      });
      return sendPhotoError(res, 404, {
        error: 'Photo not found',
        errorType: 'PhotoNotFound',
      });
    }

    const base64Data = getPhotoBase64(photo);
    if (!base64Data) {
      logger.error('Photo asset record has no binary payload', {
        photoId: id,
        source,
      });
      return sendPhotoError(res, 502, {
        error: 'Photo data unavailable',
        errorType: 'PhotoDataMissing',
      });
    }

    const etag = createPhotoEtag(id, photo, base64Data);
    if (requestHasMatchingEtag(req, etag)) {
      setPhotoCacheHeaders(res, { mimeType: photo.mimeType, etag });
      res.setHeader('X-EventFlow-Photo-Cache', 'not-modified');
      res.setHeader('X-EventFlow-Photo-Source', source);
      return res.status(304).end();
    }

    const imageBuffer = Buffer.from(base64Data, 'base64');
    if (!imageBuffer.length) {
      logger.error('Photo asset decoded to an empty buffer', {
        photoId: id,
        source,
      });
      return sendPhotoError(res, 502, {
        error: 'Photo data unavailable',
        errorType: 'PhotoDataEmpty',
      });
    }

    setPhotoCacheHeaders(res, {
      mimeType: photo.mimeType,
      etag,
      length: imageBuffer.length,
    });
    res.setHeader('X-EventFlow-Photo-Cache', 'fresh');
    res.setHeader('X-EventFlow-Photo-Source', source);

    return res.send(imageBuffer);
  } catch (error) {
    logger.error('Photo asset request failed', {
      photoId: id,
      path: req.originalUrl,
      error: error.message,
      stack: error.stack,
    });
    return sendPhotoError(res, 500, {
      error: 'Failed to retrieve photo',
      errorType: 'PhotoAssetError',
    });
  }
});

module.exports = router;
module.exports._private = {
  createPhotoEtag,
  getPhotoBase64,
  normaliseMimeType,
  requestHasMatchingEtag,
  setPhotoCacheHeaders,
};
