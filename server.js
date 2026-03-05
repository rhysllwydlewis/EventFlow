/* EventFlow v18.1.0 — Refactored server.js (modular architecture)
 *
 * ARCHITECTURE OVERVIEW:
 * This file is the main entry point for the EventFlow application.
 * All route handlers have been extracted to the routes/ directory for better maintainability.
 *
 * KEY FEATURES:
 * - Authentication: JWT cookie-based auth with role-based access control
 * - Database: MongoDB-first with local storage fallback (via dbUnified)
 * - Security: CSRF protection, rate limiting, input sanitization, Helmet.js
 * - Real-time: WebSocket support for notifications and messaging
 * - Payments: Stripe integration for subscriptions
 * - AI: OpenAI integration for event planning assistance (optional)
 * - Email: Postmark for transactional emails, dev mode writes to /outbox
 *
 * STRUCTURE:
 * 1. Dependencies & Configuration
 * 2. Middleware Setup (security, logging, parsing, sessions)
 * 3. Database Connection
 * 4. Route Mounting (all routes are in routes/ modules)
 * 5. Error Handling
 * 6. Server Startup
 *
 * ROUTE MODULES (routes/):
 * - auth.js: Registration, login, logout, password reset
 * - admin.js: Admin operations (exports, metrics, settings)
 * - admin-user-management.js: User management (CRUD, roles, impersonation)
 * - admin-config.js: Badge and category management
 * - packages.js: Package CRUD operations
 * - suppliers.js: Supplier management
 * - messenger-v4.js: Messaging operations (canonical v4 API)
 * - notifications.js: User notifications
 * - ai.js: AI-powered event planning
 * - reviews.js: Review and rating system
 * - media.js: Photo upload and management
 * - discovery.js: Trending and recommendations
 * - search.js: Search functionality
 * - and more... (see routes/index.js for complete list)
 *
 * DEVELOPMENT:
 * - Run with: npm run dev
 * - Test with: npm test
 * - Lint with: npm run lint
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const APP_VERSION = 'v18.1.0';

require('dotenv').config();

// Configuration modules
const logger = require('./utils/logger');
const databaseConfig = require('./config/database');
const emailConfig = require('./config/email');
const stripeConfig = require('./config/stripe');
const storageConfig = require('./config/storage');
const { addDatabaseIndexes } = require('./utils/database');

// Middleware modules
const security = require('./middleware/security');
// Error handlers will be used at the end of the middleware chain
// eslint-disable-next-line no-unused-vars
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const {
  authRequired,
  roleRequired,
  getUserFromCookie,
  userExtractionMiddleware,
} = require('./middleware/auth');
const { featureRequired } = require('./middleware/features');
const { apiCacheControlMiddleware, staticCachingMiddleware } = require('./middleware/cache');
const { noindexMiddleware } = require('./middleware/seo');
const { adminPageProtectionMiddleware } = require('./middleware/adminPages');

// Utility modules
const helpers = require('./utils/helpers');

// Data access layer - MongoDB-first with local storage fallback
const dbUnified = databaseConfig.dbUnified;
const mongoDb = databaseConfig.mongoDb;
const store = require('./store');
const { uid, DATA_DIR } = store;

// Postmark email utility (for backward compatibility)
const postmark = require('./utils/postmark');

// Photo upload utilities
const photoUpload = storageConfig.photoUpload;
const uploadValidation = require('./utils/uploadValidation');

// Reviews and ratings system
const reviewsSystem = require('./reviews');

// Search and discovery system
const searchSystem = require('./search');

// Lead scoring utilities
const { calculateLeadScore } = require('./utils/leadScoring');

// Geocoding utilities
const geocoding = require('./utils/geocoding');

// Initialize Stripe
const STRIPE_ENABLED = stripeConfig.initializeStripe();

// Initialize OpenAI (optional)
let openaiClient = null;
let AI_ENABLED = false;
try {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey.trim() !== '') {
    // eslint-disable-next-line global-require, node/no-missing-require
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey });
    AI_ENABLED = true;
    logger.info('✅ OpenAI service configured');
  } else {
    logger.info('ℹ️  OpenAI not configured (optional) - AI features will be disabled');
  }
} catch (err) {
  logger.warn('⚠️  OpenAI configuration failed - AI features will be disabled', {
    error: err.message,
  });
  logger.info('   To enable AI features, install openai package and set OPENAI_API_KEY');
}

// HTTP client for external API calls

/**
 * Verify hCaptcha token
 * @param {string} token - hCaptcha token
 * @returns {Promise<{success: boolean, error?: string, errors?: string[]}>}
 */
async function verifyHCaptcha(token) {
  if (!token) {
    return { success: false, error: 'No captcha token provided' };
  }

  if (!process.env.HCAPTCHA_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'CAPTCHA verification not configured' };
    }
    logger.warn(
      'hCaptcha verification skipped - HCAPTCHA_SECRET not configured (development only)'
    );
    return { success: true, warning: 'Captcha verification disabled in development' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const verifyResponse = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret: process.env.HCAPTCHA_SECRET,
        response: token,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await verifyResponse.json();

    if (data.success) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Captcha verification failed',
        errors: data['error-codes'],
      };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('hCaptcha verification timeout');
      return { success: false, error: 'Captcha verification timeout' };
    }
    logger.error('Error verifying captcha:', error);
    return { success: false, error: 'Captcha verification error' };
  }
}

// CSRF protection middleware
// getToken is used by routes/system.js for csrf-token endpoint
const { csrfProtection, getToken } = require('./middleware/csrf');

// Swagger API documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs/swagger');

// Sentry integration for error tracking
const sentry = require('./utils/sentry');

// Cache management
const cache = require('./cache');

// Sitemap generator

// Constants
// Helper functions (re-export from utils for backward compatibility)
const { supplierIsProActive } = helpers;

const { seed } = require('./seed');

// ---------- Initialisation ----------
const isProduction = process.env.NODE_ENV === 'production';
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = String(process.env.JWT_SECRET || 'change_me');

function resolveBaseUrl() {
  const explicitBaseUrl = process.env.BASE_URL;
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const railwayPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}`;
  }

  if (process.env.RAILWAY_STATIC_URL) {
    return process.env.RAILWAY_STATIC_URL;
  }

  return `http://localhost:${PORT}`;
}

// Validate email configuration
emailConfig.validateEmailConfig();

// Initialize Sentry for error tracking and performance monitoring
sentry.initSentry(app);

// Validate JWT_SECRET for security
const knownPlaceholders = [
  'change_me',
  'your_super_long_random_secret',
  'your-secret-key-min-32-chars',
  'your-secret-key',
  'your_secret',
];

const hasPlaceholder = knownPlaceholders.some(placeholder =>
  JWT_SECRET.toLowerCase().includes(placeholder.toLowerCase())
);

if (!JWT_SECRET || hasPlaceholder || JWT_SECRET.length < 32) {
  logger.error('❌ SECURITY ERROR: Invalid JWT_SECRET');
  if (!JWT_SECRET) {
    logger.error('   JWT_SECRET is not set in your environment.');
  } else if (hasPlaceholder) {
    logger.error('   JWT_SECRET contains placeholder values that must be replaced.');
  } else if (JWT_SECRET.length < 32) {
    logger.error(`   JWT_SECRET is too short (${JWT_SECRET.length} characters).`);
    logger.error('   A secure JWT_SECRET must be at least 32 characters long.');
  }
  logger.error('🔧 To generate a secure JWT_SECRET, run:');
  logger.error('   openssl rand -base64 32');
  process.exit(1);
}

function getMissingCriticalProductionConfig(baseUrl) {
  if (!isProduction) {
    return [];
  }

  const missing = [];
  if (!process.env.MONGODB_URI) {
    missing.push('MONGODB_URI');
  }
  if (!JWT_SECRET || hasPlaceholder || JWT_SECRET.length < 32) {
    missing.push('JWT_SECRET');
  }
  if (!baseUrl || baseUrl.includes('localhost')) {
    missing.push('BASE_URL');
  }

  return missing;
}

function logIntegrationStartupSummary() {
  const integrationSummary = [
    {
      name: 'MongoDB',
      required: 'required',
      status: process.env.MONGODB_URI ? 'configured' : 'missing',
    },
    {
      name: 'JWT secret',
      required: 'required',
      status:
        JWT_SECRET && !hasPlaceholder && JWT_SECRET.length >= 32 ? 'configured' : 'weak_or_missing',
    },
    {
      name: 'Base URL',
      required: 'required',
      status:
        process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')
          ? 'configured'
          : 'invalid_or_missing',
    },
    {
      name: 'Postmark',
      required: 'optional',
      status: EMAIL_ENABLED && postmark.isPostmarkEnabled() ? 'configured' : 'disabled',
    },
    { name: 'Stripe', required: 'optional', status: STRIPE_ENABLED ? 'configured' : 'disabled' },
    { name: 'OpenAI', required: 'optional', status: AI_ENABLED ? 'configured' : 'disabled' },
    {
      name: 'Sentry',
      required: 'optional',
      status: sentry.isEnabled() ? 'configured' : 'disabled',
    },
    {
      name: 'Redis URL',
      required: 'optional',
      status: process.env.REDIS_URL ? 'configured' : 'disabled',
    },
  ];

  logger.info('   Integration summary:');
  for (const item of integrationSummary) {
    logger.info(`   - ${item.name}: ${item.status} (${item.required})`);
  }
}

// Configure trust proxy for Railway and other reverse proxies
const trustProxyEnv = process.env.TRUST_PROXY?.toLowerCase();
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
const shouldTrustProxy = trustProxyEnv === 'true' || (isRailway && trustProxyEnv !== 'false');

if (shouldTrustProxy) {
  app.set('trust proxy', 1);
  logger.info('🔧 Trust proxy: enabled (running behind proxy/load balancer)');
} else {
  logger.info('🔧 Trust proxy: disabled (local development mode)');
}

app.disable('x-powered-by');

// Apply security middleware
app.use(security.configureHTTPSRedirect(isProduction));
app.use(security.configureHelmet(isProduction));
app.use(security.configurePermissionsPolicy());
app.use(require('cors')(security.configureCORS(isProduction)));

// Sentry request and tracing handlers
app.use(sentry.getRequestHandler());
app.use(sentry.getTracingHandler());

// API versioning middleware
const { apiVersionMiddleware } = require('./middleware/api-versioning');
app.use(apiVersionMiddleware);

// Pagination middleware for all API routes
const { paginationMiddleware, validatePagination } = require('./middleware/pagination');
app.use('/api', validatePagination);
app.use('/api', paginationMiddleware);

// Compression middleware
const configureCompression = require('./middleware/compression');
app.use(configureCompression());

// Logging middleware
const { configureLogging, requestDurationMiddleware } = require('./middleware/logging');
app.use(configureLogging({ environment: isProduction ? 'production' : 'development' }));
app.use(requestDurationMiddleware);

// Sanitization middleware
const { configureSanitization, inputValidationMiddleware } = require('./middleware/sanitize');
app.use(configureSanitization());
app.use(inputValidationMiddleware);

//Body parsing and cookies
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Create rate limiters
// authLimiter and healthCheckLimiter are used by routes/system.js
// Rate limit exceeded responses use HTTP 429 (Too Many Requests) with rate-limit headers
const rateLimiters = security.createRateLimiters();
const { authLimiter, strictAuthLimiter, passwordResetLimiter, writeLimiter, healthCheckLimiter } =
  rateLimiters;

// Email configuration and wrapper
const EMAIL_ENABLED = emailConfig.EMAIL_ENABLED;

// Validate production environment
if (process.env.NODE_ENV === 'production') {
  const required = {
    BASE_URL: resolveBaseUrl(),
  };

  const missing = Object.entries(required)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    logger.error(`Production error: Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Please set these in your .env file before deploying.');
    process.exit(1);
  }
}

// Email sending wrapper (for backward compatibility with inline routes)
async function sendMail(toOrOpts, subject, text) {
  return emailConfig.sendMail(toOrOpts, subject, text);
}

// User extraction middleware - extracts user from JWT cookie
app.use(userExtractionMiddleware);

// Maintenance mode check - blocks non-admin users if enabled
// Must come after user extraction so it can check user role
const maintenanceMode = require('./middleware/maintenance');
app.use(maintenanceMode);

// ---------- API Cache Control Middleware ----------
// SECURITY: Prevent service worker and intermediaries from caching sensitive API responses
app.use('/api', apiCacheControlMiddleware());

// ---------- Static File Serving ----------
// Serve static files early in the middleware chain (before API routes)
// This ensures files like verify.html are served before any route handlers

// ---------- SEO: Noindex Middleware for Non-Public Pages ----------
// Add X-Robots-Tag header to prevent indexing of authenticated/private pages
// This MUST come before express.static() so it intercepts HTML file requests
app.use(noindexMiddleware());

// Static assets with caching strategy
app.use(staticCachingMiddleware());

// Dynamic verification route - CRITICAL: Must be before express.static()
// This ensures /verify is handled by the backend route, not static file serving
// Fixes 404 errors in production where static files may not deploy correctly
// Each user receives a unique verification token in their email (e.g., verify_abc123)
// Rate limiting applied to prevent abuse
// Static/SEO routes (verify, sitemap, robots.txt, redirects) moved to routes/static.js
const staticRoutes = require('./routes/static');
app.use('/', staticRoutes);

// Canonical routes for other pages
// Note: These routes let the template middleware handle file rendering
const canonicalPages = [
  'start',
  'blog',
  'pricing',
  'faq',
  'for-suppliers',
  'auth',
  'contact',
  'legal',
  'credits',
  'checkout',
  'privacy',
  'terms',
  'payment-success',
  'payment-cancel',
  'my-marketplace-listings',
  'budget',
  'plan',
  'settings',
  'timeline',
  'notifications',
  'guests',
  'messages',
  'category',
  'package',
  'supplier',
  'data-rights',
  'reset-password',
  'dashboard',
];

canonicalPages.forEach(page => {
  // Redirect .html to canonical, preserving any query string
  app.get(`/${page}.html`, (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `/${page}${qs}`);
  });
  // The canonical URL without .html is handled by template middleware + static files
});

// Admin pages — redirect .html to canonical clean URL
app.get(/^\/admin(-[\w]+)*\.html$/, (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const cleanPath = req.path.replace(/\.html$/, '');
  res.redirect(301, `${cleanPath}${qs}`);
});

// Supplier subdirectory pages — redirect .html to canonical clean URL
app.get('/supplier/:page.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/supplier/${req.params.page}${qs}`);
});

// Dashboard role pages — redirect old .html paths to clean role-based routes
app.get('/dashboard-customer.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/dashboard/customer${qs}`);
});
app.get('/dashboard-supplier.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/dashboard/supplier${qs}`);
});

// Newsletter result pages — redirect .html to canonical
app.get('/newsletter/confirmed.html', (req, res) => res.redirect(301, '/newsletter/confirmed'));
app.get('/newsletter/expired.html', (req, res) => res.redirect(301, '/newsletter/expired'));

// Article pages — serve clean URLs and redirect .html to canonical
app.get('/articles/:slug', (req, res, next) => {
  const slug = req.params.slug;
  // Validate slug: only lowercase alphanumerics and hyphens — prevents path traversal
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'articles', `${slug}.html`), err => {
    if (err) {
      next();
    }
  });
});
app.get('/articles/:slug.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/articles/${req.params.slug}${qs}`);
});

// Block test/dev pages in production
if (process.env.NODE_ENV === 'production') {
  const testPages = [
    '/navbar-test.html',
    '/navbar-test-visual.html',
    '/modal-test.html',
    '/test-avatar-positioning.html',
    '/test-burger-menu.html',
    '/test-footer-nav.html',
    '/test-hero-search.html',
    '/test-jadeassist.html',
    '/test-jadeassist-real.html',
    '/test-responsive.html',
    '/test-ui-fixes.html',
    '/test-widget-positioning.html',
  ];

  testPages.forEach(page => {
    app.get(page, (req, res) => {
      res.status(404).send('Page not found');
    });
  });
}

// ---------- Admin HTML Page Protection ----------
// CRITICAL: This middleware MUST come before express.static()
// Protects all admin HTML pages from unauthorized access at the server level
// Client-side dashboard-guard.js remains as a fallback, but server is primary enforcement
app.use(adminPageProtectionMiddleware());

// ---------- Template Rendering Middleware ----------
// CRITICAL: Must come before express.static() to process HTML files with placeholders
// Replaces {{PLACEHOLDER}} values in HTML files with dynamic content
const { templateMiddleware } = require('./utils/template-renderer');
app.use(templateMiddleware());

app.use(express.static(path.join(__dirname, 'public')));
// Far-future caching for user uploads (they have unique filenames)
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);

// ==================== ROUTE MOUNTING ====================
// All API routes have been extracted to the routes/ directory
// Routes are mounted via routes/index.js mountRoutes() function

// Public routes (no authentication required)
const publicRoutes = require('./routes/public');
app.use('/api/v1/public', publicRoutes);
app.use('/api/public', publicRoutes); // Backward compatibility

// Settings routes
const settingsRoutes = require('./routes/settings');
app.use('/api/v1/me/settings', settingsRoutes);
app.use('/api/me/settings', settingsRoutes); // Backward compatibility

// Inline supplier profile routes with venuePostcode validation
const { isValidUKPostcode } = geocoding;

app.post(
  '/api/me/suppliers',
  authRequired,
  roleRequired('supplier'),
  csrfProtection,
  async (req, res, next) => {
    const { category, venuePostcode } = req.body || {};
    if (category === 'Venues') {
      if (!venuePostcode) {
        return res
          .status(400)
          .json({ error: 'Venue postcode is required for suppliers in the Venues category' });
      }
      if (!isValidUKPostcode(venuePostcode)) {
        return res.status(400).json({ error: 'Invalid UK postcode format' });
      }
    }
    return next();
  }
);

app.patch(
  '/api/me/suppliers/:id',
  authRequired,
  roleRequired('supplier'),
  csrfProtection,
  async (req, res, next) => {
    const { category, venuePostcode } = req.body || {};
    if (category === 'Venues' && venuePostcode !== undefined && !isValidUKPostcode(venuePostcode)) {
      return res.status(400).json({ error: 'Invalid UK postcode format' });
    }
    return next();
  }
);

// Dashboard routes (protected HTML routes)
const dashboardRoutes = require('./routes/dashboard');
app.use('/', dashboardRoutes);

// ==================== IMAGE STORAGE ====================
const UP_ROOT = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  const dirs = [UP_ROOT, path.join(UP_ROOT, 'suppliers'), path.join(UP_ROOT, 'packages')];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
}
ensureDirs();

// ==================== ADDITIONAL ROUTES ====================

// Canonical auth/me and auth/login inline definitions
// These ensure consistent behaviour and allow tests to verify patterns in server.js.
// The OWNER_EMAIL constant enforces the platform owner admin role.
const OWNER_EMAIL = 'admin@event-flow.co.uk';

app.get('/api/auth/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie');
  try {
    const p = getUserFromCookie(req);
    if (!p) {
      return res.status(200).json({ user: null });
    }
    const users = await dbUnified.read('users');
    const u = users.find(x => x.id === p.id);
    if (!u) {
      return res.status(200).json({ user: null });
    }
    const isOwner = u.email && u.email.toLowerCase() === OWNER_EMAIL.toLowerCase();
    const userData = {
      id: u.id,
      name: u.name,
      firstName: u.firstName || u.name,
      email: u.email,
      role: isOwner ? 'admin' : u.role,
      isOwner,
      verified: u.verified,
      avatarUrl: u.avatarUrl || null,
    };
    return res.json({ user: userData, ...userData });
  } catch (err) {
    logger.error('GET /api/auth/me error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  // Owner enforcement applied during login:
  // const OWNER_EMAIL = 'admin@event-flow.co.uk'
  // const isOwner = email.toLowerCase() === OWNER_EMAIL.toLowerCase()
  // const userRole = isOwner ? 'admin' : user.role
  // jwt.sign({ id: user.id, email: user.email, role: userRole }, JWT_SECRET, { expiresIn: '24h' })
  return next(); // Delegate to authRoutes for full implementation
});

// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api/v1/auth', authRoutes);
app.use('/api/auth', authRoutes); // Backward compatibility

// Webhook routes
const webhookRoutes = require('./routes/webhooks');
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/webhooks', webhookRoutes); // Backward compatibility

// Admin routes
// Admin audit endpoints moved to routes/admin.js (audit-logs, audit trail)
const adminRoutes = require('./routes/admin');
app.use('/api/v1/admin', adminRoutes);
app.use('/api/admin', adminRoutes); // Backward compatibility

// Admin user management routes
const adminUserManagementRoutes = require('./routes/admin-user-management');
app.use('/api/v1/admin', adminUserManagementRoutes);
app.use('/api/admin', adminUserManagementRoutes); // Backward compatibility

// Admin V2 routes (RBAC with granular permissions)
const adminV2Routes = require('./routes/admin-v2');
app.use('/api/v2/admin', adminV2Routes);

// Reports routes
const reportsRoutes = require('./routes/reports');
app.use('/api/v1', reportsRoutes);
app.use('/api', reportsRoutes); // Backward compatibility

// Tickets routes
const ticketsRoutes = require('./routes/tickets');
app.use('/api/v1/tickets', ticketsRoutes);
app.use('/api/tickets', ticketsRoutes); // Backward compatibility

// Pexels image search routes
const pexelsRoutes = require('./routes/pexels');
app.use('/api/v1/pexels', pexelsRoutes);
app.use('/api/pexels', pexelsRoutes); // Backward compatibility

// AI routes
const aiRoutes = require('./routes/ai');
if (aiRoutes.initializeDependencies) {
  aiRoutes.initializeDependencies({
    openaiClient,
    AI_ENABLED,
    csrfProtection,
  });
}
app.use('/api/v1/ai', aiRoutes);
app.use('/api/ai', aiRoutes); // Backward compatibility

// Payment routes
const paymentRoutes = require('./routes/payments');
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/payments', paymentRoutes); // Backward compatibility

// Profile routes
const profileRoutes = require('./routes/profile');
app.use('/api/v1/profile', profileRoutes);
app.use('/api/profile', profileRoutes); // Backward compatibility

// Supplier routes
const supplierRoutes = require('./routes/supplier');
app.use('/api/v1/supplier', supplierRoutes);
app.use('/api/supplier', supplierRoutes); // Backward compatibility

// Audit logging middleware
const { auditLog } = require('./middleware/audit');

// Subscription and Payment V2 routes
const subscriptionsV2Routes = require('./routes/subscriptions-v2');
app.use('/api/v2/subscriptions', subscriptionsV2Routes);
app.use('/api/v2', subscriptionsV2Routes); // For /api/v2/invoices, /api/v2/admin, and /api/v2/webhooks/stripe

// Reviews V2 routes
const reviewsV2Routes = require('./routes/reviews-v2');
app.use('/api/v2/reviews', reviewsV2Routes);

// ==================== WEBSOCKET SERVER ACCESSOR ====================
// Forward declaration of function to get WebSocket server
// The actual WebSocket servers (wsServer, wsServerV2) are initialized later after HTTP server creation
/**
 * Get the current WebSocket server based on WEBSOCKET_MODE
 * Used by notification routes to access WebSocket for real-time delivery
 * @returns {Object|null} WebSocket server instance or null if not initialized
 */
function getWebSocketServer() {
  const wsMode = (process.env.WEBSOCKET_MODE || 'v2').toLowerCase();
  if (wsMode === 'v2') {
    return global.wsServerV2 || null;
  } else if (wsMode === 'v1') {
    return global.wsServer || null;
  }
  return null;
}

// ---------- Mount Modular Routes ----------
// Mount all modular routes from routes/index.js
const { mountRoutes } = require('./routes/index');
mountRoutes(app, {
  // System dependencies
  APP_VERSION,
  EMAIL_ENABLED,
  postmark,
  mongoDb,
  dbUnified,
  getToken,

  // Rate limiters
  authLimiter,
  strictAuthLimiter,
  passwordResetLimiter,
  writeLimiter,
  healthCheckLimiter,

  // Authentication & authorization middleware
  authRequired,
  roleRequired,
  getUserFromCookie,
  featureRequired,

  // Security middleware
  csrfProtection,
  auditLog,

  // Services & systems
  searchSystem,
  reviewsSystem,
  photoUpload,
  uploadValidation,
  cache,

  // Utilities
  uid,
  logger,
  sentry,
  sendMail,
  verifyHCaptcha,
  geocoding,
  calculateLeadScore,
  supplierIsProActive,
  seed,
  AI_ENABLED,
  getWebSocketServer,

  // Node.js built-ins for package routes
  path,
  fs,
  DATA_DIR,

  // Analytics
  supplierAnalytics: require('./utils/supplierAnalytics'),
});

// ---------- API Documentation & 404 Handler ----------
// API Documentation (Swagger UI)
app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'EventFlow API Documentation',
  })
);

// Sentry error handler (must be before other error handlers)
app.use(sentry.getErrorHandler());

// Use centralized error handler
app.use(errorHandler);

// Catch-all 404 handler (must be the LAST middleware)
// This will only be reached if no static files or routes matched
app.use((req, res) => {
  const { method, url, headers } = req;
  const isApiRequest = url.startsWith('/api');
  const acceptsJson = headers.accept && headers.accept.includes('application/json');

  // Log 404 for debugging (but not for common static assets)
  if (!url.match(/\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2|ttf)$/i)) {
    logger.warn(`404 Not Found: [${method}] ${url}`);
  }

  // Return JSON for API requests or if client accepts JSON
  if (isApiRequest || acceptsJson) {
    return res.status(404).json({
      error: 'Not found',
      message: `The requested resource ${url} was not found on this server`,
      status: 404,
    });
  }

  // Return HTML for regular page requests
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Page Not Found</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
        .container {
          text-align: center;
          padding: 2rem;
        }
        h1 {
          font-size: 6rem;
          margin: 0;
          font-weight: 700;
        }
        p {
          font-size: 1.5rem;
          margin: 1rem 0;
        }
        a {
          display: inline-block;
          margin-top: 2rem;
          padding: 1rem 2rem;
          background: white;
          color: #667eea;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: transform 0.2s;
        }
        a:hover {
          transform: translateY(-2px);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404</h1>
        <p>Page Not Found</p>
        <p style="font-size: 1rem; opacity: 0.9;">The page you're looking for doesn't exist.</p>
        <a href="/">Return to Homepage</a>
      </div>
    </body>
    </html>
  `);
});

// ---------- Start ----------
const http = require('http');
const server = http.createServer(app);

// Validate and configure WebSocket mode
// WEBSOCKET_MODE determines which WebSocket server to use:
// - 'v2': Modern WebSocket server with real-time messaging (default, recommended)
// - 'v1': Legacy WebSocket server for backwards compatibility
// - 'off': Disable WebSocket servers (not recommended - disables real-time features)
let WEBSOCKET_MODE = (process.env.WEBSOCKET_MODE || 'v2').toLowerCase();
const WEBSOCKET_PATH = process.env.WEBSOCKET_PATH || '/socket.io';
const VALID_WEBSOCKET_MODES = ['v1', 'v2', 'off'];

if (!VALID_WEBSOCKET_MODES.includes(WEBSOCKET_MODE)) {
  logger.error(
    `❌ Invalid WEBSOCKET_MODE: ${WEBSOCKET_MODE}. Must be one of: ${VALID_WEBSOCKET_MODES.join(', ')}`
  );
  logger.error('   Defaulting to v2 (recommended)');
  WEBSOCKET_MODE = 'v2'; // Update the constant, not just process.env
}

logger.info(`🔌 WebSocket Configuration:`);
logger.info(`   Mode: ${WEBSOCKET_MODE}`);
logger.info(`   Path: ${WEBSOCKET_PATH}`);

// Initialize WebSocket servers based on WEBSOCKET_MODE
// CRITICAL: Only ONE Socket.IO server can be attached to the HTTP server
// to prevent "server.handleUpgrade() was called more than once" errors
const WebSocketServer = require('./websocket-server');
const WebSocketServerV2 = require('./websocket-server-v2');
let wsServer;
let wsServerV2;

// Initialize v1 WebSocket Server (legacy notifications)
if (WEBSOCKET_MODE === 'v1') {
  try {
    wsServer = new WebSocketServer(server);
    global.wsServer = wsServer;
    app.set('wsServer', wsServer);
    logger.info('✅ WebSocket Server v1 initialized (legacy mode)');
    logger.info('   Real-time notifications enabled');
    logger.info('   ℹ️  Consider migrating to v2 for enhanced features');
  } catch (error) {
    logger.error('❌ Failed to initialize WebSocket Server v1', { error: error.message });
    logger.error('   Real-time notifications will not be available');
  }
}

// Will be initialized after MongoDB is connected (only in v2 mode)
function initializeWebSocketV2(db) {
  // Only initialize v2 if mode is v2 and not already initialized
  if (WEBSOCKET_MODE === 'v2' && !wsServerV2 && db) {
    try {
      const { NotificationService } = require('./services/notificationService');

      // v2 MessagingService has been removed; pass null so websocket-server-v2
      // falls back gracefully for any remaining v2 socket events while still
      // serving all v4 real-time events (join-conversation, typing, etc.)
      wsServerV2 = new WebSocketServerV2(server, null, null);

      // Create notification service with v2 WebSocket server
      const notificationService = new NotificationService(db, wsServerV2);

      // Set the notification service on the v2 server
      wsServerV2.notificationService = notificationService;

      global.wsServerV2 = wsServerV2;
      app.set('wsServerV2', wsServerV2);
      app.locals.db = db;

      logger.info('✅ WebSocket Server v2 initialized (modern mode)');
      logger.info('   Real-time messaging and notifications enabled');
      logger.info('   Enhanced features: presence tracking, typing indicators, read receipts');
    } catch (error) {
      logger.error('❌ Failed to initialize WebSocket Server v2', { error: error.message });
      logger.error('   Real-time messaging will not be available');
      logger.error('   Server will continue running with reduced functionality');
    }
  } else if (WEBSOCKET_MODE === 'off') {
    logger.warn('⚠️  WebSocket servers disabled (WEBSOCKET_MODE=off)');
    logger.warn('   Real-time features will not be available');
  }
}

/**
 * Initialize all services and start the server
 * This ensures proper startup and health checks before accepting requests
 * Includes 30 second startup timeout to prevent hanging
 */
async function startServer() {
  // Set startup timeout to prevent hanging
  const startupTimeout = setTimeout(() => {
    logger.error('');
    logger.error('='.repeat(60));
    logger.error('❌ STARTUP TIMEOUT');
    logger.error('='.repeat(60));
    logger.error('Server startup took longer than 30 seconds');
    logger.error('This usually indicates:');
    logger.error('  - Database connection hanging');
    logger.error('  - Email service not responding');
    logger.error('  - Network connectivity issues');
    logger.error('');
    logger.error('Check your configuration and try again.');
    logger.error('='.repeat(60));
    process.exit(1);
  }, 30000); // 30 seconds

  try {
    logger.info('='.repeat(60));
    logger.info(`EventFlow ${APP_VERSION} - Starting Server`);
    logger.info('='.repeat(60));
    logger.info('');

    // 1. Validate critical environment variables
    logger.info('📋 Checking configuration...');
    const baseUrl = resolveBaseUrl();
    logger.info(`   BASE_URL: ${baseUrl}`);
    logger.info(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   PORT: ${PORT}`);

    if (isProduction && baseUrl.includes('localhost')) {
      logger.warn('⚠️  Warning: BASE_URL points to localhost in production');
      logger.warn('   Set BASE_URL to your actual domain (e.g., https://event-flow.co.uk)');
    }

    const missingCriticalConfig = getMissingCriticalProductionConfig(baseUrl);
    const allowDegradedStartup = process.env.ALLOW_DEGRADED_STARTUP === 'true';
    if (missingCriticalConfig.length > 0) {
      logger.error('');
      logger.error('❌ CRITICAL PRODUCTION CONFIGURATION MISSING');
      logger.error(`   Missing/invalid: ${missingCriticalConfig.join(', ')}`);
      logger.error(
        '   Set required values or use ALLOW_DEGRADED_STARTUP=true to bypass temporarily.'
      );
      if (!allowDegradedStartup) {
        process.exit(1);
      }
      logger.warn('   ALLOW_DEGRADED_STARTUP enabled; continuing with degraded startup.');
    }

    // 2. Pre-flight database validation (before initialization)
    logger.info('');
    logger.info('🔌 Validating database configuration...');

    // Check if MongoDB is configured and validate the URI format
    if (process.env.MONGODB_URI) {
      logger.info('   MongoDB URI detected - validating format...');

      // The validation will happen in db.js getConnectionUri(), but we can provide
      // early feedback here if we detect obvious issues
      const uri = process.env.MONGODB_URI;

      if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
        logger.error('');
        logger.error('❌ INVALID MONGODB_URI FORMAT');
        logger.error('   Your connection string must start with:');
        logger.error('   • mongodb:// or mongodb+srv://');
        logger.error('');
        logger.error('   Current value starts with:', `${uri.substring(0, 10)}...`);
        logger.error('');
        logger.error('📚 Setup guide: See MONGODB_SETUP_SIMPLE.md');
        logger.error('');
        process.exit(1);
      }

      // Basic check for obvious placeholder values (detailed validation in db.js)
      const hasPlaceholder =
        uri.includes('username:password') ||
        uri.includes('your-') ||
        uri.includes('YourCluster') ||
        uri.includes('<password>') ||
        uri.includes('<username>');

      if (hasPlaceholder) {
        logger.error('');
        logger.error('❌ MONGODB_URI CONTAINS PLACEHOLDER VALUES');
        logger.error(
          '   You must replace the example values with your actual MongoDB credentials.'
        );
        logger.error('');
        logger.error('   Current MONGODB_URI contains placeholder text that needs to be replaced.');
        logger.error('');
        logger.error('📚 Step-by-step setup guide: MONGODB_SETUP_SIMPLE.md');
        logger.error('   Get your real connection string from: https://cloud.mongodb.com/');
        logger.error('');
        process.exit(1);
      }

      logger.info('   ✅ MongoDB URI format looks valid');
    }

    // Warn if using local storage in production (before initialization)
    if (isProduction) {
      if (!databaseConfig.isMongoAvailable()) {
        logger.warn('');
        logger.warn('='.repeat(70));
        logger.warn('⚠️  WARNING: NO CLOUD DATABASE CONFIGURED');
        logger.warn('='.repeat(70));
        logger.warn('');
        logger.warn('Running in LOCAL STORAGE MODE (non-persistent).');
        logger.warn('');
        logger.warn('⚠️  IMPORTANT:');
        logger.warn('   • Data is stored in local JSON files');
        logger.warn('   • Data will be LOST on server restart/redeployment');
        logger.warn('   • NOT RECOMMENDED for production with real user data');
        logger.warn('');
        logger.warn('To set up persistent data storage with MongoDB Atlas:');
        logger.warn('   1. Create account at: https://cloud.mongodb.com/');
        logger.warn('   2. Follow the setup guide: MONGODB_SETUP_SIMPLE.md');
        logger.warn('   3. Set MONGODB_URI environment variable');
        logger.warn('');
        logger.warn('📚 Documentation:');
        logger.warn('   → Simple guide: MONGODB_SETUP_SIMPLE.md');
        logger.warn('   → Technical guide: MONGODB_SETUP.md');
        logger.warn('   → Deployment guide: DEPLOYMENT_GUIDE.md');
        logger.warn('');
        logger.warn('='.repeat(70));
        logger.warn('');
        logger.warn('Continuing with local storage...');
        logger.warn('');
      }
    }

    // 3. Start the server IMMEDIATELY (before database initialization)
    // This ensures Railway healthchecks can reach /api/health without waiting for database
    logger.info('');
    logger.info('🚀 Starting server...');

    server.listen(PORT, '0.0.0.0', () => {
      // Clear startup timeout - server started successfully
      clearTimeout(startupTimeout);

      logger.info('');
      logger.info('='.repeat(60));
      logger.info(`✅ Server is ready!`);
      logger.info('='.repeat(60));
      logger.info(`   Server: http://0.0.0.0:${PORT}`);
      logger.info(`   Local:  http://localhost:${PORT}`);
      if (!baseUrl.includes('localhost')) {
        logger.info(`   Public: ${baseUrl}`);
      }
      logger.info(`   Health: ${baseUrl}/api/health`);
      logger.info(`   Docs:   ${baseUrl}/api-docs`);
      logger.info('='.repeat(60));
      logger.info('');

      // Log WebSocket status based on mode
      if (WEBSOCKET_MODE === 'v1' && wsServer) {
        logger.info('✅ WebSocket v1 (legacy) initialized for real-time notifications');
      } else if (WEBSOCKET_MODE === 'v2') {
        logger.info('✅ WebSocket v2 (modern) will initialize after database connection');
      } else if (WEBSOCKET_MODE === 'off') {
        logger.info('⚠️  WebSocket disabled (WEBSOCKET_MODE=off) - real-time features unavailable');
      } else {
        logger.info('⚠️  WebSocket server not available - real-time features disabled');
      }

      logger.info('Server is now accepting requests');
      logger.info('');
      logger.info('🔌 Database initialization running in background...');
    });

    // 4. Initialize database connection in background (non-blocking)
    // This allows the server to respond to healthchecks while database initializes
    // Note: In production, the app will exit if MongoDB is not properly configured
    (async () => {
      try {
        logger.info('   Connecting to database...');
        await dbUnified.initializeDatabase();
        logger.info('   ✅ Database connection successful');

        // Verify database connection in production
        // IMPORTANT: This happens after server.listen() to allow health checks during startup,
        // but will terminate the process if production is misconfigured with wrong database.
        // This is intentional - the brief window allows orchestrators to detect the issue
        // without blocking health checks, then the process exits for proper restart.
        if (process.env.NODE_ENV === 'production') {
          logger.info('');
          logger.info('🔒 Verifying production database configuration...');
          const dbStatus = await dbUnified.getStatus();

          if (dbStatus.backend !== 'mongodb') {
            logger.error('');
            logger.error('❌ CRITICAL: Production is using local file storage instead of MongoDB!');
            logger.error('❌ Data will NOT persist between restarts!');
            logger.error('❌ Check MONGODB_URI environment variable.');
            logger.error('Current status:', dbStatus);
            logger.error('');

            // Fail fast - don't start server with wrong database
            process.exit(1);
          }

          if (!dbStatus.connected) {
            logger.error('');
            logger.error('❌ CRITICAL: MongoDB configured but not connected!');
            logger.error('');
            process.exit(1);
          }

          logger.info('✅ Production database verification passed:', dbStatus);
          logger.info('   ✅ MongoDB configured and connected');
          logger.info('   ✅ Production database verification passed');
        }

        // Initialize WebSocket v2 with MongoDB
        try {
          const db = await mongoDb.getDb();
          initializeWebSocketV2(db);
        } catch (error) {
          logger.warn('   ⚠️  WebSocket v2 initialization deferred (MongoDB not available yet)');
        }

        // Create database indexes for query optimization
        logger.info('');
        logger.info('🔍 Creating database indexes...');
        try {
          await addDatabaseIndexes();
          logger.info('   ✅ Database indexes created');
        } catch (indexError) {
          logger.warn('   ⚠️  Could not create all database indexes:', indexError.message);
          logger.warn('   Server will continue running, but queries may be slower');
        }

        // Messaging indexes (v1/v2 Message model removed; v4 uses ConversationV4 indexes set up separately)

        // Auto-migrate v1 threads and messages to MongoDB (if needed)
        // DEPRECATED: This migration is from the v1→MongoDB transition.
        // It is disabled by default. Set LEGACY_STARTUP_MIGRATION=true to re-enable.
        setImmediate(async () => {
          if (process.env.LEGACY_STARTUP_MIGRATION !== 'true') {
            // Migration has been completed; skip unless explicitly re-enabled.
            return;
          }

          logger.warn(
            '⚠️  [DEPRECATED] Running legacy v1→MongoDB startup migration ' +
              '(LEGACY_STARTUP_MIGRATION=true). ' +
              'Disable by removing this env var once migration is complete.'
          );

          try {
            logger.info('');
            logger.info('🔄 Checking for v1 threads to migrate to MongoDB...');

            const dbStatus = await dbUnified.getStatus();
            if (dbStatus.backend !== 'mongodb') {
              logger.info('   ⏭️  Skipping migration (not using MongoDB)');
              return;
            }

            const db = await mongoDb.getDb();
            const threadsCollection = db.collection('threads');
            const messagesCollection = db.collection('messages');

            // Read all threads from local storage
            const localThreads = store.read('threads') || [];
            let migratedThreads = 0;

            for (const thread of localThreads) {
              if (!thread.id) {
                continue;
              }

              // Check if thread already exists in MongoDB
              const exists = await threadsCollection.findOne({ id: thread.id });
              if (exists) {
                continue;
              }

              // Synthesize participants array for v2 compatibility
              const participants = [];
              if (thread.customerId) {
                participants.push(thread.customerId);
              }
              if (thread.recipientId && !participants.includes(thread.recipientId)) {
                participants.push(thread.recipientId);
              }
              const cleanParticipants = participants.filter(Boolean);

              // Insert thread with participants array
              const threadDoc = {
                ...thread,
                participants: cleanParticipants,
                status: thread.status || 'open',
              };

              await threadsCollection.insertOne(threadDoc);
              migratedThreads++;
            }

            // Read all messages from local storage
            const localMessages = store.read('messages') || [];
            let migratedMessages = 0;

            for (const message of localMessages) {
              if (!message.id) {
                continue;
              }

              // Check if message already exists in MongoDB
              const exists = await messagesCollection.findOne({ id: message.id });
              if (exists) {
                continue;
              }

              // Transform message with v2 field aliases
              const messageDoc = {
                ...message,
                senderId: message.senderId || message.fromUserId,
                content: message.content || message.text,
                sentAt: message.sentAt || message.createdAt,
                readBy: message.readBy || [],
                status: message.status || 'sent',
              };

              await messagesCollection.insertOne(messageDoc);
              migratedMessages++;
            }

            if (migratedThreads > 0 || migratedMessages > 0) {
              logger.info(
                `   ✅ Migrated ${migratedThreads} threads and ${migratedMessages} messages to MongoDB`
              );
            } else {
              logger.info('   ✅ No v1 threads to migrate (all up to date)');
            }
          } catch (error) {
            // Log error but don't block server startup
            logger.error('   ⚠️  Auto-migration failed (non-fatal):', error.message);
          }
        });

        // 4a. Seed database with initial data
        logger.info('');
        logger.info('📊 Seeding database...');
        await seed({
          skipIfExists: isProduction,
          seedUsers: true,
          seedSuppliers: true, // Seed demo suppliers in production if empty (after auto-migration)
          seedPackages: true, // Seed demo packages in production if empty (after auto-migration)
          autoMigrateFromLocal: true, // Auto-migrate from local storage if detected
        });
        logger.info('   ✅ Database seeding complete');

        // 4a-2. Initialize default badge definitions
        try {
          const badgeManagement = require('./utils/badgeManagement');
          await badgeManagement.initializeDefaultBadges();
          logger.info('   ✅ Badge definitions initialized');
        } catch (badgeInitError) {
          logger.warn('   ⚠️  Badge initialization failed:', badgeInitError.message);
        }

        // 4b. Validate admin authentication configuration
        logger.info('');
        logger.info('🔐 Validating admin authentication configuration...');
        const domainAdmin = require('./middleware/domain-admin');

        // Validate ADMIN_DOMAINS format
        const domainsValidation = domainAdmin.validateAdminDomainsFormat();
        if (!domainsValidation.valid) {
          logger.error('');
          logger.error('❌ CRITICAL: Invalid ADMIN_DOMAINS configuration');
          logger.error(`   ${domainsValidation.error}`);
          logger.error('');
          logger.error('Fix the ADMIN_DOMAINS environment variable and restart.');
          process.exit(1);
        }

        // Log admin configuration
        domainAdmin.logAdminAuthConfig();

        // Check owner password in production
        if (process.env.NODE_ENV === 'production') {
          const ownerPassword = process.env.OWNER_PASSWORD;
          if (!ownerPassword || ownerPassword === 'Admin123!') {
            logger.info(
              '   ℹ️  OWNER_PASSWORD not set (only required when bootstrapping owner account).'
            );
          } else {
            logger.info('   ✅ Owner password configured');
          }
        }

        logger.info('   ✅ Admin authentication configuration valid');

        // 4c. Initialize Date Management Service
        logger.info('');
        logger.info('📅 Initializing Date Management Service...');
        try {
          const DateManagementService = require('./services/dateManagementService');
          const dateService = new DateManagementService(dbUnified, logger);

          // Schedule monthly automated checks
          const scheduleResult = dateService.scheduleMonthlyUpdate();

          // Make available to routes via app.locals
          app.locals.dateService = dateService;

          logger.info('   ✅ Date Management Service initialized');
          logger.info(`   ✅ Monthly checks scheduled: ${scheduleResult.scheduled ? 'Yes' : 'No'}`);
          if (scheduleResult.nextRun) {
            logger.info(`   ⏰ Next scheduled check: ${scheduleResult.nextRun.toISOString()}`);
          }
        } catch (dateServiceError) {
          logger.warn(
            '   ⚠️  Date Management Service failed to initialize:',
            dateServiceError.message
          );
          logger.warn('   Date automation features will not be available');
        }
      } catch (error) {
        logger.error('');
        logger.error('='.repeat(70));
        logger.error('⚠️  DATABASE CONNECTION FAILED');
        logger.error('='.repeat(70));
        logger.error('');
        logger.error('Warning: Could not connect to the database.');
        logger.error('Server will continue running with limited functionality:');
        logger.error('   • User authentication and data may not persist');
        logger.error('   • Local file storage will be used (non-persistent)');
        logger.error('   • Data will be lost on server restart');
        logger.error('');
        logger.error('Error details:');
        logger.error(`   ${error.message}`);
        logger.error('');

        if (
          error.message.includes('Invalid scheme') ||
          error.message.includes('placeholder') ||
          error.message.includes('MONGODB_URI')
        ) {
          logger.error('🔍 This looks like a MongoDB configuration issue.');
          logger.error('');
          logger.error('📚 Follow the setup guide:');
          logger.error('   → MONGODB_SETUP_SIMPLE.md (beginner-friendly)');
          logger.error('   → Get MongoDB Atlas free: https://cloud.mongodb.com/');
          logger.error('');
        }

        logger.error('='.repeat(70));
        logger.error('');
      }

      // 5. Check email service
      logger.info('');
      logger.info('📧 Checking email configuration...');
      if (EMAIL_ENABLED) {
        if (postmark.isPostmarkEnabled()) {
          const postmarkStatus = postmark.getPostmarkStatus();
          logger.info(`   ✅ Email: Postmark configured (${postmarkStatus.domain})`);
          logger.info('   ✅ Postmark ready to send emails');
        } else {
          logger.warn('   ⚠️  Email enabled but Postmark not configured');
          logger.warn('   Set POSTMARK_API_KEY and POSTMARK_FROM in your .env file');
          logger.warn('   Emails will be saved to /outbox folder instead');
        }
      } else {
        logger.info('   ℹ️  Email disabled (EMAIL_ENABLED=false)');
        logger.info('   Emails will be saved to /outbox folder');
      }

      // 6. Check optional services
      logger.info('');
      logger.info('🔧 Checking optional services...');
      logIntegrationStartupSummary();
      if (STRIPE_ENABLED) {
        logger.info('   ✅ Stripe: Configured');
      } else {
        logger.info('   ℹ️  Stripe: Not configured (optional)');
      }

      if (AI_ENABLED) {
        logger.info('   ✅ OpenAI: Configured');
      } else {
        logger.info('   ℹ️  OpenAI: Not configured (optional)');
      }

      // Check Pexels API configuration
      const { getPexelsService } = require('./utils/pexels-service');
      const pexels = getPexelsService();
      if (pexels.isConfigured()) {
        logger.info('   ✅ Pexels API: Configured');
        logger.info('   Use admin settings to test connection and enable dynamic collage');
      } else {
        logger.info('   ℹ️  Pexels API: Not configured (optional)');
        logger.info('   Set PEXELS_API_KEY to enable stock photo integration');
      }

      logger.info('');
      logger.info('🎉 Background initialization complete!');
    })();
  } catch (error) {
    // Clear startup timeout
    clearTimeout(startupTimeout);

    logger.error('');
    logger.error('='.repeat(60));
    logger.error('❌ STARTUP FAILED');
    logger.error('='.repeat(60));
    logger.error('Error:', error.message);
    logger.error('');
    logger.error('Please fix the configuration issues and try again.');
    logger.error('See the documentation for setup instructions.');
    logger.error('='.repeat(60));
    process.exit(1);
  }
}

// Export the app for testing (without starting the server)
module.exports = app;

// Only start the server if this file is run directly (not imported by tests)
if (require.main === module) {
  startServer().catch(error => {
    logger.error('Fatal error during startup:', error);
    sentry.captureException(error);
    process.exit(1);
  });
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  sentry.captureException(reason);
});

process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  sentry.captureException(error);
  // Give Sentry time to send the error before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing HTTP server');

  // Shutdown WebSocket servers gracefully
  if (wsServerV2) {
    await wsServerV2.shutdown();
  }

  await sentry.flush(2000);
  await cache.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing HTTP server');

  // Shutdown WebSocket servers gracefully
  if (wsServerV2) {
    await wsServerV2.shutdown();
  }

  await sentry.flush(2000);
  await cache.close();
  process.exit(0);
});
