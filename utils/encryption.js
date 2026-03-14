/**
 * Encryption Utilities
 * Provides encryption/decryption for sensitive data like 2FA secrets
 */

'use strict';

const crypto = require('crypto');
const logger = require('./logger');

// Encryption settings
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get or generate encryption key from environment
 * @returns {Buffer} Encryption key
 */
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;

  if (!secret || secret === 'change_me' || secret === 'change_me_in_production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set in production');
    }
    // Dev-only: use a deterministic placeholder so the app starts without configuration.
    // Data encrypted with this key is NOT compatible with production-encrypted data.
    // Never deploy without setting ENCRYPTION_KEY or JWT_SECRET.
    logger.warn(
      '⚠️  ENCRYPTION_KEY is not set. Using dev-only placeholder. Set ENCRYPTION_KEY before deploying to production.'
    );
    return crypto.pbkdf2Sync(
      'dev-only-placeholder',
      Buffer.from('eventflow-encryption-salt'),
      100000,
      KEY_LENGTH,
      'sha256'
    );
  }

  // The salt is fixed by default for deterministic key derivation, ensuring data encrypted
  // in one process can be decrypted in another without storing the salt alongside each record.
  // Override via ENCRYPTION_SALT if you need to rotate or customise the salt.
  const salt = Buffer.from(process.env.ENCRYPTION_SALT || 'eventflow-encryption-salt');
  return crypto.pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string value
 * @param {string} text - Text to encrypt
 * @returns {string} Encrypted text in format: iv:tag:encrypted
 */
function encrypt(text) {
  if (!text) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Return format: iv:tag:encrypted
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  } catch (error) {
    logger.error('Encryption error:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt a string value
 * @param {string} encryptedText - Encrypted text in format: iv:tag:encrypted
 * @returns {string} Decrypted text
 */
function decrypt(encryptedText) {
  if (!encryptedText) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Decryption error:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value (for backup codes)
 * @param {string} value - Value to hash
 * @returns {string} Hashed value
 */
function hash(value) {
  if (!value) {
    return null;
  }
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Verify a hashed value
 * @param {string} value - Plain text value
 * @param {string} hashedValue - Hashed value to compare
 * @returns {boolean} True if values match
 */
function verifyHash(value, hashedValue) {
  if (!value || !hashedValue) {
    return false;
  }
  return hash(value) === hashedValue;
}

/**
 * Generate a random token
 * @param {number} length - Byte length (default 32)
 * @returns {string} Random token in hex format
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  hash,
  verifyHash,
  generateToken,
};
