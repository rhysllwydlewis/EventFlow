/**
 * System Routes
 * Health checks, readiness probes, configuration, and metadata endpoints
 */

'use strict';

const express = require('express');
const { apiLimiter } = require('../middleware/rateLimits');
const router = express.Router();

// These will be injected by server.js during route mounting
let APP_VERSION;
let EMAIL_ENABLED;
let postmark;
let mongoDb;
let dbUnified;
let getToken;
let authLimiter;
let healthCheckLimiter;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('System routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'APP_VERSION',
    'EMAIL_ENABLED',
    'postmark',
    'mongoDb',
    'dbUnified',
    'getToken',
    'authLimiter',
    'healthCheckLimiter',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`System routes: missing required dependencies: ${missing.join(', ')}`);
  }

  APP_VERSION = deps.APP_VERSION;
  EMAIL_ENABLED = deps.EMAIL_ENABLED;
  postmark = deps.postmark;
  mongoDb = deps.mongoDb;
  dbUnified = deps.dbUnified;
  getToken = deps.getToken;
  authLimiter = deps.authLimiter;
  healthCheckLimiter = deps.healthCheckLimiter;
}

/**
 * Middleware wrapper that applies rate limiter if initialized
 * This allows the module to be loaded before dependencies are injected
 */
function applyAuthLimiter(req, res, next) {
  if (authLimiter) {
    return authLimiter(req, res, next);
  }
  next();
}

/**
 * Middleware wrapper that applies health check rate limiter if initialized
 * This allows the module to be loaded before dependencies are injected
 */
function applyHealthCheckLimiter(req, res, next) {
  if (healthCheckLimiter) {
    return healthCheckLimiter(req, res, next);
  }
  next();
}

function getIntegrationStatus() {
  let redisAdapterInstalled = false;
  try {
    // eslint-disable-next-line node/no-missing-require
    require.resolve('@socket.io/redis-adapter');
    redisAdapterInstalled = true;
  } catch (_error) {
    redisAdapterInstalled = false;
  }

  const sentryEnabled = !!process.env.SENTRY_DSN;
  const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
  const openAIEnabled = !!process.env.OPENAI_API_KEY;
  const redisConfigured = !!process.env.REDIS_URL;
  const mongoConfigured = !!process.env.MONGODB_URI;
  const jwtConfigured = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32;
  const baseUrlConfigured = !!process.env.BASE_URL && !process.env.BASE_URL.includes('localhost');

  return {
    sentry: sentryEnabled ? 'configured' : 'disabled',
    stripe: stripeEnabled ? 'configured' : 'disabled',
    openai: openAIEnabled ? 'configured' : 'disabled',
    redis: redisConfigured ? 'configured' : 'disabled',
    redisAdapter: redisAdapterInstalled ? 'installed' : 'not_installed',
    mongodbConfig: mongoConfigured ? 'configured' : 'missing',
    jwtSecret: jwtConfigured ? 'configured' : 'weak_or_missing',
    baseUrl: baseUrlConfigured ? 'configured' : 'invalid_or_missing',
  };
}

function getProductionGuardrails() {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    return { enabled: false, missingCritical: [] };
  }

  const missingCritical = [];
  if (!process.env.MONGODB_URI) {
    missingCritical.push('MONGODB_URI');
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  const knownWeakSecrets = new Set([
    '',
    'change_me',
    'your_super_long_random_secret',
    'your-secret-key-min-32-chars',
    'your-secret-key',
    'your_secret',
  ]);
  if (jwtSecret.length < 32 || knownWeakSecrets.has(jwtSecret)) {
    missingCritical.push('JWT_SECRET');
  }

  const baseUrl = process.env.BASE_URL || '';
  if (!baseUrl || baseUrl.includes('localhost')) {
    missingCritical.push('BASE_URL');
  }

  return {
    enabled: true,
    missingCritical,
  };
}

/**
 * GET /api/csrf-token
 * Get CSRF token for form submissions
 * Sets CSRF cookie and returns token in response
 */
router.get('/csrf-token', applyAuthLimiter, async (req, res) => {
  if (!getToken) {
    return res.status(503).json({ error: 'CSRF token service not initialized' });
  }
  const token = getToken(req, res);
  res.json({ csrfToken: token, token });
});

/**
 * GET /api/config
 * Client config endpoint - provides public configuration values
 * Uses general apiLimiter (100 req/15 min) rather than authLimiter (10 req/15 min)
 * because this endpoint is called on every page load by sentry-browser-init.js
 * and is a public read-only endpoint, not an authentication operation.
 * The endpoint is also cached for 5 minutes to reduce server load.
 */
router.get('/config', apiLimiter, async (req, res) => {
  if (!APP_VERSION) {
    return res.status(503).json({ error: 'Configuration service not initialized' });
  }

  // Set public caching headers (this endpoint is safe to cache)
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes

  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    version: APP_VERSION,
    sentryDsn: process.env.SENTRY_DSN_FRONTEND || '',
    altchaChallengeUrl: '/api/v1/altcha/challenge',
  });
});

/**
 * GET /api/meta
 * Application metadata endpoint
 */
router.get('/meta', async (_req, res) => {
  if (!APP_VERSION) {
    return res.status(503).json({ error: 'Metadata service not initialized' });
  }

  // Set public caching headers (this endpoint is safe to cache)
  res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes

  res.json({
    ok: true,
    version: APP_VERSION,
    node: process.version,
    env: process.env.NODE_ENV || 'development',
  });
});

/**
 * GET /api/health
 * Health check endpoint for monitoring
 * Returns 200 if server is running, with service status details
 * NOTE: Contains internal debug info - should NOT be cached
 * Optimized for fast response time (<100ms)
 */
router.get('/health', applyHealthCheckLimiter, async (_req, res) => {
  const startTime = Date.now();

  // Check if dependencies are initialized
  if (!mongoDb || !dbUnified || !postmark) {
    return res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check service dependencies not initialized',
      responseTime: Date.now() - startTime,
    });
  }

  // Do NOT cache - contains internal debug information
  res.setHeader('Cache-Control', 'no-store, private');

  // Server is always "ok" if it's running and accepting requests
  // Database status is reported as a service status, not overall health
  const timestamp = new Date().toISOString();

  // Determine email status (fast, no I/O)
  let emailStatus = 'disabled';
  if (EMAIL_ENABLED) {
    emailStatus = postmark.isPostmarkEnabled() ? 'postmark' : 'disabled';
  }

  // Initialize response with server status
  const response = {
    status: 'ok', // Always ok if server is running
    timestamp,
    services: {
      server: 'running',
    },
  };

  // Check MongoDB connection status (non-blocking, uses cached state)
  try {
    const mongoState = mongoDb.getConnectionState ? mongoDb.getConnectionState() : null;
    const mongoError = mongoDb.getConnectionError ? mongoDb.getConnectionError() : null;

    if (mongoState) {
      // Map MongoDB states to service status
      if (mongoState === 'connected') {
        response.services.mongodb = 'connected';
      } else if (mongoState === 'connecting') {
        response.services.mongodb = 'connecting';
        response.status = 'degraded'; // Server is degraded while DB is connecting
      } else if (mongoState === 'error') {
        response.services.mongodb = 'disconnected';
        response.status = 'degraded';
        if (mongoError) {
          // Sanitize error message in production to avoid leaking connection details
          if (process.env.NODE_ENV === 'production') {
            response.services.mongodbError = 'Database connection error';
          } else {
            response.services.mongodbError = mongoError;
          }
        }
      } else {
        response.services.mongodb = 'disconnected';
      }
    } else {
      // Fallback for older db.js without state tracking
      response.services.mongodb = mongoDb.isConnected() ? 'connected' : 'disconnected';
    }
  } catch (error) {
    // If MongoDB check fails, report it but still return healthy
    response.services.mongodb = 'unknown';
    // Sanitize error in production
    if (process.env.NODE_ENV === 'production') {
      response.services.mongodbError = 'Database status check failed';
    } else {
      response.services.mongodbError = error.message;
    }
    response.status = 'degraded';
  }

  // Check database status from unified layer (fast, uses cached state)
  try {
    const dbStatus = dbUnified.getDatabaseStatus ? dbUnified.getDatabaseStatus() : null;

    if (dbStatus) {
      response.services.activeBackend = dbStatus.type; // 'mongodb' or 'local'
      response.services.databaseInitialized = dbStatus.initialized;

      // If initialization failed, report degraded status
      if (dbStatus.initializationState === 'failed' && dbStatus.initializationError) {
        response.status = 'degraded';
        response.services.databaseInitializationError = dbStatus.initializationError;
      }
    }
  } catch (error) {
    // If status check fails, report it but still return healthy
    response.services.databaseStatusError = error.message;
    response.status = 'degraded';
  }

  // Add email service status
  response.services.email = emailStatus;

  // Add Pexels API status (fast check, no I/O)
  try {
    const { getPexelsService } = require('../utils/pexels-service');
    const pexels = getPexelsService();
    const isConfigured = pexels.isConfigured();
    response.services.pexels = isConfigured ? 'configured' : 'not_configured';

    // Check if collection-based features are configured
    if (isConfigured) {
      try {
        const settings = await dbUnified.read('settings');
        const pexelsCollageSettings = settings?.pexelsCollageSettings;

        if (pexelsCollageSettings) {
          const hasCollectionId = !!(
            pexelsCollageSettings.collectionId || pexelsCollageSettings.collectionIds
          );
          response.services.pexelsCollections = hasCollectionId ? 'configured' : 'not_configured';
        }
      } catch (settingsError) {
        // Don't fail health check if settings read fails
        response.services.pexelsCollections = 'unknown';
      }
    }
  } catch (error) {
    response.services.pexels = 'unavailable';
  }

  response.integrations = getIntegrationStatus();

  const guardrails = getProductionGuardrails();
  response.guardrails = guardrails;
  if (guardrails.enabled && guardrails.missingCritical.length > 0) {
    response.status = 'degraded';
  }

  // Add response time for monitoring
  response.responseTime = Date.now() - startTime;

  // Return health status (always 200, degraded state is informational)
  res.status(200).json(response);
});

/**
 * GET /api/ready
 * Readiness probe for Kubernetes/Railway
 * Returns 200 only if MongoDB is connected
 * NOTE: Contains internal debug info - should NOT be cached
 */
router.get('/ready', applyHealthCheckLimiter, async (_req, res) => {
  // Check if dependencies are initialized
  if (!mongoDb || !dbUnified) {
    return res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: 'Readiness probe dependencies not initialized',
    });
  }

  // Do NOT cache - contains internal debug information
  res.setHeader('Cache-Control', 'no-store, private');

  const timestamp = new Date().toISOString();

  // Check if MongoDB is actually connected
  const isMongoConnected = mongoDb.isConnected && mongoDb.isConnected();
  const mongoState = mongoDb.getConnectionState ? mongoDb.getConnectionState() : 'disconnected';
  const mongoError = mongoDb.getConnectionError ? mongoDb.getConnectionError() : null;

  // Get active backend from unified database layer
  let activeBackend = 'unknown';
  try {
    const dbStatus = dbUnified.getDatabaseStatus ? dbUnified.getDatabaseStatus() : null;
    if (dbStatus) {
      activeBackend = dbStatus.type; // 'mongodb' or 'local'
    }
  } catch (error) {
    // Ignore errors in determining backend
  }

  if (!isMongoConnected) {
    return res.status(503).json({
      status: 'not_ready',
      timestamp,
      reason: 'Database not connected',
      details: mongoError || 'MongoDB connection is not established',
      services: {
        server: 'running',
        mongodb: mongoState,
        activeBackend: activeBackend,
      },
      debug: {
        mongoState: mongoState,
        lastConnectionError: mongoError,
        message:
          'Server is operational but MongoDB is not connected. Using fallback storage if configured.',
      },
    });
  }

  // MongoDB is connected, server is ready
  return res.status(200).json({
    status: 'ready',
    timestamp,
    services: {
      server: 'running',
      mongodb: 'connected',
      activeBackend: 'mongodb',
    },
    message: 'All systems operational',
  });
});

/**
 * GET /api/performance
 * Performance verification endpoint
 * Returns information about compression and caching configuration
 * Used to verify performance optimizations are active
 * NOTE: Contains internal config details - should NOT be cached
 */
router.get('/performance', applyHealthCheckLimiter, async (req, res) => {
  // Do NOT cache - contains internal configuration details
  res.setHeader('Cache-Control', 'no-store, private');

  const timestamp = new Date().toISOString();

  // Check compression support
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const supportsBrotli = acceptEncoding.includes('br');
  const supportsGzip = acceptEncoding.includes('gzip');
  const supportsDeflate = acceptEncoding.includes('deflate');

  // Analyze request headers
  const clientInfo = {
    userAgent: req.headers['user-agent'] || 'unknown',
    acceptEncoding: acceptEncoding || 'none',
    compression: {
      brotli: supportsBrotli,
      gzip: supportsGzip,
      deflate: supportsDeflate,
      preferred: supportsBrotli ? 'brotli' : supportsGzip ? 'gzip' : 'none',
    },
  };

  // Server compression configuration
  const compressionConfig = {
    enabled: true,
    types: ['text/html', 'text/css', 'application/javascript', 'application/json', 'text/plain'],
    threshold: '1KB',
    brotliSupport: true,
    gzipSupport: true,
    level: {
      gzip: 6,
      brotli: 4,
    },
  };

  // Caching strategy documentation
  const cachingStrategy = {
    html: {
      maxAge: 300, // 5 minutes
      directive: 'public, max-age=300, must-revalidate',
      description: 'Short-term caching for HTML pages',
    },
    versionedAssets: {
      maxAge: 31536000, // 1 year
      directive: 'public, max-age=31536000, immutable',
      description: 'Long-term caching for versioned assets (hashed filenames)',
      pattern: '[hash].{css|js|jpg|jpeg|png|gif|webp|svg|woff|woff2|ttf|eot}',
    },
    staticAssets: {
      maxAge: 604800, // 1 week
      directive: 'public, max-age=604800, must-revalidate',
      description: 'Medium-term caching for static assets',
      types: 'CSS, JS, images, fonts',
    },
    uploads: {
      maxAge: 31536000, // 1 year
      directive: 'public, max-age=31536000, immutable',
      description: 'Long-term caching for user uploads (unique filenames)',
    },
  };

  // Performance recommendations
  const recommendations = [];

  if (!supportsBrotli && !supportsGzip) {
    recommendations.push({
      type: 'warning',
      message: 'Client does not support compression. Upgrade browser for better performance.',
    });
  }

  if (!supportsBrotli && supportsGzip) {
    recommendations.push({
      type: 'info',
      message:
        'Client supports gzip but not Brotli. Modern browsers support Brotli for 15-20% better compression.',
    });
  }

  const response = {
    status: 'ok',
    timestamp,
    client: clientInfo,
    server: {
      compression: compressionConfig,
      caching: cachingStrategy,
    },
    recommendations: recommendations.length > 0 ? recommendations : [],
    verification: {
      compressionActive: supportsBrotli || supportsGzip,
      cachingActive: true,
      brotliAvailable: supportsBrotli,
    },
  };

  res.status(200).json(response);
});

// Export router and initialization function
module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
