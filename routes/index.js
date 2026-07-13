/**
 * Routes Index
 * Main router mounting point for all application routes
 */

'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../utils/logger');

// Import route modules
const systemRoutes = require('./system');
const publicRoutes = require('./public');
const authRoutes = require('./auth');
const googleRedirectAuthRoutes = require('./google-redirect-auth');
const adminRoutes = require('./admin');
const adminHomepageCollageActiveRoutes = require('./admin-homepage-collage-active');
const adminHomepageManagerRoutes = require('./admin-homepage-manager');
const adminManagementRoutes = require('./admin-management');
const systemChecksAdminRoutes = require('./system-checks-admin');
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
const behaviourAnalyticsRoutes = require('./behaviour-analytics');
const plansRoutes = require('./plans');
const guestsRoutes = require('./guests');
const weddingWebsiteRoutes = require('./wedding-websites');
const weddingThemeMediaRoutes = require('./wedding-theme-media');
const savedRoutes = require('./saved');
const supplierRoutes = require('./supplier');
const supplierAdminRoutes = require('./supplier-admin');
const supplierManagementRoutes = require('./supplier-management');
const suppliersV2Routes = require('./suppliers-v2');
const supplierProfileSafeRoutes = require('./supplier-profile-safe');
const supplierProfilePackageCardRoutes = require('./supplier-profile-package-cards');
const publicSupplierAvatarRoutes = require('./public-supplier-avatar');
const partnerReferralCampaignCapture = require('../middleware/partnerReferralCampaignCapture');

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
const captchaRoutes = require('./captcha');
const contactRoutes = require('./contact');
const maintenanceRoutes = require('./maintenance');
const cspRoutes = require('./csp');
const { legacyApiDeprecation } = require('../middleware/legacyApiDeprecation');
const notificationsRoutes = require('./notifications');
const adminConfigRoutes = require('./admin-config');
const twoFactorRoutes = require('./twoFactor');
const phoneVerificationRoutes = require('./phoneVerification');
const emailVerificationRoutes = require('./emailVerification');
const catalogRoutes = require('./catalog');
const publicCalendarRoutes = require('./public-calendar');
const customerCalendarRoutes = require('./customer-calendar');
const customerDashboardRoutes = require('./customer-dashboard');
const emailUnsubscribeRoutes = require('./emailUnsubscribe');
const telemetryRoutes = require('./telemetry');

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

  // JadeAssist catalog API (read-only, API-key protected when CATALOG_API_KEY is set)
  app.use('/api/catalog', catalogRoutes);

  // Public calendar API (read for all, write for publisher suppliers / admins)
  app.use('/api/v1/public-calendar', publicCalendarRoutes);
  app.use('/api/public-calendar', publicCalendarRoutes); // Backward compatibility

  // Partner portal API routes (public partner signup + authenticated dashboard)
  const partnerRoutes = require('./partner');
  app.use('/api/v1/partner', partnerRoutes);
  app.use('/api/partner', partnerRoutes); // Backward compatibility

  // Admin partner moderation routes
  const adminPartnerRoutes = require('./admin-partner');
  app.use('/api/v1/admin/partners', adminPartnerRoutes);
  app.use('/api/admin/partners', adminPartnerRoutes); // Backward compatibility

  // Admin cashout request routes
  const adminCashoutRequestsRoutes = require('./admin-cashout-requests');
  app.use('/api/v1/admin/cashout-requests', adminCashoutRequestsRoutes);
  app.use('/api/admin/cashout-requests', adminCashoutRequestsRoutes); // Backward compatibility

  // Public routes (no auth required) - mount early to avoid auth middleware
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/public', publicRoutes); // Backward compatibility

  // Auth routes (registration, login, logout, etc.)
  if (deps && authRoutes.initializeDependencies) {
    authRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/auth', partnerReferralCampaignCapture, authRoutes);
  app.use('/api/auth', partnerReferralCampaignCapture, authRoutes); // Backward compatibility

  // Sign in with Google redirect-mode callback. This is mounted separately from
  // the JSON auth API because Google posts x-www-form-urlencoded credentials.
  app.use('/api/v1/auth', googleRedirectAuthRoutes);
  app.use('/api/auth', googleRedirectAuthRoutes); // Backward compatibility

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
  app.use('/api/v1/admin/homepage/manager', adminHomepageManagerRoutes);
  app.use('/api/v1/admin/homepage', adminHomepageManagerRoutes);
  app.use('/api/admin/homepage/manager', adminHomepageManagerRoutes); // Backward compatibility
  app.use('/api/admin/homepage', adminHomepageManagerRoutes); // Backward compatibility
  app.use('/api/v1/admin/management', adminManagementRoutes);
  app.use('/api/admin/management', adminManagementRoutes); // Backward compatibility
  app.use('/api/v1/admin', adminHomepageCollageActiveRoutes);
  app.use('/api/admin', adminHomepageCollageActiveRoutes); // Backward compatibility
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/admin', adminRoutes); // Backward compatibility

  // Admin campaigns routes
  const adminCampaignsRoutes = require('./admin-campaigns');
  app.use('/api/v1/admin/campaigns', adminCampaignsRoutes);
  app.use('/api/admin/campaigns', adminCampaignsRoutes); // Backward compatibility

  // Admin email preview routes
  const adminEmailPreviewRoutes = require('./admin-email-previews');
  app.use('/api/v1/admin/email-previews', adminEmailPreviewRoutes);
  app.use('/api/admin/email-previews', adminEmailPreviewRoutes); // Backward compatibility

  // Admin Email Centre and sent email log routes
  const adminEmailCentreRoutes = require('./admin-email-centre');
  const adminEmailLogsRoutes = require('./admin-email-logs');
  app.use('/api/v1/admin/email-centre', adminEmailCentreRoutes);
  app.use('/api/admin/email-centre', adminEmailCentreRoutes); // Backward compatibility
  app.use('/api/v1/admin/email-logs', adminEmailLogsRoutes);
  app.use('/api/admin/email-logs', adminEmailLogsRoutes); // Backward compatibility

  // Postmark delivery webhooks (Basic Auth protected, no admin session required)
  const postmarkWebhookRoutes = require('./postmark-webhook');
  app.use('/api/v1/webhooks', postmarkWebhookRoutes);
  app.use('/api/webhooks', postmarkWebhookRoutes); // Backward compatibility

  // System-checks admin routes
  app.use('/api/v1/admin', systemChecksAdminRoutes);
  app.use('/api/admin', systemChecksAdminRoutes); // Backward compatibility

  // Admin debug routes (emergency auth debugging)
  const isProduction = process.env.NODE_ENV === 'production';
  const debugRoutesEnabled = process.env.ENABLE_ADMIN_DEBUG_ROUTES === 'true';

  // Status endpoint is ALWAYS mounted so the UI can query whether tools are enabled.
  const adminDebugStatusRoutes = require('./admin-debug-status');
  app.use('/api/v1/admin/debug', adminDebugStatusRoutes);
  app.use('/api/admin/debug', adminDebugStatusRoutes); // Backward compatibility

  // Webhook test endpoint is ALWAYS mounted (including production) — it is a
  // read-only health check (no data mutation) protected by admin auth + CSRF.
  const adminWebhooksTestRoutes = require('./admin-webhooks-test');
  app.use('/api/v1/admin/debug', adminWebhooksTestRoutes);
  app.use('/api/admin/debug', adminWebhooksTestRoutes); // Backward compatibility

  if (!isProduction && debugRoutesEnabled) {
    const adminDebugRoutes = require('./admin-debug');
    app.use('/api/v1/admin/debug', adminDebugRoutes);
    app.use('/api/admin/debug', adminDebugRoutes); // Backward compatibility
    adminDebugStatusRoutes.setDebugRoutesStatus(true, '');
    logger.info(
      '[admin-debug] Debug routes ENABLED (non-production + ENABLE_ADMIN_DEBUG_ROUTES=true)'
    );
  } else {
    const disabledReason = isProduction
      ? 'production environment'
      : 'ENABLE_ADMIN_DEBUG_ROUTES not set to true';
    adminDebugStatusRoutes.setDebugRoutesStatus(false, disabledReason);
    logger.info(
      `[admin-debug] Debug routes DISABLED and NOT mounted${isProduction ? ' (production environment)' : ' (ENABLE_ADMIN_DEBUG_ROUTES not set to true)'}`
    );
  }

  // Newsletter routes (public, no auth required)
  app.use('/api/v1/newsletter', newsletterRoutes);
  app.use('/api/newsletter', newsletterRoutes); // Backward compatibility

  // Payment routes
  app.use('/api/v1/payments', paymentsRoutes);
  app.use('/api/payments', paymentsRoutes); // Backward compatibility

  // Billing alias routes (used by app.js supplier upgrade flow)
  const getBillingStripeKey = () =>
    process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LIVE || '';
  app.get('/api/v1/billing/config', (_req, res) => {
    res.json({ enabled: !!getBillingStripeKey() });
  });
  app.post('/api/v1/billing/checkout', deps.authRequired, deps.csrfProtection, async (req, res) => {
    try {
      const stripeKey = getBillingStripeKey();
      if (!stripeKey) {
        return res.status(503).json({ error: 'Stripe is not configured' });
      }
      const stripeLib = require('stripe');
      const stripe = stripeLib(stripeKey, { apiVersion: '2025-12-15.clover' });
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

  app.use('/api/v1/pexels', pexelsRoutes);
  app.use('/api/pexels', pexelsRoutes);
  app.use('/api/v1/profile', profileRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/v1/reviews', reviewsV2Routes);
  app.use('/api/reviews', reviewsV2Routes);
  app.use('/api/v1/tickets', ticketsRoutes);
  app.use('/api/tickets', ticketsRoutes);
  app.use('/api/v1/webhooks', webhooksRoutes);
  app.use('/api/webhooks', webhooksRoutes);
  app.use('/api/v2/search', searchV2Routes);

  // Wedding website and RSVP routes
  app.use('/api/v1/me/plans', weddingThemeMediaRoutes);
  app.use('/api/me/plans', weddingThemeMediaRoutes);
  app.use('/api/v1', weddingThemeMediaRoutes);
  app.use('/api', weddingThemeMediaRoutes);
  app.use('/api/v1/me/plans', weddingWebsiteRoutes);
  app.use('/api/me/plans', weddingWebsiteRoutes); // Backward compatibility
  app.use('/api/v1', weddingWebsiteRoutes);
  app.use('/api', weddingWebsiteRoutes); // Backward compatibility

  app.use('/api/v1/shortlist', shortlistRoutes);
  app.use('/api/shortlist', shortlistRoutes);
  app.use('/api/v1/quote-requests', quoteRequestsRoutes);
  app.use('/api/quote-requests', quoteRequestsRoutes);
  app.use('/api/v1/analytics/behaviour', behaviourAnalyticsRoutes);
  app.use('/api/analytics/behaviour', behaviourAnalyticsRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/v1/me/plans', plansRoutes);
  app.use('/api/me/plans', plansRoutes);
  app.use('/api/v1/me/calendar-entries', customerCalendarRoutes);
  app.use('/api/me/calendar-entries', customerCalendarRoutes);

  // Customer dashboard aggregated API
  app.use('/api/v1/customer', customerDashboardRoutes);
  app.use('/api/customer', customerDashboardRoutes);
  app.use('/api/v1/me/plans', guestsRoutes);
  app.use('/api/me/plans', guestsRoutes);
  app.use('/api/v1/me/saved', savedRoutes);
  app.use('/api/me/saved', savedRoutes);
  app.use('/api/v1/supplier', supplierRoutes);
  app.use('/api/supplier', supplierRoutes);

  if (deps && supplierAdminRoutes.initializeDependencies) {
    supplierAdminRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin', supplierAdminRoutes);
  app.use('/api/admin', supplierAdminRoutes);
  if (deps && supplierManagementRoutes.initializeDependencies) {
    supplierManagementRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/me/suppliers', supplierManagementRoutes);
  app.use('/api/me/suppliers', supplierManagementRoutes);
  app.use('/api/v1/me', supplierManagementRoutes);
  app.use('/api/me', supplierManagementRoutes);
  if (deps && suppliersV2Routes.initializeDependencies) {
    suppliersV2Routes.initializeDependencies(deps);
  }
  app.use('/api/v1/me/suppliers', suppliersV2Routes);
  app.use('/api/me/suppliers', suppliersV2Routes);

  if (deps && supplierProfilePackageCardRoutes.initializeDependencies) {
    supplierProfilePackageCardRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', supplierProfilePackageCardRoutes);
  app.use('/api', supplierProfilePackageCardRoutes);
  if (deps && publicSupplierAvatarRoutes.initializeDependencies) {
    publicSupplierAvatarRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', publicSupplierAvatarRoutes);
  app.use('/api', publicSupplierAvatarRoutes);
  if (deps && supplierProfileSafeRoutes.initializeDependencies) {
    supplierProfileSafeRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', supplierProfileSafeRoutes);
  app.use('/api', supplierProfileSafeRoutes);
  if (deps && suppliersRoutes.initializeDependencies) {
    suppliersRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', suppliersRoutes);
  app.use('/api', suppliersRoutes);
  if (deps && packagesRoutes.initializeDependencies) {
    packagesRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', packagesRoutes);
  app.use('/api', packagesRoutes);
  if (deps && categoriesRoutes.initializeDependencies) {
    categoriesRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/categories', categoriesRoutes);
  app.use('/api/categories', categoriesRoutes);
  if (deps && plansLegacyRoutes.initializeDependencies) {
    plansLegacyRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', plansLegacyRoutes);
  app.use('/api', plansLegacyRoutes);
  if (deps && marketplaceRoutes.initializeDependencies) {
    marketplaceRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/marketplace', marketplaceRoutes);
  app.use('/api/marketplace', marketplaceRoutes);
  if (deps && discoveryRoutes.initializeDependencies) {
    discoveryRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/discovery', discoveryRoutes);
  app.use('/api/discovery', discoveryRoutes);
  if (deps && searchRoutes.initializeDependencies) {
    searchRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/search', searchRoutes);
  app.use('/api/search', searchRoutes);
  if (deps && reviewsRoutes.initializeDependencies) {
    reviewsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', reviewsRoutes);
  app.use('/api', reviewsRoutes);
  if (deps && photosRoutes.initializeDependencies) {
    photosRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', photosRoutes);
  app.use('/api', photosRoutes);
  if (deps && metricsRoutes.initializeDependencies) {
    metricsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', metricsRoutes);
  app.use('/api', metricsRoutes);
  if (deps && cacheRoutes.initializeDependencies) {
    cacheRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin/cache', cacheRoutes);
  app.use('/api/admin/cache', cacheRoutes);
  app.use('/api/v1/admin', cacheRoutes);
  app.use('/api/admin', cacheRoutes);
  if (deps && miscRoutes.initializeDependencies) {
    miscRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', miscRoutes);
  app.use('/api', legacyApiDeprecation('/api', '/api/v1'), miscRoutes);
  if (deps && captchaRoutes.initializeDependencies) {
    captchaRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', captchaRoutes);
  app.use('/api', legacyApiDeprecation('/api', '/api/v1'), captchaRoutes);
  if (deps && contactRoutes.initializeDependencies) {
    contactRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', contactRoutes);
  app.use('/api', legacyApiDeprecation('/api', '/api/v1'), contactRoutes);
  if (deps && maintenanceRoutes.initializeDependencies) {
    maintenanceRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', maintenanceRoutes);
  app.use('/api', legacyApiDeprecation('/api', '/api/v1'), maintenanceRoutes);
  if (deps && cspRoutes.initializeDependencies) {
    cspRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1', cspRoutes);
  app.use('/api', legacyApiDeprecation('/api', '/api/v1'), cspRoutes);
  if (deps && notificationsRoutes.initializeDependencies) {
    notificationsRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/v1/telemetry', telemetryRoutes);
  app.use('/api/telemetry', telemetryRoutes);
  if (deps && adminConfigRoutes.initializeDependencies) {
    adminConfigRoutes.initializeDependencies(deps);
  }
  app.use('/api/v1/admin', adminConfigRoutes);
  app.use('/api/admin', adminConfigRoutes);

  require('../services/messenger-v4-lifecycle-patch');
  const messengerV4 = require('./messenger-v4');
  if (deps && messengerV4.initialize) {
    const messengerV4Deps = { ...deps };
    messengerV4Deps.db = deps.mongoDb;
    messengerV4Deps.getWebSocketServer = deps.getWebSocketServer || null;
    const messengerV4Router = messengerV4.initialize(messengerV4Deps);
    app.use('/api/v4/messenger', messengerV4Router);
  }

  app.get('/messages', (req, res) => res.redirect(301, '/messenger/'));
  app.get('/messages.html', (req, res) => res.redirect(301, '/messenger/'));
  app.use('/email', emailUnsubscribeRoutes);
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
  app.get('/conversation/:id', (req, res) =>
    res.redirect(301, `/messenger/?conversation=${encodeURIComponent(req.params.id)}`)
  );
}

module.exports = {
  router,
  mountRoutes,
};
