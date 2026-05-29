'use strict';

const { stripHtml } = require('./helpers');

const DEFAULT_MAX_IMAGE_CHARS = 1200000;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;

function cleanImageInput(value, max = DEFAULT_MAX_IMAGE_CHARS) {
  if (value === null || value === undefined) {
    return '';
  }
  return stripHtml(String(value)).trim().slice(0, max);
}

function sanitizeWeddingImageUrl(value, max = DEFAULT_MAX_IMAGE_CHARS) {
  const cleaned = cleanImageInput(value, max);
  if (!cleaned) {
    return '';
  }
  const lower = cleaned.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || DATA_IMAGE_RE.test(cleaned)) {
    return cleaned;
  }
  return '';
}

module.exports = {
  DEFAULT_MAX_IMAGE_CHARS,
  DATA_IMAGE_RE,
  sanitizeWeddingImageUrl,
};
