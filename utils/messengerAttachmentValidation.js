'use strict';

const path = require('path');

const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = Object.freeze(new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]));

const EXTENSION_BY_MIME_TYPE = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt',
});

function normaliseMimeType(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

function isZipBasedOfficeDocument(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function detectMimeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'application/msword';
  if (isZipBasedOfficeDocument(buffer)) return 'application/zip-office';

  const sample = buffer.slice(0, Math.min(buffer.length, 512));
  const nulCount = sample.filter(byte => byte === 0x00).length;
  const controlCount = sample.filter(byte => byte < 0x09 || (byte > 0x0d && byte < 0x20)).length;
  if (sample.length > 0 && nulCount === 0 && controlCount / sample.length < 0.02) return 'text/plain';
  return null;
}

function validateMessengerAttachment(file) {
  if (!file) return { ok: false, reason: 'No file supplied' };
  const mimetype = normaliseMimeType(file.mimetype);
  if (!ALLOWED_MIME_TYPES.has(mimetype)) return { ok: false, reason: 'Unsupported file type' };
  if (!file.buffer || !Buffer.isBuffer(file.buffer)) return { ok: false, reason: 'Attachment buffer missing' };
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES || file.buffer.length > MAX_ATTACHMENT_SIZE_BYTES) {
    return { ok: false, reason: 'Attachment exceeds 10MB limit' };
  }

  const detected = detectMimeFromBuffer(file.buffer);
  if (!detected) return { ok: false, reason: 'Could not verify file signature' };
  const isOfficeXml = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(mimetype);
  if (detected !== mimetype && !(isOfficeXml && detected === 'application/zip-office')) {
    return { ok: false, reason: 'File content does not match declared type' };
  }

  return {
    ok: true,
    mimetype,
    detectedMimeType: detected,
    extension: EXTENSION_BY_MIME_TYPE[mimetype] || path.extname(file.originalname || '').toLowerCase() || '.bin',
  };
}

module.exports = {
  MAX_ATTACHMENT_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  EXTENSION_BY_MIME_TYPE,
  detectMimeFromBuffer,
  validateMessengerAttachment,
};
