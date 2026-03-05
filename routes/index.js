/**
 * Routes Index
 * Main router mounting point for all application routes
 */

'use strict';

const express = require('express');
const router = express.Router();

// Import route modules
const systemRoutes = require('./system');
const publicRoutes = require('./public');
const authRoutes = require('./auth');
const adminRoutes = require('./admin');
const adminDebugRoutes = require('./admin-debug');
const newsletterRoutes = require('./newsletter');
const paymentsRoutes = require('./payments');
const pexelsRoutes = require('./pexels');
const profileRoutes = require('./profile');
const reportsRoutes = require('./reports');
const reviewsV2Routes = require('./reviews-v2');
const ticketsRoutes = require('./tickets');
const webhooksRoutes = require('./webhooks');
const searchV2Routes = require('./search-v2');
const shortlistRoutes = require('./shortlist');
const quoteRequestsRoutes = require('./quote-requests');
const analyticsRoutes = require('./analytics');
const plansRoutes = require('./plans');
const guestsRoutes = require('./guests');
const savedRoutes = require('./saved');
const supplierRoutes = require('./supplier');
const supplierAdminRoutes = require('./supplier-admin');
const supplierManagementRoutes = require('./supplier-management');
const suppliersV2Routes = require('./suppliers-v2');

// New extracted route modules
const suppliersRoutes = require('./suppliers');
const packagesRoutes = require('./packages');
const categoriesRoutes = require('./categories');
const plansLegacyRoutes = require('./plans-legacy');
const marketplaceRoutes = require('./marketplace');
const discoveryRoutes = require('./discovery');
const searchRoutes = require('./search');
const reviewsRoutes = require('./reviews');
const photosRoutes = require('./photos');
const metricsRoutes = require('./metrics');
const cacheRoutes = require('./cache');
const miscRoutes = require('./misc');
const notificationsRoutes = require('./notifications');
const adminConfigRoutes = require('./admin-config');
const twoFactorRoutes = require('./twoFactor');
const phoneVerificationRoutes = require('./phoneVerification');
const emailVerificationRoutes = require('./emailVerification');

/**
 * Mount all route modules
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies to inject into routes
 */
function mountRoutes(app, deps) {
  // System routes (health, config, meta) - must be first for health checks
  if (deps) {
    systemRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', systemRoutes);
  app.use('/api', systemRoutes); // Backward compatibility

  // Public routes (no auth required) - mount early to avoid auth middleware
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/public', publicRoutes); // Backward compatibility

  // Auth routes (registration, login, logout, etc.)
  if (deps && authRoutes.initializeDependencies) {
    authRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/auth', authRoutes); // Backward compatibility

  // Email verification routes
  app.use('/api/v1/auth', emailVerificationRoutes);
  app.use('/api/auth', emailVerificationRoutes); // Backward compatibility

  // Two-factor authentication routes
  app.use('/api/v1/me/2fa', twoFactorRoutes);
  app.use('/api/me/2fa', twoFactorRoutes); // Backward compatibility

  // Phone verification routes
  app.use('/api/v1/me/phone', phoneVerificationRoutes);
  app.use('/api/me/phone', phoneVerificationRoutes); // Backward compatibility

  // Admin routes
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/admin', adminRoutes); // Backward compatibility

  // Admin debug routes (emergency auth debugging)
  app.use('/api/v1/admin/debug', adminDebugRoutes);
  app.use('/api/admin/debug', adminDebugRoutes); // Backward compatibility

  // Newsletter routes (public, no auth required)
  app.use('/api/v1/newsletter', newsletterRoutes);
  app.use('/api/newsletter', newsletterRoutes); // Backward compatibility

  // Payment routes
  app.use('/api/v1/payments', paymentsRoutes);
  app.use('/api/payments', paymentsRoutes); // Backward compatibility

  // Billing alias routes (used by app.js supplier upgrade flow)
  // Shared key resolution: prefer STRIPE_SECRET_KEY, fall back to STRIPE_SECRET_KEY_LIVE
  const getBillingStripeKey = () =>
    process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LIVE || '';

  // GET /api/v1/billing/config - returns whether Stripe billing is enabled
  app.get('/api/v1/billing/config', (_req, res) => {
    res.json({ enabled: !!getBillingStripeKey() });
  });

  // POST /api/v1/billing/checkout - creates a Stripe checkout session for the default Pro plan
  app.post('/api/v1/billing/checkout', deps.authRequired, deps.csrfProtection, async (req, res) => {
    try {
      const stripeKey = getBillingStripeKey();
      if (!stripeKey) {
        return res.status(503).json({ error: 'Stripe is not configured' });
      }
      const stripeLib = require('stripe');
      const stripe = stripeLib(stripeKey);
      const priceId = process.env.STRIPE_PRO_PRICE_ID;
      if (!priceId) {
        return res.status(503).json({ error: 'Stripe price ID is not configured' });
      }
      const paymentService = require('../services/paymentService');
      const customer = await paymentService.getOrCreateStripeCustomer(req.user);
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/dashboard/supplier?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
        metadata: { userId: req.user.id, planId: 'pro' },
      });
      res.json({ url: session.url });
    } catch (err) {
      const logger = require('../utils/logger');
      logger.error('billing/checkout error:', err.message);
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  // Pexels image search routes
  app.use('/api/v1/pexels', pexelsRoutes);
  app.use('/api/pexels', pexelsRoutes); // Backward compatibility

  // Profile routes
  app.use('/api/v1/profile', profileRoutes);
  app.use('/api/profile', profileRoutes); // Backward compatibility

  // Reports routes
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/reports', reportsRoutes); // Backward compatibility

  // Reviews routes (public endpoint at /api/reviews for homepage testimonials)
  // Note: /api/v2/reviews is mounted separately in server.js for v2 API endpoints
  app.use('/api/v1/reviews', reviewsV2Routes);
  app.use('/api/reviews', reviewsV2Routes); // Backward compatibility

  // Tickets routes
  app.use('/api/v1/tickets', ticketsRoutes);
  app.use('/api/tickets', ticketsRoutes); // Backward compatibility

  // Webhook routes
  app.use('/api/v1/webhooks', webhooksRoutes);
  app.use('/api/webhooks', webhooksRoutes); // Backward compatibility

  // Search V2 routes (advanced search with caching and analytics)
  app.use('/api/v2/search', searchV2Routes);

  // Shortlist routes (user favorites)
  app.use('/api/v1/shortlist', shortlistRoutes);
  app.use('/api/shortlist', shortlistRoutes); // Backward compatibility

  // Quote request routes (customer to supplier inquiries)
  app.use('/api/v1/quote-requests', quoteRequestsRoutes);
  app.use('/api/quote-requests', quoteRequestsRoutes); // Backward compatibility

  // Analytics routes (event tracking)
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/analytics', analyticsRoutes); // Backward compatibility

  // Plans routes (user wedding/event plans)
  app.use('/api/v1/me/plans', plansRoutes);
  app.use('/api/me/plans', plansRoutes); // Backward compatibility

  // Guests routes (guest list management for plans)
  app.use('/api/v1/me/plans', guestsRoutes);
  app.use('/api/me/plans', guestsRoutes); // Backward compatibility

  // Saved items routes (user favorites)
  app.use('/api/v1/me/saved', savedRoutes);
  app.use('/api/me/saved', savedRoutes); // Backward compatibility

  // Supplier routes (trial activation, analytics)
  app.use('/api/v1/supplier', supplierRoutes);
  app.use('/api/supplier', supplierRoutes); // Backward compatibility

  // Supplier Admin routes (admin-only supplier management)
  if (deps && supplierAdminRoutes.initializeDependencies) {
    supplierAdminRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin', supplierAdminRoutes);
  app.use('/api/admin', supplierAdminRoutes); // Backward compatibility

  // Supplier Management routes (supplier owner CRUD and analytics)
  if (deps && supplierManagementRoutes.initializeDependencies) {
    supplierManagementRoutes.initializeDependencies(deps);
  }
  // Mount at /api/me/suppliers for routes like POST /api/me/suppliers, PATCH /api/me/suppliers/:id
  app.use('/api/v1/me/suppliers', supplierManagementRoutes);
  app.use('/api/me/suppliers', supplierManagementRoutes); // Backward compatibility
  // Also mount at /api/me for /api/me/subscription/upgrade route
  app.use('/api/v1/me', supplierManagementRoutes);
  app.use('/api/me', supplierManagementRoutes); // Backward compatibility

  // Suppliers V2 routes (photo gallery management)
  if (deps && suppliersV2Routes.initializeDependencies) {
    suppliersV2Routes.initializeDependencies(deps);
  }
  app.use('/api/v1/me/suppliers', suppliersV2Routes);
  app.use('/api/me/suppliers', suppliersV2Routes); // Backward compatibility

  // ===== NEW EXTRACTED ROUTES (from server.js refactor) =====

  // Suppliers & Packages routes (Phase 1)
  if (deps && suppliersRoutes.initializeDependencies) {
    suppliersRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', suppliersRoutes);
  app.use('/api', suppliersRoutes); // Backward compatibility

  // Packages routes (Phase 1 - Step 1)
  if (deps && packagesRoutes.initializeDependencies) {
    packagesRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', packagesRoutes);
  app.use('/api', packagesRoutes); // Backward compatibility

  // Categories routes (Phase 2)
  if (deps && categoriesRoutes.initializeDependencies) {
    categoriesRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/categories', categoriesRoutes);
  app.use('/api/categories', categoriesRoutes); // Backward compatibility

  // Plans Legacy & Notes routes (Phase 3)
  if (deps && plansLegacyRoutes.initializeDependencies) {
    plansLegacyRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', plansLegacyRoutes);
  app.use('/api', plansLegacyRoutes); // Backward compatibility

  // Marketplace routes (Phase 4)
  if (deps && marketplaceRoutes.initializeDependencies) {
    marketplaceRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/marketplace', marketplaceRoutes);
  app.use('/api/marketplace', marketplaceRoutes); // Backward compatibility

  // Discovery routes (Phase 5)
  if (deps && discoveryRoutes.initializeDependencies) {
    discoveryRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/discovery', discoveryRoutes);
  app.use('/api/discovery', discoveryRoutes); // Backward compatibility

  // Search routes (Phase 5)
  if (deps && searchRoutes.initializeDependencies) {
    searchRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/search', searchRoutes);
  app.use('/api/search', searchRoutes); // Backward compatibility

  // Reviews routes (Phase 5)
  if (deps && reviewsRoutes.initializeDependencies) {
    reviewsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', reviewsRoutes);
  app.use('/api', reviewsRoutes); // Backward compatibility

  // Photos routes (Phase 6)
  if (deps && photosRoutes.initializeDependencies) {
    photosRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', photosRoutes);
  app.use('/api', photosRoutes); // Backward compatibility

  // Metrics routes (Phase 7)
  if (deps && metricsRoutes.initializeDependencies) {
    metricsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', metricsRoutes);
  app.use('/api', metricsRoutes); // Backward compatibility

  // Cache routes (Phase 7)
  if (deps && cacheRoutes.initializeDependencies) {
    cacheRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin/cache', cacheRoutes);
  app.use('/api/admin/cache', cacheRoutes); // Backward compatibility
  app.use('/api/v1/admin', cacheRoutes); // For /database/metrics route
  app.use('/api/admin', cacheRoutes); // For /database/metrics route - Backward compatibility

  // Miscellaneous routes (Phase 7)
  if (deps && miscRoutes.initializeDependencies) {
    miscRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', miscRoutes);
  app.use('/api', miscRoutes); // Backward compatibility

  // Notifications routes (Step 4 - Server.js refactoring)
  if (deps && notificationsRoutes.initializeDependencies) {
    notificationsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/notifications', notificationsRoutes); // Backward compatibility

  // Admin Config routes (Step 8 - Badge & Category Management)
  if (deps && adminConfigRoutes.initializeDependencies) {
    adminConfigRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin', adminConfigRoutes);
  app.use('/api/admin', adminConfigRoutes); // Backward compatibility

  // ===== MESSENGER V4 ROUTES (Next Generation Messaging System) =====
  // Purpose-built, gold standard real-time chat platform with liquid glass design
  const messengerV4 = require('./messenger-v4');
  if (deps && messengerV4.initialize) {
    // Pass mongoDb module for lazy db initialization in routes
    const messengerV4Deps = { ...deps };
    messengerV4Deps.db = deps.mongoDb; // Pass module, routes will call getDb() when needed
    // Pass the getter function, NOT the resolved value - the WS server is initialized
    // after HTTP listen() so it would be null if resolved here at startup.
    messengerV4Deps.getWebSocketServer = deps.getWebSocketServer || null;
    const messengerV4Router = messengerV4.initialize(messengerV4Deps);
    app.use('/api/v4/messenger', messengerV4Router);
  }

  // ===== LEGACY REDIRECTS =====
  // Redirect old messages page to new messenger
  app.get('/messages', (req, res) => res.redirect(301, '/messenger/'));
  app.get('/messages.html', (req, res) => res.redirect(301, '/messenger/'));

  // Redirect old conversation page to new messenger
  app.get('/conversation', (req, res) => {
    const id = req.query.id;
    if (id) {
      return res.redirect(301, `/messenger/?conversation=${id}`);
    }
    return res.redirect(301, '/messenger/');
  });
  app.get('/conversation.html', (req, res) => {
    const id = req.query.id;
    if (id) {
      return res.redirect(301, `/messenger/?conversation=${id}`);
    }
    return res.redirect(301, '/messenger/');
  });
  // Redirect /conversation/:id path-param style URLs
  app.get('/conversation/:id', (req, res) => {
    return res.redirect(301, `/messenger/?conversation=${encodeURIComponent(req.params.id)}`);
  });
}

module.exports = {
  router,
  mountRoutes,
};
