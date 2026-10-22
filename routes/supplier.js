/**
 * Supplier Routes
 * Handles supplier-specific functionality (trial activation, analytics, etc.)
 */

'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const {
  getSupplierGalleryCount,
  getSupplierSocialLinkCount,
} = require('../services/supplierProfileCompleteness');
const { parseDaysParam, resolveAnalyticsWindow } = require('../utils/analyticsWindow');
const { buildDashboardSummary, summariseReviews } = require('../services/supplierDashboardSummary');
const supplierEnquiries = require('../services/supplierEnquiries');
const { VALID_CATEGORIES } = require('../models/Supplier');
const { isApprovedReview } = require('../utils/reviewShape');
const { clearEngagementCache } = require('../services/supplierEngagementMetrics');
const { serializeCsv } = require('../utils/csv');

const router = express.Router();

// Initialize Stripe at module level to avoid creating a new instance per request
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey
  ? require('stripe')(stripeSecretKey, { apiVersion: '2025-12-15.clover' })
  : null;

// Constants
const TRIAL_DURATION_DAYS = 14;
const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/supplier/trial/activate
 * Activate free trial for supplier
 */
router.post('/trial/activate', authRequired, csrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is a supplier
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can activate trials' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    // Check if trial already used
    if (supplier.trialUsed) {
      return res.status(400).json({ error: 'Trial has already been used' });
    }

    // Check if already on trial or active subscription
    if (supplier.subscriptionStatus === 'trial' || supplier.subscriptionStatus === 'active') {
      return res.status(400).json({ error: 'Already on an active subscription or trial' });
    }

    // Set trial
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      {
        $set: {
          subscriptionStatus: 'trial',
          trialStartedAt: now.toISOString(),
          trialEndsAt: trialEndsAt.toISOString(),
          trialUsed: true,
          updatedAt: now.toISOString(),
        },
      }
    );

    res.json({
      success: true,
      message: 'Trial activated successfully',
      trial: {
        status: 'trial',
        startedAt: now.toISOString(),
        endsAt: trialEndsAt.toISOString(),
        daysRemaining: TRIAL_DURATION_DAYS,
      },
    });
  } catch (error) {
    logger.error('Error activating trial:', error);
    res.status(500).json({
      error: 'Failed to activate trial',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/supplier/analytics
 * Get real analytics for supplier using supplierAnalytics utility
 */
router.get('/analytics', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is a supplier
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access analytics' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // How far back this supplier may look is a plan entitlement: every tier
    // sees its own analytics, the paid plans see more history. Without this
    // the pricing page was selling "profile analytics" as a paid feature that
    // free suppliers already had in full.
    const subscriptionService = require('../services/subscriptionService');
    const planWindowDays = await subscriptionService.getAnalyticsWindowDays(userId);
    // Same bounded, entitlement-capped window as the dashboard summary. This route has
    // always let the longest plan (365 days) look that far back, so its request cap is 365.
    const analyticsWindow = resolveAnalyticsWindow({
      requested: parseDaysParam(req.query.days).value,
      defaultDays: 7,
      planWindowDays,
      requestCap: 365,
    });

    // Use supplierAnalytics utility for real tracked data
    const supplierAnalytics = require('../utils/supplierAnalytics');
    const analytics = await supplierAnalytics.getSupplierAnalytics(
      supplierId,
      analyticsWindow.days,
      { ownerUserId: userId }
    );

    res.json({
      success: true,
      analytics,
      // Surfaced so the dashboard can say why a longer window came back short
      // rather than silently showing less than was asked for.
      window: analyticsWindow,
    });
  } catch (error) {
    logger.error('Error fetching analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/supplier/analytics/legacy
 * Get legacy analytics for supplier (count-based, for backwards compatibility)
 */
router.get('/analytics/legacy', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is a supplier
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access analytics' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // Same plan entitlement as the other analytics routes: a Starter supplier gets 7 days.
    const { days } = resolveAnalyticsWindow({
      requested: parseDaysParam(req.query.days).value,
      defaultDays: DEFAULT_ANALYTICS_WINDOW_DAYS,
      planWindowDays: await require('../services/subscriptionService').getAnalyticsWindowDays(
        userId
      ),
    });

    // Count enquiries from message threads
    const enquiries = await dbUnified.find('threads', { supplierId });
    const enquiryCount = enquiries.length;

    // Count views from analytics events
    const analyticsEvents = await dbUnified.read('analyticsEvents');
    const viewEvents = analyticsEvents.filter(
      e => e.event === 'supplier_view' && e.supplierId === supplierId
    );
    const viewCount = viewEvents.length;

    // Count bookings (from bookings or orders)
    let bookingCount = 0;
    try {
      const bookings = await dbUnified.find('bookings', { supplierId });
      bookingCount = bookings.length;
    } catch (e) {
      // bookings collection may not exist
      logger.debug('Bookings collection not available:', e.message);
    }

    // Generate chart data for last N days
    const now = new Date();
    const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const last30DaysViews = viewEvents.filter(e => {
      const eventDate = new Date(e.timestamp || e.createdAt);
      return eventDate >= windowStart;
    });

    const last30DaysEnquiries = enquiries.filter(e => {
      const eventDate = new Date(e.createdAt);
      return eventDate >= windowStart;
    });

    // Group by date
    const viewsByDate = {};
    const enquiriesByDate = {};

    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      viewsByDate[dateKey] = 0;
      enquiriesByDate[dateKey] = 0;
    }

    last30DaysViews.forEach(e => {
      const dateKey = new Date(e.timestamp || e.createdAt).toISOString().split('T')[0];
      if (viewsByDate[dateKey] !== undefined) {
        viewsByDate[dateKey]++;
      }
    });

    last30DaysEnquiries.forEach(e => {
      const dateKey = new Date(e.createdAt).toISOString().split('T')[0];
      if (enquiriesByDate[dateKey] !== undefined) {
        enquiriesByDate[dateKey]++;
      }
    });

    // Convert to chart data format
    const dates = Object.keys(viewsByDate).sort();
    const chartData = dates.map(date => ({
      date,
      views: viewsByDate[date],
      enquiries: enquiriesByDate[date],
    }));

    // Calculate conversion rate
    const conversionRate = viewCount > 0 ? ((enquiryCount / viewCount) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      analytics: {
        enquiries: enquiryCount,
        views: viewCount,
        bookings: bookingCount,
        conversionRate: parseFloat(conversionRate),
        chartData: chartData.reverse(), // Most recent first
      },
    });
  } catch (error) {
    logger.error('Error fetching analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/supplier/invoices
 * Get Stripe invoices for supplier's subscription
 */
router.get('/invoices', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access invoices' });
    }

    // Get supplier record to find Stripe customer ID
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    if (!supplier.stripeCustomerId) {
      return res.json({ invoices: [], message: 'No Stripe customer ID found' });
    }

    // Check Stripe is configured
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    // Fetch invoices from Stripe
    const invoices = await stripe.invoices.list({
      customer: supplier.stripeCustomerId,
      limit: 100,
    });

    const formattedInvoices = invoices.data.map(inv => ({
      id: inv.id,
      number: inv.number,
      amount: inv.amount_paid,
      currency: inv.currency,
      status: inv.status,
      date: inv.created,
      dueDate: inv.due_date,
      pdfUrl: inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
      description: inv.lines.data.map(l => l.description).join(', '),
    }));

    res.json({ invoices: formattedInvoices });
  } catch (error) {
    logger.error('Error fetching invoices:', error);
    res.status(500).json({
      error: 'Failed to fetch invoices',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/supplier/invoices/:id/download
 * Get download URL for a specific invoice
 */
router.get('/invoices/:id/download', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access invoices' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier || !supplier.stripeCustomerId) {
      return res.status(404).json({ error: 'Supplier or Stripe customer not found' });
    }

    if (!stripe) {
      return res.status(503).json({ error: 'Stripe not configured' });
    }

    // Fetch invoice
    const invoice = await stripe.invoices.retrieve(id);

    // Verify invoice belongs to this supplier
    if (invoice.customer !== supplier.stripeCustomerId) {
      return res.status(403).json({ error: 'Invoice does not belong to this supplier' });
    }

    res.json({
      pdfUrl: invoice.invoice_pdf,
      hostedUrl: invoice.hosted_invoice_url,
      number: invoice.number,
    });
  } catch (error) {
    logger.error('Error fetching invoice download:', error);
    res.status(500).json({
      error: 'Failed to fetch invoice',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Resolve the signed-in supplier for the enquiry routes, or answer the request.
 *
 * Only a supplier whose profile is approved may read enquiries (the same gate as
 * packages and messaging). The supplier is always looked up from the session's
 * user id; nothing in the URL or body chooses which supplier's records are read.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<Object|null>} The supplier document, or null after a response was sent
 */
async function loadApprovedSupplierForEnquiries(req, res) {
  if (req.user.role !== 'supplier') {
    res.status(403).json({ error: 'Only suppliers can access enquiries' });
    return null;
  }
  const supplier = await dbUnified.findOne(
    'suppliers',
    { ownerUserId: req.user.id },
    { throwOnError: true }
  );
  if (!supplier) {
    res.status(404).json({ error: 'Supplier profile not found' });
    return null;
  }
  if (supplier.approved !== true) {
    res.status(403).json({
      error: 'Supplier not approved',
      code: 'SUPPLIER_NOT_APPROVED',
      message:
        'Your supplier profile is pending admin approval. You will be notified once your account has been reviewed.',
    });
    return null;
  }
  return supplier;
}

/**
 * GET /api/supplier/enquiries/export
 * CSV of this supplier's customer conversations, quote requests and contact-form
 * enquiries (newest first).
 *
 * Always 200 with a header row. When there is nothing to export the body is the
 * header row only and `X-Export-Row-Count` is 0, so a client can say "nothing to
 * export" instead of saving an empty file. Cells that a spreadsheet would run as a
 * formula are neutralised (utils/csv).
 */
router.get('/enquiries/export', authRequired, async (req, res) => {
  try {
    const supplier = await loadApprovedSupplierForEnquiries(req, res);
    if (!supplier) {
      return;
    }

    const rows = await supplierEnquiries.buildExportRows({
      supplierId: supplier.id,
      ownerUserId: req.user.id,
    });
    const csv = serializeCsv(supplierEnquiries.EXPORT_HEADERS, rows);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="enquiries-and-conversations-${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.setHeader('X-Export-Row-Count', String(rows.length));
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting enquiries:', error.message);
    res.status(500).json({ error: 'Failed to export enquiries' });
  }
});

/**
 * GET /api/supplier/enquiries
 * Quote requests and contact-form enquiries addressed to this supplier, newest first.
 *
 * Query: days (1-365, default 90), page, limit (1-100, default 20),
 * status (new|read|handled), source (quote_request|contact_form).
 */
router.get('/enquiries', authRequired, async (req, res) => {
  try {
    const supplier = await loadApprovedSupplierForEnquiries(req, res);
    if (!supplier) {
      return;
    }
    const result = await supplierEnquiries.listEnquiries({
      supplierId: supplier.id,
      query: req.query,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Error listing enquiries:', error.message);
    res.status(500).json({ error: 'Failed to load enquiries' });
  }
});

/**
 * GET /api/supplier/enquiries/:id
 * One enquiry in full (including the contact details the customer submitted).
 * 404 for an id that does not exist or was addressed to a different supplier.
 */
router.get('/enquiries/:id', authRequired, async (req, res) => {
  try {
    const supplier = await loadApprovedSupplierForEnquiries(req, res);
    if (!supplier) {
      return;
    }
    const enquiry = await supplierEnquiries.getEnquiry(supplier.id, req.params.id);
    if (!enquiry) {
      res.status(404).json({ error: 'Enquiry not found' });
      return;
    }
    res.json({ success: true, enquiry });
  } catch (error) {
    logger.error('Error loading enquiry:', error.message);
    res.status(500).json({ error: 'Failed to load enquiry' });
  }
});

/**
 * PATCH /api/supplier/enquiries/:id
 * Mark an enquiry new, read or handled. Body: { status }. The state belongs to this
 * supplier only; it is not shown to the customer or to other suppliers.
 */
router.patch('/enquiries/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const supplier = await loadApprovedSupplierForEnquiries(req, res);
    if (!supplier) {
      return;
    }
    const status = req.body?.status;
    if (!supplierEnquiries.STATUSES.includes(status)) {
      res.status(400).json({ error: 'status must be one of: new, read, handled' });
      return;
    }
    const enquiry = await supplierEnquiries.setEnquiryStatus(supplier.id, req.params.id, status);
    if (!enquiry) {
      res.status(404).json({ error: 'Enquiry not found' });
      return;
    }
    // The dashboard summary's unread-requests figure must reflect this at once.
    clearEngagementCache();
    res.json({ success: true, enquiry });
  } catch (error) {
    logger.error('Error updating enquiry:', error.message);
    res.status(500).json({ error: 'Failed to update enquiry' });
  }
});

/**
 * POST /api/supplier/enquiries/:id/reply
 * Reply to a customer's enquiry by email. Body: { message }. The email goes from EventFlow to the
 * address the customer left, with the supplier's verified account address as Reply-To.
 */
const REPLY_STATUS = Object.freeze({
  EMPTY: 400,
  TOO_LONG: 400,
  NO_EMAIL: 422,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  ENQUIRY_LIMIT: 429,
  ENQUIRY_TOO_OLD: 422,
  HOURLY_LIMIT: 429,
  DAILY_LIMIT: 429,
  SEND_FAILED: 502,
});

router.post(
  '/enquiries/:id/reply',
  authRequired,
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const supplier = await loadApprovedSupplierForEnquiries(req, res);
      if (!supplier) {
        return;
      }
      const owner = await dbUnified.findOne('users', { id: req.user.id }, { throwOnError: true });
      const result = await supplierEnquiries.replyToEnquiry({
        supplier,
        owner,
        id: req.params.id,
        message: req.body?.message,
      });
      if (!result.ok) {
        res
          .status(REPLY_STATUS[result.code] || 400)
          .json({ error: result.message, code: result.code });
        return;
      }
      clearEngagementCache();
      res.json({ success: true, enquiry: result.enquiry });
    } catch (error) {
      logger.error('Error replying to enquiry:', error.message);
      res.status(500).json({ error: 'Failed to send the reply' });
    }
  }
);

/**
 * GET /api/supplier/lead-quality
 * Get lead quality breakdown for supplier
 */
router.get('/lead-quality', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is a supplier
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access lead quality data' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // Count threads by quality/status
    const supplierThreads = await dbUnified.find('threads', { supplierId });

    // Lead quality thresholds
    const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
    const HOT_LEAD_MIN_MESSAGES = 5;
    const HOT_LEAD_MAX_DAYS = 2;
    const HIGH_LEAD_MIN_MESSAGES = 3;
    const HIGH_LEAD_MAX_DAYS = 7;
    const GOOD_LEAD_MIN_MESSAGES = 1;
    const GOOD_LEAD_MAX_DAYS = 14;

    // Calculate breakdown based on thread status or engagement
    const breakdown = [
      { type: 'Hot', count: 0, icon: '🔥', color: '#EF4444' },
      { type: 'High', count: 0, icon: '⭐', color: '#F59E0B' },
      { type: 'Good', count: 0, icon: '✓', color: '#10B981' },
      { type: 'Low', count: 0, icon: '◯', color: '#9CA3AF' },
    ];

    // Simple logic: categorize by message count and recency
    supplierThreads.forEach(thread => {
      const messageCount = thread.messageCount || 0;
      const lastMessageAt = thread.lastMessageAt || thread.createdAt;
      const daysSinceLastMessage =
        (Date.now() - new Date(lastMessageAt).getTime()) / MILLISECONDS_PER_DAY;

      if (messageCount >= HOT_LEAD_MIN_MESSAGES && daysSinceLastMessage < HOT_LEAD_MAX_DAYS) {
        breakdown[0].count++; // Hot
      } else if (
        messageCount >= HIGH_LEAD_MIN_MESSAGES &&
        daysSinceLastMessage < HIGH_LEAD_MAX_DAYS
      ) {
        breakdown[1].count++; // High
      } else if (
        messageCount >= GOOD_LEAD_MIN_MESSAGES &&
        daysSinceLastMessage < GOOD_LEAD_MAX_DAYS
      ) {
        breakdown[2].count++; // Good
      } else {
        breakdown[3].count++; // Low
      }
    });

    res.json({
      success: true,
      breakdown,
    });
  } catch (error) {
    logger.error('Error fetching lead quality:', error);
    res.status(500).json({
      error: 'Failed to fetch lead quality',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/supplier/reviews/stats
 * Get review statistics for the supplier dashboard
 */
router.get('/reviews/stats', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is a supplier
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access review stats' });
    }

    // Get supplier record
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: userId });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    // Only approved reviews count, exactly as on the public reviews panel and in the
    // dashboard summary, so the three can never show different numbers.
    const allReviews = (await dbUnified.find('reviews', { supplierId: supplier.id })) || [];
    const supplierReviews = allReviews.filter(isApprovedReview);

    const totalReviews = supplierReviews.length;
    const averageRating = summariseReviews(allReviews).averageRating;

    // Calculate distribution - only count valid integer ratings (1-5)
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    supplierReviews.forEach(r => {
      const rating = Number(r.rating) || 0;
      // Round to nearest integer for distribution bucketing
      const roundedRating = Math.round(rating);
      if (roundedRating >= 1 && roundedRating <= 5) {
        distribution[roundedRating]++;
      }
    });

    res.json({
      success: true,
      stats: {
        totalReviews,
        averageRating,
        distribution,
      },
    });
  } catch (error) {
    logger.error('Error fetching review stats:', error);
    res.status(500).json({
      error: 'Failed to fetch review stats',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

const {
  VERIFICATION_STATES,
  normaliseState,
  canTransition,
} = require('../utils/supplierVerificationStateMachine');

/**
 * GET /api/supplier/verification/status
 * Returns the current verification state for the authenticated supplier.
 */
router.get('/verification/status', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access verification status' });
    }

    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const state = normaliseState(supplier.verificationStatus, supplier.verified);

    res.json({
      verificationStatus: state,
      verified: supplier.verified || false,
      submittedAt: supplier.verificationSubmittedAt || null,
      reviewedAt: supplier.verifiedAt || supplier.rejectedAt || null,
      verificationNotes:
        state === VERIFICATION_STATES.NEEDS_CHANGES || state === VERIFICATION_STATES.REJECTED
          ? supplier.verificationNotes || ''
          : undefined,
      verificationRejectionCount: supplier.verificationRejectionCount || 0,
    });
  } catch (error) {
    logger.error('Error fetching verification status:', error);
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

/**
 * POST /api/supplier/verification/submit
 * Supplier submits their profile for verification review.
 * Required fields: businessName, category, description, phone, address
 */
router.post(
  '/verification/submit',
  authRequired,
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      if (req.user.role !== 'supplier') {
        return res.status(403).json({ error: 'Only suppliers can submit verification' });
      }

      const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      // Block resubmission after 5 rejections
      if ((supplier.verificationRejectionCount || 0) >= 5) {
        return res.status(403).json({
          error:
            'You have reached the maximum number of verification submissions. Please contact support.',
          code: 'VERIFICATION_MAX_REJECTIONS',
        });
      }

      const currentState = normaliseState(supplier.verificationStatus, supplier.verified);
      const check = canTransition(currentState, VERIFICATION_STATES.PENDING_REVIEW, 'supplier');

      if (!check.allowed) {
        return res.status(409).json({ error: check.reason });
      }

      // Server-side validation of required profile fields
      const requiredFields = {
        name: 'Business name',
        category: 'Category',
        email: 'Contact email',
        phone: 'Contact phone',
        location: 'Location / address',
      };

      const missingFields = Object.entries(requiredFields)
        .filter(([field]) => {
          const val = req.body[field] !== undefined ? req.body[field] : supplier[field];
          return val === undefined || val === null || String(val).trim() === '';
        })
        .map(([, label]) => label);

      if (missingFields.length > 0) {
        return res.status(400).json({
          error: 'Required fields are missing',
          missingFields,
        });
      }

      // A category supplied here must be one the site knows; it is shown on public pages.
      if (req.body.category !== undefined && !VALID_CATEGORIES.includes(req.body.category)) {
        return res.status(400).json({
          error: 'Invalid category',
          validCategories: VALID_CATEGORIES,
        });
      }

      // Validate email format
      // Prefer an updated email from the request body; fall back to the stored value.
      // Using `|| ''` guards against null/undefined on both sides before the regex test.
      // This is a practical format check; full RFC 5322 compliance is intentionally out of scope.
      const rawBodyEmail = req.body.email?.trim() || '';
      const emailValue = rawBodyEmail || String(supplier.email || '').trim();
      if (!EMAIL_REGEX.test(emailValue)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      const now = new Date().toISOString();
      const updates = {
        verificationStatus: VERIFICATION_STATES.PENDING_REVIEW,
        verificationSubmittedAt: now,
        updatedAt: now,
      };

      // Apply any profile updates supplied in the body (with basic sanitization)
      const FIELD_MAX_LENGTHS = {
        name: 120,
        category: 80,
        email: 254,
        phone: 30,
        location: 200,
        description_short: 300,
        description_long: 5000,
      };
      const profileFields = Object.keys(FIELD_MAX_LENGTHS);
      for (const field of profileFields) {
        if (req.body[field] !== undefined) {
          const raw = String(req.body[field]).trim();
          updates[field] = raw.substring(0, FIELD_MAX_LENGTHS[field]);
        }
      }

      await dbUnified.updateOne('suppliers', { id: supplier.id }, { $set: updates });

      // Check if admin has enabled auto-approve for supplier verification
      const settings = (await dbUnified.read('settings')) || {};
      if ((settings.features || {}).autoApproveSupplierVerification === true) {
        // Use 'admin' actor: the state machine enforces permission levels, not attribution.
        // The verifiedBy field below records 'system' to show this was automated.
        const approveCheck = canTransition(
          VERIFICATION_STATES.PENDING_REVIEW,
          VERIFICATION_STATES.APPROVED,
          'admin'
        );
        if (approveCheck.allowed) {
          const approvedAt = new Date().toISOString();
          await dbUnified.updateOne(
            'suppliers',
            { id: supplier.id },
            {
              $set: {
                verificationStatus: VERIFICATION_STATES.APPROVED,
                verified: true,
                approved: true,
                verifiedAt: approvedAt,
                verifiedBy: 'system',
                updatedAt: approvedAt,
              },
            }
          );
          return res.json({
            message: 'Verification submitted and automatically approved.',
            verificationStatus: VERIFICATION_STATES.APPROVED,
            submittedAt: now,
            autoApproved: true,
          });
        }
      }

      res.json({
        message: 'Verification submitted successfully. An admin will review your profile shortly.',
        verificationStatus: VERIFICATION_STATES.PENDING_REVIEW,
        submittedAt: now,
      });
    } catch (error) {
      logger.error('Error submitting verification:', error);
      res.status(500).json({ error: 'Failed to submit verification' });
    }
  }
);

/**
 * GET /api/supplier/dashboard-summary
 * Aggregated dashboard data in a single call.
 *
 * Query: `days` - whole number of days (default 30, capped at 90 and at the plan's
 * analytics entitlement; the window actually served is reported in `window`).
 * The payload is assembled by services/supplierDashboardSummary.js; its contract
 * is documented in docs/SUPPLIER_DASHBOARD_DATA.md.
 */
router.get('/dashboard-summary', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access the dashboard summary' });
    }

    // A failed lookup must be a 500, not a misleading "no profile" 404.
    const supplier = await dbUnified.findOne(
      'suppliers',
      { ownerUserId: userId },
      { throwOnError: true }
    );

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    // A malformed `days` falls back to the default rather than failing the whole dashboard.
    const summary = await buildDashboardSummary({
      userId,
      supplier,
      requestedDays: parseDaysParam(req.query.days).value,
    });

    res.json(summary);
  } catch (error) {
    logger.error('Error fetching dashboard summary:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard summary',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/v1/supplier/availability
 * Returns the supplier's availability settings (open dates, block dates).
 */
router.get('/availability', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Suppliers only' });
    }
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }
    res.json({
      supplierId: supplier.id,
      availability: supplier.availability || { status: 'available', blockedDates: [], notes: '' },
    });
  } catch (error) {
    logger.error('GET /supplier/availability error:', error.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

/**
 * PATCH /api/v1/supplier/availability
 * Updates the supplier's availability status and/or blocked dates.
 */
router.patch('/availability', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Suppliers only' });
    }
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const { status, blockedDates, notes } = req.body;
    const allowed = ['available', 'limited', 'unavailable'];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid availability status' });
    }

    const current = supplier.availability || {};
    const updated = {
      status: status || current.status || 'available',
      blockedDates: Array.isArray(blockedDates)
        ? blockedDates.slice(0, 365)
        : current.blockedDates || [],
      notes: typeof notes === 'string' ? notes.slice(0, 500) : current.notes || '',
      updatedAt: new Date().toISOString(),
    };

    await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      { $set: { availability: updated } }
    );
    res.json({ ok: true, availability: updated });
  } catch (error) {
    logger.error('PATCH /supplier/availability error:', error.message);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

/**
 * POST /api/v1/supplier/request-review
 * Sends a review-request email to a past customer enquiry.
 * Rate-limited: one request per customer per supplierId.
 */
router.post('/request-review', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Suppliers only' });
    }
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const { customerEmail, customerName, threadId } = req.body;
    if (!customerEmail || typeof customerEmail !== 'string') {
      return res.status(400).json({ error: 'customerEmail is required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Idempotency: don't send twice for same supplier+customer combo
    const existing = await dbUnified.findOne('reviewRequests', {
      supplierId: supplier.id,
      customerEmail: customerEmail.trim().toLowerCase(),
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: 'A review request has already been sent to this customer' });
    }

    const requestDoc = {
      id: `rreq_${Date.now()}`,
      supplierId: supplier.id,
      supplierName: supplier.name || 'Your supplier',
      customerEmail: customerEmail.trim().toLowerCase(),
      customerName: typeof customerName === 'string' ? customerName.slice(0, 100) : '',
      threadId: threadId || null,
      sentAt: new Date().toISOString(),
      status: 'sent',
    };

    await dbUnified.insertOne('reviewRequests', requestDoc);

    // TODO: integrate postmark to send actual email — placeholder log for now
    logger.info(
      `Review request sent: supplier=${supplier.id} → customer=${requestDoc.customerEmail}`
    );

    res.json({ ok: true, message: 'Review request sent successfully' });
  } catch (error) {
    logger.error('POST /supplier/request-review error:', error.message);
    res.status(500).json({ error: 'Failed to send review request' });
  }
});

/**
 * GET /api/v1/supplier/performance-tips
 * Returns personalised actionable tips based on the supplier's profile state.
 */
router.get('/performance-tips', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Suppliers only' });
    }
    const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;
    const [packages, reviews] = await Promise.all([
      dbUnified.find('packages', { supplierId }),
      dbUnified.find('reviews', { supplierId }),
    ]);

    const tips = [];

    // Profile completeness tips
    if (!(supplier.description_short || '').trim()) {
      tips.push({
        id: 'add-desc',
        priority: 1,
        category: 'profile',
        icon: '✍️',
        title: 'Add a business description',
        body: 'Tell customers what you offer and where you work, so they can decide whether to get in touch.',
        action: { label: 'Edit Profile', href: '#toggle-profile-form' },
      });
    }
    if (getSupplierGalleryCount(supplier) < 3) {
      tips.push({
        id: 'add-photos',
        priority: 2,
        category: 'profile',
        icon: '📸',
        title: 'Upload at least 3 photos',
        body: 'Customers like to see your work before they get in touch. Add photos from events you have delivered.',
        action: { label: 'Add Photos', href: '#my-suppliers' },
      });
    }
    if (packages.length === 0) {
      tips.push({
        id: 'add-package',
        priority: 3,
        category: 'packages',
        icon: '📦',
        title: 'Create your first package',
        body: 'Packages show customers what you offer and roughly what it costs.',
        action: { label: 'Create Package', href: '#toggle-package-form' },
      });
    }
    if (reviews.length === 0) {
      tips.push({
        id: 'get-review',
        priority: 4,
        category: 'reviews',
        icon: '⭐',
        title: 'Get your first review',
        body: 'Ask a past customer for a review to build trust.',
        action: { label: 'Request Review', data: 'request-review' },
      });
    }
    if (!(supplier.tagline || '').trim()) {
      tips.push({
        id: 'add-tagline',
        priority: 5,
        category: 'profile',
        icon: '💬',
        title: 'Add a tagline',
        body: 'A short tagline tells customers what you do at a glance.',
        action: { label: 'Edit Profile', href: '#toggle-profile-form' },
      });
    }
    if (getSupplierSocialLinkCount(supplier) === 0) {
      tips.push({
        id: 'social-links',
        priority: 6,
        category: 'profile',
        icon: '🔗',
        title: 'Add social media links',
        body: 'Linking your social profiles lets customers see more of your work.',
        action: { label: 'Edit Profile', href: '#toggle-profile-form' },
      });
    }

    // Sort by priority, return top 4
    tips.sort((a, b) => a.priority - b.priority);
    res.json({ tips: tips.slice(0, 4), total: tips.length });
  } catch (error) {
    logger.error('GET /supplier/performance-tips error:', error.message);
    res.status(500).json({ error: 'Failed to load performance tips' });
  }
});

module.exports = router;
