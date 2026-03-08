'use strict';

/**
 * NASA SVS (Scientific Visualization Studio) Service
 * Fetches and caches data from the NASA SVS API for the Moon 3D model visualization.
 * API endpoint: https://svs.gsfc.nasa.gov/api/14959
 * No authentication required — the NASA SVS API is public.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// NASA SVS API endpoint for the Moon 3D Models visualization
const NASA_SVS_API_URL = 'https://svs.gsfc.nasa.gov/api/14959';

// Local drop folder where the user places the downloaded .glb file
const LOCAL_GLB_DIR = path.join(__dirname, '..', 'public', 'assets', 'nasa-svs');

// Cache TTL in milliseconds (default: 1 hour)
const CACHE_TTL_MS = parseInt(process.env.NASA_SVS_CACHE_TTL_MS, 10) || 60 * 60 * 1000;

/** @type {{ data: Object|null, fetchedAt: number|null }} */
let cache = {
  data: null,
  fetchedAt: null,
};

/**
 * Returns true if the cached data is still valid.
 * @returns {boolean}
 */
function isCacheValid() {
  return (
    cache.data !== null && cache.fetchedAt !== null && Date.now() - cache.fetchedAt < CACHE_TTL_MS
  );
}

/**
 * Parses the raw NASA SVS API response into a normalised metadata object.
 * @param {Object} raw - Raw JSON from the NASA SVS API
 * @returns {Object} Normalised metadata
 */
function parseApiResponse(raw) {
  // The SVS API returns an object with fields like title, description, credits, media_groups, etc.
  const title = raw.title || 'Moon 3D Models for Web, AR, and Animation';
  const description = raw.description || raw.summary || '';
  const credits = raw.credits || '';
  const releaseDate = raw.release_date || raw.date_published || null;

  // Collect media files — GLB model and preview images
  const glbFiles = [];
  const previewImages = [];

  const mediaGroups = Array.isArray(raw.media_groups) ? raw.media_groups : [];
  mediaGroups.forEach(group => {
    const items = Array.isArray(group.media) ? group.media : [];
    items.forEach(item => {
      const url = item.uri || item.url || '';
      if (url.toLowerCase().endsWith('.glb')) {
        glbFiles.push({
          url,
          label: item.description || item.title || path.basename(url),
          size: item.file_size || null,
        });
      } else if (/\.(jpg|jpeg|png|webp)$/i.test(url)) {
        previewImages.push({
          url,
          label: item.description || item.title || path.basename(url),
          width: item.width || null,
          height: item.height || null,
        });
      }
    });
  });

  // Fallback: well-known GLB URL from the NASA SVS page
  if (glbFiles.length === 0) {
    glbFiles.push({
      url: 'https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Flat.glb',
      label: 'Moon_NASA_LRO_8k_Flat.glb',
      size: null,
    });
  }

  return {
    title,
    description,
    credits,
    releaseDate,
    sourceUrl: 'https://svs.gsfc.nasa.gov/14959',
    apiUrl: NASA_SVS_API_URL,
    glbFiles,
    previewImages,
  };
}

/**
 * Fetches metadata from the NASA SVS API. Uses the in-memory cache when valid.
 * Falls back gracefully if the API is unreachable.
 * @returns {Promise<Object>} Normalised metadata
 */
async function fetchMoonMetadata() {
  if (isCacheValid()) {
    return cache.data;
  }

  try {
    const response = await fetch(NASA_SVS_API_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000), // 10-second timeout
    });

    if (!response.ok) {
      throw new Error(`NASA SVS API returned HTTP ${response.status}`);
    }

    const raw = await response.json();
    const data = parseApiResponse(raw);

    cache = { data, fetchedAt: Date.now() };
    logger.info('NASA SVS: metadata fetched and cached');
    return data;
  } catch (err) {
    logger.warn(`NASA SVS: API fetch failed — ${err.message}`);

    // Return cached data even if stale, or sensible defaults
    if (cache.data) {
      logger.info('NASA SVS: returning stale cached data');
      return cache.data;
    }

    return {
      title: 'Moon 3D Models for Web, AR, and Animation',
      description:
        'A 3D model of the Moon derived from NASA Lunar Reconnaissance Orbiter data, available for web, AR, and animation use.',
      credits: 'NASA Scientific Visualization Studio / NASA LRO',
      releaseDate: null,
      sourceUrl: 'https://svs.gsfc.nasa.gov/14959',
      apiUrl: NASA_SVS_API_URL,
      glbFiles: [
        {
          url: 'https://svs.gsfc.nasa.gov/vis/a010000/a014900/a014959/Moon_NASA_LRO_8k_Flat.glb',
          label: 'Moon_NASA_LRO_8k_Flat.glb',
          size: null,
        },
      ],
      previewImages: [],
      _fallback: true,
    };
  }
}

/**
 * Returns the cache status — useful for the status endpoint.
 * @returns {{ cached: boolean, cacheAgeMs: number|null, cacheTtlMs: number }}
 */
function getCacheStatus() {
  return {
    cached: cache.data !== null,
    cacheAgeMs: cache.fetchedAt !== null ? Date.now() - cache.fetchedAt : null,
    cacheTtlMs: CACHE_TTL_MS,
  };
}

/**
 * Scans the local drop folder for .glb files.
 * @returns {{ present: boolean, files: string[] }}
 */
function getLocalGlbStatus() {
  try {
    const entries = fs.readdirSync(LOCAL_GLB_DIR);
    const glbFiles = entries.filter(f => f.toLowerCase().endsWith('.glb'));
    return { present: glbFiles.length > 0, files: glbFiles };
  } catch {
    return { present: false, files: [] };
  }
}

/**
 * Checks whether the NASA SVS API is currently reachable.
 * Makes a lightweight HEAD request (falls back to GET).
 * @returns {Promise<boolean>}
 */
async function checkApiReachable() {
  try {
    const response = await fetch(NASA_SVS_API_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    try {
      const response = await fetch(NASA_SVS_API_URL, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

module.exports = {
  fetchMoonMetadata,
  getLocalGlbStatus,
  getCacheStatus,
  checkApiReachable,
};
