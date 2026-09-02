/**
 * Pexels API Service
 * Integrates Pexels stock photo API for EventFlow
 * Used for category images, hero banners, and other site content
 * Suppliers still upload their own profile and package photos
 *
 * Features smart fallback system:
 * - Primary: Fetch from Pexels API (user collections)
 * - Fallback: Use hardcoded curated URLs when API unavailable
 * - Graceful degradation with no broken images
 */

'use strict';

const https = require('https');
const logger = require('./logger');
const { getRandomFallbackPhotos, getRandomFallbackVideos } = require('../config/pexels-fallback');

class PexelsService {
  constructor(apiKey) {
    // Store explicit API key if provided, otherwise read dynamically from env
    this.explicitApiKey = apiKey;
    this.baseUrl = 'api.pexels.com';

    // In-memory cache for responses
    this.cache = new Map();
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
    this.maxCacheSize = 500; // Maximum number of cache entries

    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      threshold: 5, // Open circuit after 5 consecutive failures
      timeout: 60000, // 1 minute cooldown
      state: 'closed', // closed, open, half-open
      nextRetry: null,
    };

    // Metrics tracking
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalResponseTime: 0,
    };

    // Request deduplication map (prevents cache stampede)
    this.pendingRequests = new Map();

    // Start periodic cache cleanup
    this.startCacheCleanup();

    if (!this.getApiKey()) {
      logger.warn('⚠️  Pexels API key not configured. Stock photo features will be disabled.');
    }
  }

  /**
   * Start periodic cache cleanup to prevent memory leaks
   * Runs every 15 minutes to remove expired entries
   */
  startCacheCleanup() {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanExpiredCache();
      },
      15 * 60 * 1000
    ); // Every 15 minutes
    // Allow the process to exit even if this timer is still active
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean expired cache entries
   */
  cleanExpiredCache() {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.info(`🗑️  Cleaned ${removedCount} expired cache entries`);
    }
  }

  /**
   * Stop cache cleanup (for testing/shutdown)
   */
  stopCacheCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get API key - reads dynamically from environment if not explicitly set
   * This allows the API key to be updated without restarting the application
   */
  getApiKey() {
    return this.explicitApiKey || process.env.PEXELS_API_KEY;
  }

  /**
   * Check if Pexels API is configured
   */
  isConfigured() {
    return !!this.getApiKey();
  }

  /**
   * Get cached response if available and not expired
   * @param {string} cacheKey - Cache key
   * @returns {Object|null} Cached response or null
   */
  getCachedResponse(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      this.metrics.cacheMisses++;
      return null;
    }

    const now = Date.now();
    if (now > cached.expiresAt) {
      // Expired, remove from cache
      this.cache.delete(cacheKey);
      this.metrics.cacheMisses++;
      return null;
    }

    this.metrics.cacheHits++;
    logger.info(`💾 Cache hit for: ${cacheKey}`);
    return cached.data;
  }

  /**
   * Store response in cache
   * @param {string} cacheKey - Cache key
   * @param {Object} data - Response data
   */
  setCachedResponse(cacheKey, data) {
    // Enforce max cache size (LRU-style eviction)
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entry (first one in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        logger.info(`💾 Cache full, evicted oldest entry: ${firstKey}`);
      }
    }

    const now = Date.now();
    this.cache.set(cacheKey, {
      data,
      expiresAt: now + this.cacheTTL,
      createdAt: now,
    });
    logger.info(`💾 Cached response for: ${cacheKey} (TTL: ${this.cacheTTL / 1000}s)`);
  }

  /**
   * Clear all cached responses
   */
  clearCache() {
    const size = this.cache.size;
    this.cache.clear();
    this.pendingRequests.clear(); // Also clear pending requests
    logger.info(`🗑️  Cleared ${size} cached responses`);
  }

  /**
   * Check circuit breaker state
   * @returns {boolean} True if circuit is open
   */
  isCircuitOpen() {
    if (this.circuitBreaker.state === 'open') {
      const now = Date.now();
      if (now > this.circuitBreaker.nextRetry) {
        // Transition to half-open state
        this.circuitBreaker.state = 'half-open';
        logger.info('🔄 Circuit breaker transitioning to half-open state');
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record successful request
   */
  recordSuccess() {
    this.metrics.successfulRequests++;
    if (this.circuitBreaker.state === 'half-open') {
      // Reset circuit breaker on success in half-open state
      this.circuitBreaker.state = 'closed';
      this.circuitBreaker.failures = 0;
      logger.info('✅ Circuit breaker reset to closed state');
    } else if (this.circuitBreaker.state === 'closed') {
      // Reset failure count completely on success
      this.circuitBreaker.failures = 0;
    }
  }

  /**
   * Record failed request
   */
  recordFailure() {
    this.metrics.failedRequests++;
    this.circuitBreaker.failures++;

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      // Open circuit breaker
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextRetry = Date.now() + this.circuitBreaker.timeout;
      logger.error(
        `🚨 Circuit breaker opened after ${this.circuitBreaker.failures} failures (cooldown: ${this.circuitBreaker.timeout / 1000}s)`
      );
    }
  }

  /**
   * Get service metrics
   * @returns {Object} Service metrics
   */
  getMetrics() {
    const totalRequests = this.metrics.totalRequests;
    const avgResponseTime =
      this.metrics.successfulRequests > 0
        ? Math.round(this.metrics.totalResponseTime / this.metrics.successfulRequests)
        : 0;

    return {
      totalRequests: this.metrics.totalRequests,
      successfulRequests: this.metrics.successfulRequests,
      failedRequests: this.metrics.failedRequests,
      successRate:
        totalRequests > 0
          ? `${((this.metrics.successfulRequests / totalRequests) * 100).toFixed(2)}%`
          : 'N/A',
      cacheHits: this.metrics.cacheHits,
      cacheMisses: this.metrics.cacheMisses,
      cacheHitRate:
        this.metrics.cacheHits + this.metrics.cacheMisses > 0
          ? `${(
              (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) *
              100
            ).toFixed(2)}%`
          : 'N/A',
      avgResponseTime: `${avgResponseTime}ms`,
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
        threshold: this.circuitBreaker.threshold,
      },
    };
  }

  /**
   * Validate response schema for photos
   * @param {Object} photo - Photo object from API
   * @returns {Object} Validation result
   */
  validatePhotoSchema(photo) {
    const errors = [];
    const required = ['id', 'width', 'height', 'url', 'photographer', 'src'];
    const srcRequired = ['original', 'large', 'medium', 'small'];

    // Check required fields
    required.forEach(field => {
      if (!(field in photo)) {
        errors.push(`Missing required field: ${field}`);
      }
    });

    // Check src fields
    if (photo.src) {
      srcRequired.forEach(field => {
        if (!(field in photo.src)) {
          errors.push(`Missing required src field: src.${field}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Make HTTPS request to Pexels API with retry logic and request deduplication
   * @param {string} path - API endpoint path
   * @param {number} retryCount - Current retry attempt (default: 0)
   * @param {number} maxRetries - Maximum retry attempts (default: 3)
   * @param {string} cacheKey - Optional cache key for request deduplication
   */
  async makeRequest(path, retryCount = 0, maxRetries = 3, cacheKey = null) {
    // Request deduplication: if same request is in flight, wait for it
    if (cacheKey && this.pendingRequests.has(cacheKey)) {
      logger.info(`⏳ Request already in flight, waiting: ${cacheKey}`);
      return await this.pendingRequests.get(cacheKey);
    }

    this.metrics.totalRequests++;

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      const error = new Error('Circuit breaker is open - service temporarily unavailable');
      error.type = 'circuit_breaker';
      error.statusCode = 503;
      error.userFriendlyMessage =
        'Pexels API is temporarily unavailable due to repeated failures. Please try again later.';
      throw error;
    }

    // Create request promise
    const requestPromise = new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path: path,
        method: 'GET',
        headers: {
          Authorization: this.getApiKey(),
          'User-Agent': 'EventFlow/5.2.0 (https://github.com/rhysllwydlewis/eventflow)',
        },
        timeout: 10000, // 10 second timeout
      };

      logger.info(
        `🌐 Pexels API Request: GET ${path} (attempt ${retryCount + 1}/${maxRetries + 1})`
      );
      const startTime = Date.now();

      const req = https.request(options, res => {
        let data = '';
        const duration = Date.now() - startTime;

        // Parse rate limit headers
        const rateLimit = {
          remaining: res.headers['x-ratelimit-remaining'],
          limit: res.headers['x-ratelimit-limit'],
          reset: res.headers['x-ratelimit-reset'],
        };

        logger.info(`📊 Pexels API Response: ${res.statusCode} (${duration}ms)`);
        if (rateLimit.remaining) {
          logger.info(
            `⏱️  Rate Limit: ${rateLimit.remaining}/${rateLimit.limit} remaining (resets: ${rateLimit.reset})`
          );
        }

        res.on('data', chunk => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsedData = JSON.parse(data);

              // Debug: Log response structure to track schema
              if (process.env.PEXELS_DEBUG === 'true') {
                logger.info('🔍 [DEBUG] Pexels API Response Structure:', {
                  endpoint: path,
                  hasPhotos: !!parsedData.photos,
                  hasMedia: !!parsedData.media,
                  hasVideos: !!parsedData.videos,
                  sampleKeys: parsedData.photos?.[0]
                    ? Object.keys(parsedData.photos[0])
                    : parsedData.media?.[0]
                      ? Object.keys(parsedData.media[0])
                      : parsedData.videos?.[0]
                        ? Object.keys(parsedData.videos[0])
                        : 'N/A',
                });

                // Validate schema for photos
                if (parsedData.photos && parsedData.photos[0]) {
                  const validation = this.validatePhotoSchema(parsedData.photos[0]);
                  if (!validation.valid) {
                    logger.warn('⚠️  [DEBUG] Schema validation warnings:', validation.errors);
                  } else {
                    logger.info('✅ [DEBUG] Schema validation passed');
                  }
                }
              }

              // Record success and response time (only for successful requests)
              this.metrics.totalResponseTime += duration;
              this.recordSuccess();

              // Include rate limit info in response
              resolve({
                data: parsedData,
                rateLimit,
              });
            } catch (e) {
              logger.error('❌ Failed to parse Pexels API response:', e.message);
              logger.error('📝 Raw response data (first 200 chars):', data.substring(0, 200));

              this.recordFailure();

              const error = new Error(`Failed to parse response: ${e.message}`);
              error.type = 'parse_error';
              error.userFriendlyMessage =
                'Received invalid response from Pexels API. Please try again.';
              reject(error);
            }
          } else {
            // Enhanced error messages based on status code with categorization
            let errorMessage = `Pexels API error: ${res.statusCode}`;
            let errorType = 'unknown';
            let errorDetails = data;
            let userFriendlyMessage = 'Unable to fetch images from Pexels. Please try again later.';
            let shouldRetry = false;

            try {
              const errorData = JSON.parse(data);
              errorDetails = errorData.error || errorData.message || data;
            } catch (e) {
              // Keep raw data if not JSON
            }

            if (res.statusCode === 401) {
              errorType = 'authentication';
              errorMessage = 'Unauthorized: Invalid API key';
              userFriendlyMessage =
                'API authentication failed. Please check your API key configuration.';
              logger.error('❌ Pexels API: Invalid API key');
              logger.error('💡 Hint: Verify PEXELS_API_KEY environment variable is set correctly');
            } else if (res.statusCode === 403) {
              errorType = 'authentication';
              errorMessage = 'Forbidden: API key lacks required permissions';
              userFriendlyMessage =
                'API key lacks necessary permissions. Please check your Pexels account settings.';
              logger.error('❌ Pexels API: Insufficient permissions');
              logger.error('💡 Hint: Check if your API key has access to collections endpoint');
            } else if (res.statusCode === 404) {
              errorType = 'not_found';
              errorMessage = 'Not Found: Resource does not exist';
              userFriendlyMessage =
                'The requested resource was not found. Please verify the collection ID or search query.';
              logger.error('❌ Pexels API: Resource not found');
              logger.error(
                '💡 Hint: Verify collection IDs and ensure they exist in your Pexels account'
              );
            } else if (res.statusCode === 429) {
              errorType = 'rate_limit';
              errorMessage = 'Rate Limit Exceeded: Too many requests';
              userFriendlyMessage = 'API rate limit exceeded. Please try again later.';
              shouldRetry = true; // Retry on rate limit
              logger.error(`❌ Pexels API: Rate limit exceeded (resets: ${rateLimit.reset})`);
              logger.error('💡 Hint: Consider implementing caching or reducing API call frequency');
            } else if (res.statusCode >= 500) {
              errorType = 'server_error';
              errorMessage = 'Server Error: Pexels API is experiencing issues';
              userFriendlyMessage =
                'Pexels API is temporarily unavailable. Fallback images will be used.';
              shouldRetry = true; // Retry on server errors
              logger.error('❌ Pexels API: Server error');
              logger.error(
                '💡 Hint: This is a Pexels service issue, fallback mechanism should activate'
              );
            }

            logger.error(`📝 Error details: ${errorDetails}`);
            logger.error(`🔖 Error type: ${errorType}`);

            this.recordFailure();

            // Retry logic for transient errors
            if (shouldRetry && retryCount < maxRetries) {
              const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10s
              logger.info(`🔄 Retrying in ${backoffTime}ms...`);

              setTimeout(async () => {
                try {
                  const result = await this.makeRequest(path, retryCount + 1, maxRetries);
                  resolve(result);
                } catch (retryError) {
                  reject(retryError);
                }
              }, backoffTime);
              return;
            }

            const error = new Error(`${errorMessage} - ${errorDetails}`);
            error.type = errorType;
            error.statusCode = res.statusCode;
            error.userFriendlyMessage = userFriendlyMessage;
            reject(error);
          }
        });
      });

      req.on('error', error => {
        logger.error('❌ Pexels API request error:', error.message);
        logger.error('💡 Hint: Check network connectivity and DNS resolution');

        this.recordFailure();

        // Retry on network errors
        if (retryCount < maxRetries) {
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
          logger.info(`🔄 Retrying in ${backoffTime}ms...`);

          setTimeout(async () => {
            try {
              const result = await this.makeRequest(path, retryCount + 1, maxRetries);
              resolve(result);
            } catch (retryError) {
              // On final retry failure, reject with the retry error
              reject(retryError);
            }
          }, backoffTime);
          return;
        }

        // Max retries exhausted, create final error
        const enhancedError = new Error(`Network error: ${error.message}`);
        enhancedError.type = 'network';
        enhancedError.originalError = error;
        enhancedError.userFriendlyMessage =
          'Unable to connect to Pexels API. Please check your network connection.';
        reject(enhancedError);
      });

      req.on('timeout', () => {
        req.destroy();
        logger.error('❌ Pexels API request timeout (10s)');
        logger.error('💡 Hint: Consider increasing timeout or checking API responsiveness');

        this.recordFailure();

        // Retry on timeout
        if (retryCount < maxRetries) {
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 10000);
          logger.info(`🔄 Retrying in ${backoffTime}ms...`);

          setTimeout(async () => {
            try {
              const result = await this.makeRequest(path, retryCount + 1, maxRetries);
              resolve(result);
            } catch (retryError) {
              // On final retry failure, reject with the retry error
              reject(retryError);
            }
          }, backoffTime);
          return;
        }

        // Max retries exhausted, create final error
        const error = new Error('Request timeout after 10 seconds');
        error.type = 'timeout';
        error.userFriendlyMessage = 'Request to Pexels API timed out. Please try again.';
        reject(error);
      });

      req.end();
    });

    // Store pending request to prevent duplicate requests
    if (cacheKey) {
      this.pendingRequests.set(cacheKey, requestPromise);
      requestPromise
        .finally(() => {
          // Remove from pending requests when done
          this.pendingRequests.delete(cacheKey);
        })
        .catch(() => {
          // Ignore errors here, they're handled by caller
        });
    }

    return requestPromise;
  }

  /**
   * Search for photos by query
   * @param {string} query - Search term (e.g., "wedding", "catering", "venue")
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @param {Object} filters - Optional filters (orientation, size, color, locale)
   * @returns {Promise<Object>} Search results with photos array
   *
   * Expected API Response Schema (from Pexels API v1):
   * {
   *   page: number,
   *   per_page: number,
   *   photos: [{
   *     id: number,
   *     width: number,
   *     height: number,
   *     url: string,
   *     photographer: string,
   *     photographer_url: string,
   *     photographer_id: number,
   *     avg_color: string,
   *     src: {
   *       original: string,
   *       large2x: string,
   *       large: string,
   *       medium: string,
   *       small: string,
   *       portrait: string,
   *       landscape: string,
   *       tiny: string
   *     },
   *     liked: boolean,
   *     alt: string
   *   }],
   *   total_results: number,
   *   next_page: string,
   *   prev_page: string
   * }
   */
  async searchPhotos(query, perPage = 15, page = 1, filters = {}) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Validate input
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Invalid query: must be a non-empty string');
    }

    // Build cache key
    const cacheKey = `search:${query}:${perPage}:${page}:${JSON.stringify(filters)}`;

    // Check cache first
    const cached = this.getCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }

    // Build query parameters
    let path = `/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;

    // Add optional filters
    if (filters.orientation) {
      path += `&orientation=${encodeURIComponent(filters.orientation)}`;
    }
    if (filters.size) {
      path += `&size=${encodeURIComponent(filters.size)}`;
    }
    if (filters.color) {
      path += `&color=${encodeURIComponent(filters.color)}`;
    }
    if (filters.locale) {
      path += `&locale=${encodeURIComponent(filters.locale)}`;
    }

    const response = await this.makeRequest(path, 0, 3, cacheKey);
    const data = response.data;

    // Transform response to include only relevant fields with null safety
    const result = {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      photos: (data.photos || []).map(photo => ({
        id: photo.id,
        width: photo.width,
        height: photo.height,
        url: photo.url,
        photographer: photo.photographer,
        photographerUrl: photo.photographer_url,
        avgColor: photo.avg_color,
        src: {
          original: photo.src?.original || '',
          large2x: photo.src?.large2x || '',
          large: photo.src?.large || '',
          medium: photo.src?.medium || '',
          small: photo.src?.small || '',
          portrait: photo.src?.portrait || '',
          landscape: photo.src?.landscape || '',
          tiny: photo.src?.tiny || '',
        },
        alt: photo.alt || query,
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };

    // Cache the result
    this.setCachedResponse(cacheKey, result);

    return result;
  }

  /**
   * Get curated photos (editor's picks)
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Curated photos
   */
  async getCuratedPhotos(perPage = 15, page = 1) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Build cache key
    const cacheKey = `curated:${perPage}:${page}`;

    // Check cache first
    const cached = this.getCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }

    const path = `/v1/curated?per_page=${perPage}&page=${page}`;
    const response = await this.makeRequest(path, 0, 3, cacheKey);
    const data = response.data;

    const result = {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      photos: (data.photos || []).map(photo => ({
        id: photo.id,
        width: photo.width,
        height: photo.height,
        url: photo.url,
        photographer: photo.photographer,
        photographerUrl: photo.photographer_url,
        avgColor: photo.avg_color,
        src: {
          original: photo.src?.original || '',
          large2x: photo.src?.large2x || '',
          large: photo.src?.large || '',
          medium: photo.src?.medium || '',
          small: photo.src?.small || '',
          portrait: photo.src?.portrait || '',
          landscape: photo.src?.landscape || '',
          tiny: photo.src?.tiny || '',
        },
        alt: photo.alt || 'Curated photo',
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };

    // Cache the result
    this.setCachedResponse(cacheKey, result);

    return result;
  }

  /**
   * Get photo by ID
   * @param {number} id - Photo ID
   * @returns {Promise<Object>} Photo details
   */
  async getPhotoById(id) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Validate ID - must be positive integer
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) {
      throw new Error('Invalid photo ID: must be a positive integer');
    }

    const path = `/v1/photos/${id}`;
    const response = await this.makeRequest(path);
    const photo = response.data;

    return {
      id: photo.id,
      width: photo.width,
      height: photo.height,
      url: photo.url,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      avgColor: photo.avg_color,
      src: {
        original: photo.src?.original || '',
        large2x: photo.src?.large2x || '',
        large: photo.src?.large || '',
        medium: photo.src?.medium || '',
        small: photo.src?.small || '',
        portrait: photo.src?.portrait || '',
        landscape: photo.src?.landscape || '',
        tiny: photo.src?.tiny || '',
      },
      alt: photo.alt || 'Photo',
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Search for videos by query
   * @param {string} query - Search term (e.g., "wedding", "celebration")
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @param {Object} filters - Optional filters (orientation, size, locale)
   * @returns {Promise<Object>} Search results with videos array
   */
  async searchVideos(query, perPage = 15, page = 1, filters = {}) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Validate input
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Invalid query: must be a non-empty string');
    }

    // Build query parameters
    let path = `/v1/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;

    // Add optional filters
    if (filters.orientation) {
      path += `&orientation=${encodeURIComponent(filters.orientation)}`;
    }
    if (filters.size) {
      path += `&size=${encodeURIComponent(filters.size)}`;
    }
    if (filters.locale) {
      path += `&locale=${encodeURIComponent(filters.locale)}`;
    }

    const response = await this.makeRequest(path);
    const data = response.data;

    // Transform response to include relevant fields
    return {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      videos: (data.videos || []).map(video => ({
        id: video.id,
        width: video.width,
        height: video.height,
        url: video.url,
        image: video.image,
        duration: video.duration,
        user: {
          id: video.user?.id,
          name: video.user?.name,
          url: video.user?.url,
        },
        videoFiles: (video.video_files || []).map(file => ({
          id: file.id,
          quality: file.quality,
          fileType: file.file_type,
          width: file.width,
          height: file.height,
          link: file.link,
        })),
        videoPictures: (video.video_pictures || []).map(pic => ({
          id: pic.id,
          picture: pic.picture,
          nr: pic.nr,
        })),
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Get popular videos
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Popular videos
   */
  async getPopularVideos(perPage = 15, page = 1) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    const path = `/v1/videos/popular?per_page=${perPage}&page=${page}`;
    const response = await this.makeRequest(path);
    const data = response.data;

    return {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      videos: (data.videos || []).map(video => ({
        id: video.id,
        width: video.width,
        height: video.height,
        url: video.url,
        image: video.image,
        duration: video.duration,
        user: {
          id: video.user?.id,
          name: video.user?.name,
          url: video.user?.url,
        },
        videoFiles: (video.video_files || []).map(file => ({
          id: file.id,
          quality: file.quality,
          fileType: file.file_type,
          width: file.width,
          height: file.height,
          link: file.link,
        })),
        videoPictures: (video.video_pictures || []).map(pic => ({
          id: pic.id,
          picture: pic.picture,
          nr: pic.nr,
        })),
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Get video by ID
   * @param {number} id - Video ID
   * @returns {Promise<Object>} Video details
   */
  async getVideoById(id) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Validate ID
    if (!id || isNaN(id) || id <= 0) {
      throw new Error('Invalid video ID: must be a positive number');
    }

    const path = `/v1/videos/${id}`;
    const response = await this.makeRequest(path);
    const video = response.data;

    return {
      id: video.id,
      width: video.width,
      height: video.height,
      url: video.url,
      image: video.image,
      duration: video.duration,
      user: {
        id: video.user?.id,
        name: video.user?.name,
        url: video.user?.url,
      },
      videoFiles: (video.video_files || []).map(file => ({
        id: file.id,
        quality: file.quality,
        fileType: file.file_type,
        width: file.width,
        height: file.height,
        link: file.link,
      })),
      videoPictures: (video.video_pictures || []).map(pic => ({
        id: pic.id,
        picture: pic.picture,
        nr: pic.nr,
      })),
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Get featured collections
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} Featured collections
   */
  async getFeaturedCollections(perPage = 15, page = 1) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    const path = `/v1/collections/featured?per_page=${perPage}&page=${page}`;
    const response = await this.makeRequest(path);
    const data = response.data;

    return {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      collections: data.collections.map(collection => ({
        id: collection.id,
        title: collection.title,
        description: collection.description,
        private: collection.private,
        mediaCount: collection.media_count,
        photosCount: collection.photos_count,
        videosCount: collection.videos_count,
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Get user's collections (requires auth)
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @returns {Promise<Object>} User collections
   */
  async getUserCollections(perPage = 15, page = 1) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    const path = `/v1/collections?per_page=${perPage}&page=${page}`;
    const response = await this.makeRequest(path);
    const data = response.data;

    return {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      collections: data.collections.map(collection => ({
        id: collection.id,
        title: collection.title,
        description: collection.description,
        private: collection.private,
        mediaCount: collection.media_count,
        photosCount: collection.photos_count,
        videosCount: collection.videos_count,
      })),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Get media from a collection
   * @param {string} id - Collection ID
   * @param {number} perPage - Number of results per page (default: 15, max: 80)
   * @param {number} page - Page number (default: 1)
   * @param {string} type - Media type filter ('photos', 'videos', or undefined for all)
   * @returns {Promise<Object>} Collection media
   *
   * Expected API Response Schema (from Pexels API v1):
   * {
   *   page: number,
   *   per_page: number,
   *   total_results: number,
   *   id: string,
   *   media: [{
   *     type: 'Photo' | 'Video',
   *     id: number,
   *     width: number,
   *     height: number,
   *     url: string,
   *     photographer: string (for photos),
   *     photographer_url: string (for photos),
   *     avg_color: string (for photos),
   *     src: object (for photos),
   *     alt: string (for photos),
   *     user: object (for videos),
   *     video_files: array (for videos),
   *     video_pictures: array (for videos)
   *   }],
   *   next_page: string,
   *   prev_page: string
   * }
   */
  async getCollectionMedia(id, perPage = 15, page = 1, type) {
    if (!this.isConfigured()) {
      throw new Error('Pexels API key not configured');
    }

    // Validate ID
    if (!id || (typeof id !== 'string' && typeof id !== 'number')) {
      throw new Error('Invalid collection ID');
    }

    let path = `/v1/collections/${id}?per_page=${perPage}&page=${page}`;
    if (type) {
      path += `&type=${encodeURIComponent(type)}`;
    }

    const response = await this.makeRequest(path);
    const data = response.data;

    return {
      page: data.page,
      perPage: data.per_page,
      totalResults: data.total_results,
      id: data.id,
      media: data.media.map(item => {
        if (item.type === 'Photo') {
          return {
            type: 'Photo',
            id: item.id,
            width: item.width,
            height: item.height,
            url: item.url,
            photographer: item.photographer,
            photographerUrl: item.photographer_url,
            avgColor: item.avg_color,
            src: item.src || {},
            alt: item.alt,
          };
        } else if (item.type === 'Video') {
          return {
            type: 'Video',
            id: item.id,
            width: item.width,
            height: item.height,
            url: item.url,
            image: item.image,
            duration: item.duration,
            user: item.user || {},
            videoFiles: item.video_files || [],
            videoPictures: item.video_pictures || [],
          };
        }

        // Unknown type - log warning and return raw item
        logger.warn(`⚠️  Unknown media type in collection: ${item.type}`);
        return item;
      }),
      nextPage: data.next_page,
      prevPage: data.prev_page,
      rateLimit: response.rateLimit,
    };
  }

  /**
   * Test Pexels API connection and validate API key
   * @returns {Promise<{success: boolean, message: string, details?: Object}>}
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Pexels API key not configured',
        details: {
          configured: false,
          error: 'PEXELS_API_KEY environment variable not set',
        },
      };
    }

    try {
      logger.info('🔍 Testing Pexels API connection...');
      const startTime = Date.now();

      // Make a minimal request to test the API key
      // Use a common search term that's likely to have results
      const testResult = await this.searchPhotos('nature', 1, 1);

      const duration = Date.now() - startTime;
      logger.info(`✅ Pexels API connection successful (${duration}ms)`);

      return {
        success: true,
        message: 'Pexels API is configured and working',
        details: {
          configured: true,
          responseTime: duration,
          totalResults: testResult.totalResults,
          apiVersion: 'v1',
          rateLimit: testResult.rateLimit,
        },
      };
    } catch (error) {
      logger.error('❌ Pexels API connection failed:', error.message);

      // Parse error to provide helpful feedback
      let message = 'Pexels API connection failed';
      let errorType = 'unknown';

      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        message = 'Invalid API key. Please check your PEXELS_API_KEY';
        errorType = 'authentication';
      } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
        message = 'API key lacks required permissions';
        errorType = 'authentication';
      } else if (error.message.includes('429') || error.message.includes('Rate Limit')) {
        message = 'Rate limit exceeded. Please try again later';
        errorType = 'rate_limit';
      } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        message = 'Connection timeout. Pexels API may be unreachable';
        errorType = 'timeout';
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        message = 'Cannot reach Pexels API. Check network connection';
        errorType = 'network';
      }

      return {
        success: false,
        message,
        details: {
          configured: true,
          error: error.message,
          errorType,
        },
      };
    }
  }

  /**
   * Get suggested category search queries
   * @returns {Array<Object>} Category suggestions with search terms
   */
  static getCategorySuggestions() {
    return [
      { category: 'Venues', query: 'wedding venue elegant hall', icon: '🏛️' },
      { category: 'Catering', query: 'catering food buffet elegant', icon: '🍽️' },
      { category: 'Photography', query: 'wedding photography camera professional', icon: '📸' },
      { category: 'Entertainment', query: 'live band music event entertainment', icon: '🎵' },
      { category: 'Flowers & décor', query: 'wedding flowers decoration elegant', icon: '💐' },
      { category: 'Transport', query: 'luxury car wedding transport', icon: '🚗' },
      { category: 'Extras & add-ons', query: 'event planning decoration details', icon: '✨' },
    ];
  }

  /**
   * Smart fetch photos with automatic fallback
   * Tries API first, falls back to hardcoded URLs if API fails
   * @param {number} count - Number of photos to fetch
   * @returns {Promise<{photos: Array, mode: string, fromCache: boolean}>}
   */
  async getPhotosWithFallback(count = 15) {
    // Try API if configured
    if (this.isConfigured()) {
      try {
        logger.info('🔍 Attempting to fetch photos from Pexels API...');
        const result = await this.searchPhotos('wedding', count, 1);
        logger.info(`✅ Successfully fetched ${result.photos.length} photos from API`);
        return {
          photos: result.photos,
          mode: 'api',
          fromCache: false,
        };
      } catch (error) {
        logger.warn(`⚠️  Pexels API failed: ${error.message}, falling back to hardcoded URLs`);
      }
    } else {
      logger.info('ℹ️  Pexels API not configured, using fallback URLs');
    }

    // Fallback to hardcoded URLs
    const fallbackPhotos = getRandomFallbackPhotos(count);
    logger.info(`📦 Using ${fallbackPhotos.length} fallback photos`);
    return {
      photos: fallbackPhotos,
      mode: 'fallback',
      fromCache: false,
    };
  }

  /**
   * Smart fetch videos with automatic fallback
   * Tries API first, falls back to hardcoded URLs if API fails
   * @param {number} count - Number of videos to fetch
   * @returns {Promise<{videos: Array, mode: string, fromCache: boolean}>}
   */
  async getVideosWithFallback(count = 8) {
    // Try API if configured
    if (this.isConfigured()) {
      try {
        logger.info('🔍 Attempting to fetch videos from Pexels API...');
        const result = await this.searchVideos('wedding', count, 1);
        logger.info(`✅ Successfully fetched ${result.videos.length} videos from API`);
        return {
          videos: result.videos,
          mode: 'api',
          fromCache: false,
        };
      } catch (error) {
        logger.warn(`⚠️  Pexels API failed: ${error.message}, falling back to hardcoded URLs`);
      }
    } else {
      logger.info('ℹ️  Pexels API not configured, using fallback URLs');
    }

    // Fallback to hardcoded URLs
    const fallbackVideos = getRandomFallbackVideos(count);
    logger.info(`📦 Using ${fallbackVideos.length} fallback videos`);
    return {
      videos: fallbackVideos,
      mode: 'fallback',
      fromCache: false,
    };
  }

  /**
   * Get photos from user's collection with fallback
   * @param {string} collectionId - Collection ID (e.g., 'xkpfayt')
   * @param {number} count - Number of photos to fetch
   * @returns {Promise<{photos: Array, mode: string}>}
   */
  async getCollectionPhotosWithFallback(collectionId, count = 15) {
    // Try API if configured
    if (this.isConfigured()) {
      try {
        logger.info(`🔍 Attempting to fetch photos from collection ${collectionId}...`);
        const result = await this.getCollectionMedia(collectionId, count, 1, 'photos');
        const photos = result.media.filter(item => item.type === 'Photo');
        logger.info(`✅ Successfully fetched ${photos.length} photos from collection`);
        return {
          photos,
          mode: 'api',
          collectionId,
        };
      } catch (error) {
        logger.warn(
          `⚠️  Failed to fetch collection ${collectionId}: ${error.message}, using fallback`
        );
      }
    }

    // Fallback to hardcoded URLs
    const fallbackPhotos = getRandomFallbackPhotos(count);
    logger.info(`📦 Using ${fallbackPhotos.length} fallback photos (collection unavailable)`);
    return {
      photos: fallbackPhotos,
      mode: 'fallback',
      collectionId,
    };
  }
}

// Create singleton instance
let pexelsInstance = null;
let wasCreatedWithoutKey = false; // Track if instance was created without a key

function getPexelsService(apiKey) {
  const currentKey = apiKey || process.env.PEXELS_API_KEY;

  // If no instance exists, create one
  if (!pexelsInstance) {
    pexelsInstance = new PexelsService(currentKey);
    // Track if we created without any key (neither explicit nor env var)
    wasCreatedWithoutKey = !apiKey && !process.env.PEXELS_API_KEY;
    return pexelsInstance;
  }

  // If instance was created without a key but a key is now available, recreate
  if (wasCreatedWithoutKey && currentKey) {
    logger.info('🔄 Recreating Pexels service with newly available API key');
    pexelsInstance = new PexelsService(currentKey);
    wasCreatedWithoutKey = false;
  }

  return pexelsInstance;
}

module.exports = {
  PexelsService,
  getPexelsService,
};
