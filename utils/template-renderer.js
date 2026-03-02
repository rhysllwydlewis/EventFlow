/**
 * Template Renderer Middleware
 * Replaces placeholders in HTML files with dynamic content from content-config
 */

'use strict';

const path = require('path');
const logger = require('./logger');
const fs = require('fs').promises;
const { getPlaceholders } = require('../config/content-config');

/**
 * Cache for rendered templates
 * Key: file path, Value: { content, mtime }
 */
const templateCache = new Map();

/**
 * Check if caching is enabled (disabled in development for hot reload)
 */
function isCachingEnabled() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Replace all placeholders in content with values from content-config
 * @param {string} content - HTML content with placeholders
 * @returns {string} Content with placeholders replaced
 */
function replacePlaceholders(content) {
  const placeholders = getPlaceholders();
  let result = content;

  // Replace all {{PLACEHOLDER_NAME}} with actual values
  for (const [key, value] of Object.entries(placeholders)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(pattern, value);
  }

  return result;
}

/**
 * Check if file should be processed for template rendering
 * @param {string} filePath - File path to check
 * @returns {boolean} True if file should be processed
 */
function shouldProcessFile(filePath) {
  // Only process HTML files
  if (!filePath.endsWith('.html')) {
    return false;
  }

  const fileName = path.basename(filePath);

  // Process legal documents, articles, and main pages
  const processFiles = [
    'legal.html',
    'terms.html',
    'privacy.html',
    'data-rights.html',
    'admin-settings.html',
  ];

  if (processFiles.includes(fileName)) {
    return true;
  }

  // Process all article HTML files
  if (filePath.includes('/articles/')) {
    return true;
  }

  // Process any HTML file in public root that might have copyright
  // Exclude only test/dev pages
  if (fileName.startsWith('test-')) {
    return false;
  }

  return true;
}

/**
 * Get file from cache or filesystem
 * @param {string} filePath - Absolute file path
 * @returns {Promise<Object>} Object with content and metadata
 */
async function getFile(filePath) {
  const cachingEnabled = isCachingEnabled();

  const stats = await fs.stat(filePath);
  const mtime = stats.mtime.getTime();

  // Include config file mtime in cache key to invalidate when config changes
  const configPath = path.join(__dirname, '..', 'config', 'content-config.js');
  let configMtime = 0;
  try {
    const configStats = await fs.stat(configPath);
    configMtime = configStats.mtime.getTime();
  } catch (err) {
    // Config file doesn't exist or can't be read - use 0
  }

  const cacheKey = `${filePath}:${configMtime}`;

  // Check cache if enabled
  if (cachingEnabled && templateCache.has(cacheKey)) {
    const cached = templateCache.get(cacheKey);
    if (cached.mtime === mtime) {
      return { content: cached.content, fromCache: true };
    }
  }

  // Read file from filesystem
  const content = await fs.readFile(filePath, 'utf8');

  // Process placeholders
  const processedContent = replacePlaceholders(content);

  // Cache if enabled
  if (cachingEnabled) {
    templateCache.set(cacheKey, {
      content: processedContent,
      mtime: mtime,
    });
  }

  return { content: processedContent, fromCache: false };
}

/**
 * Clear template cache (useful when content-config is updated)
 */
function clearCache() {
  templateCache.clear();
}

/**
 * Express middleware for template rendering
 * Intercepts HTML file requests and replaces placeholders
 */
function templateMiddleware() {
  return async (req, res, next) => {
    // Only process GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Get the file path being requested
    let requestPath = req.path;

    // Normalize path
    if (requestPath === '/') {
      requestPath = '/index.html';
    } else if (!path.extname(requestPath)) {
      // If no extension, assume .html
      requestPath = `${requestPath}.html`;
    }

    // Check if this file should be processed
    if (!shouldProcessFile(requestPath)) {
      return next();
    }

    // Build absolute file path
    const publicDir = path.join(__dirname, '..', 'public');
    const filePath = path.join(publicDir, requestPath);

    try {
      const { content } = await getFile(filePath);

      // Send processed content
      res.type('html');
      res.send(content);
    } catch (error) {
      // File not found or error reading - pass to next middleware (static or 404)
      if (error.code === 'ENOENT') {
        return next();
      }
      // Other errors - log and pass to error handler
      logger.error('Template rendering error:', error);
      return next(error);
    }
  };
}

module.exports = {
  templateMiddleware,
  replacePlaceholders,
  clearCache,
  getPlaceholders,
};
