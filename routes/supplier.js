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

const router = express.Router();

// Initialize Stripe at module level to avoid creating a new instance per request
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? require('stripe')(stripeSecretKey) : null;

// Constants
const TRIAL_DURATION_DAYS = 14;
const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;
const MAX_ANALYTICS_WINDOW_DAYS = 90;

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
    const suppliers = await dbUnified.read('suppliers');
    const supplierIndex = suppliers.findIndex(s => s.ownerUserId === userId);

    if (supplierIndex === -1) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplier = suppliers[supplierIndex];

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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // Get analytics window from query parameter, default to 7 days, max 365 days
    const days = Math.min(parseInt(req.query.days) || 7, 365);

    // Use supplierAnalytics utility for real tracked data
    const supplierAnalytics = require('../utils/supplierAnalytics');
    const analytics = await supplierAnalytics.getSupplierAnalytics(supplierId, days);

    res.json({
      success: true,
      analytics,
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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // Get analytics window from query parameter, default to 30 days, max 90 days
    const days = Math.min(
      parseInt(req.query.days) || DEFAULT_ANALYTICS_WINDOW_DAYS,
      MAX_ANALYTICS_WINDOW_DAYS
    );

    // Count enquiries from message threads
    const threads = await dbUnified.read('threads');
    const enquiries = threads.filter(t => t.supplierId === supplierId);
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
      const bookings = await dbUnified.read('bookings');
      bookingCount = bookings.filter(b => b.supplierId === supplierId).length;
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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

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
 * GET /api/supplier/enquiries/export
 * Export enquiries to CSV for supplier
 */
router.get('/enquiries/export', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can export enquiries' });
    }

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    // Get quote requests for this supplier
    const quoteRequests = await dbUnified.read('quoteRequests');
    const supplierEnquiries = quoteRequests.filter(q => q.supplierId === supplier.id);

    // Get user details for enquiries
    const users = await dbUnified.read('users');
    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = u;
    });

    // Build CSV
    const headers = [
      'Date',
      'Customer Name',
      'Customer Email',
      'Event Type',
      'Event Date',
      'Location',
      'Budget',
      'Guest Count',
      'Status',
      'Message',
    ].join(',');

    const rows = supplierEnquiries.map(enq => {
      const user = userMap[enq.customerId] || {};
      const date = new Date(enq.createdAt).toLocaleDateString('en-GB');
      const eventDate = enq.eventDate ? new Date(enq.eventDate).toLocaleDateString('en-GB') : 'N/A';

      return [
        date,
        `"${user.name || 'N/A'}"`,
        `"${user.email || 'N/A'}"`,
        `"${enq.eventType || 'N/A'}"`,
        eventDate,
        `"${enq.location || 'N/A'}"`,
        `"${enq.budget || 'N/A'}"`,
        enq.guestCount || 'N/A',
        `"${enq.status || 'pending'}"`,
        `"${(enq.message || '').replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csv = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="enquiries-${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting enquiries:', error);
    res.status(500).json({
      error: 'Failed to export enquiries',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;

    // Count threads by quality/status
    const threads = await dbUnified.read('threads');
    const supplierThreads = threads.filter(t => t.supplierId === supplierId);

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
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    // Get reviews using dbUnified
    const reviews = (await dbUnified.read('reviews')) || [];
    const supplierReviews = reviews.filter(r => r.supplierId === supplier.id);

    const totalReviews = supplierReviews.length;
    const averageRating =
      totalReviews > 0
        ? Math.round(
            (supplierReviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / totalReviews) *
              100
          ) / 100
        : 0;

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

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

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

      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.ownerUserId === req.user.id);

      if (supplierIndex === -1) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const supplier = suppliers[supplierIndex];
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
 * Aggregated dashboard data in a single call
 */
router.get('/dashboard-summary', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'supplier') {
      return res.status(403).json({ error: 'Only suppliers can access the dashboard summary' });
    }

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.ownerUserId === userId);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier profile not found' });
    }

    const supplierId = supplier.id;
    const days = Math.min(
      parseInt(req.query.days) || DEFAULT_ANALYTICS_WINDOW_DAYS,
      MAX_ANALYTICS_WINDOW_DAYS
    );

    const now = new Date();
    const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const prevPeriodStart = new Date(periodStart.getTime() - days * 24 * 60 * 60 * 1000);

    // --- Analytics ---
    let analyticsData = {
      totalViews: 0,
      totalEnquiries: 0,
      responseRate: 100,
      avgResponseTime: 0,
      dailyData: [],
      viewsTrend: 0,
      enquiriesTrend: 0,
      responseTrend: 0,
    };
    try {
      const supplierAnalytics = require('../utils/supplierAnalytics');
      const { EVENT_TYPES } = supplierAnalytics;

      // Fetch current-period analytics and raw events in parallel
      const [current, allEvents] = await Promise.all([
        supplierAnalytics.getSupplierAnalytics(supplierId, days),
        dbUnified
          .read('events')
          .then(evts => (evts || []).filter(e => e.supplierId === supplierId)),
      ]);

      const periodStartStr = periodStart.toISOString();
      const prevPeriodStartStr = prevPeriodStart.toISOString();

      const prevEvents = allEvents.filter(
        e => e.timestamp >= prevPeriodStartStr && e.timestamp < periodStartStr
      );
      const prevViews = prevEvents.filter(e => e.type === EVENT_TYPES.PROFILE_VIEW).length;
      const prevEnquiries = prevEvents.filter(e => e.type === EVENT_TYPES.ENQUIRY_SENT).length;

      analyticsData = {
        totalViews: current.totalViews,
        totalEnquiries: current.totalEnquiries,
        responseRate: current.responseRate,
        avgResponseTime: current.avgResponseTime,
        dailyData: current.dailyData,
        // Return null when previous period has no data, to avoid misleading percentages
        viewsTrend:
          prevViews > 0 ? Math.round(((current.totalViews - prevViews) / prevViews) * 100) : null,
        enquiriesTrend:
          prevEnquiries > 0
            ? Math.round(((current.totalEnquiries - prevEnquiries) / prevEnquiries) * 100)
            : null,
        // Response rate is computed across all threads (not time-windowed), so trend is not available
        responseTrend: 0,
      };
    } catch (err) {
      logger.error('dashboard-summary: analytics sub-query failed:', err);
    }

    // --- Profile ---
    let profileData = {
      hasProfile: false,
      profileCount: 0,
      topProfileId: null,
      topProfileName: null,
      healthScore: 0,
      isApproved: false,
      completionFlags: {
        hasPhotos: false,
        hasBanner: false,
        hasTagline: false,
        hasHighlights: false,
        hasSocialLinks: false,
        hasDescription: false,
        hasLocation: false,
        hasPrice: false,
      },
    };
    try {
      // supplier is already found above; get all profiles for this user from the same array
      const supplierProfiles = suppliers.filter(s => s.ownerUserId === userId);
      const profileCount = supplierProfiles.length;
      const topProfile = supplier; // supplier is the first match (already found via find)

      const hasDescription = !!(topProfile.description_short || '').trim();
      const hasLocation = !!(topProfile.location || '').trim();
      const hasPhotos =
        Array.isArray(topProfile.photosGallery) && topProfile.photosGallery.length >= 3;
      const hasBanner = !!(topProfile.bannerUrl || '').trim();
      const hasTagline = !!(topProfile.tagline || '').trim();
      const hasHighlights =
        Array.isArray(topProfile.highlights) && topProfile.highlights.length >= 2;
      const hasSocialLinks =
        topProfile.socialLinks &&
        typeof topProfile.socialLinks === 'object' &&
        Object.values(topProfile.socialLinks).some(v => v && String(v).trim());
      const hasPrice = !!(topProfile.startingPrice || topProfile.price_range || topProfile.price);

      let healthScore = 0;
      if (hasDescription) {
        healthScore += 20;
      }
      if (hasLocation) {
        healthScore += 15;
      }
      if (hasPhotos) {
        healthScore += 20;
      }
      if (hasBanner) {
        healthScore += 10;
      }
      if (hasTagline) {
        healthScore += 10;
      }
      if (hasHighlights) {
        healthScore += 10;
      }
      if (hasSocialLinks) {
        healthScore += 10;
      }
      if (hasPrice) {
        healthScore += 5;
      }

      profileData = {
        hasProfile: profileCount > 0,
        profileCount,
        topProfileId: topProfile.id || null,
        topProfileName: topProfile.name || null,
        healthScore,
        isApproved: !!(topProfile.approved || topProfile.verified),
        completionFlags: {
          hasPhotos,
          hasBanner,
          hasTagline,
          hasHighlights,
          hasSocialLinks,
          hasDescription,
          hasLocation,
          hasPrice,
        },
      };
    } catch (err) {
      logger.error('dashboard-summary: profile sub-query failed:', err);
    }

    // --- Packages ---
    let packagesData = { total: 0, active: 0, draft: 0 };
    try {
      const allPackages = (await dbUnified.read('packages')) || [];
      const supplierPackages = allPackages.filter(p => p.supplierId === supplierId);
      // Count active and draft in a single pass to avoid iterating twice
      const counts = supplierPackages.reduce(
        (acc, p) => {
          if (p.approved === false) {
            acc.draft++;
          } else {
            acc.active++;
          }
          return acc;
        },
        { active: 0, draft: 0 }
      );
      packagesData = {
        total: supplierPackages.length,
        active: counts.active,
        draft: counts.draft,
      };
    } catch (err) {
      logger.error('dashboard-summary: packages sub-query failed:', err);
    }

    // --- Messages ---
    let messagesData = { total: 0, unread: 0, latestAt: null };
    try {
      const conversations = (await dbUnified.read('conversationsV4')) || [];
      const supplierConversations = conversations.filter(c => {
        if (Array.isArray(c.participants)) {
          return c.participants.some(p => p.userId === userId);
        }
        return c.supplierId === supplierId || c.userId === userId;
      });

      const total = supplierConversations.length;
      let unread = 0;
      let latestAt = null;

      supplierConversations.forEach(c => {
        if (Array.isArray(c.participants)) {
          const me = c.participants.find(p => p.userId === userId);
          if (me && (me.unreadCount || 0) > 0) {
            unread++;
          }
        }
        const ts = c.lastMessageAt || c.updatedAt || c.createdAt;
        if (ts && (!latestAt || new Date(ts) > new Date(latestAt))) {
          latestAt = ts;
        }
      });

      messagesData = { total, unread, latestAt };
    } catch (err) {
      logger.error('dashboard-summary: messages sub-query failed:', err);
    }

    // --- Reviews ---
    let reviewsData = { total: 0, averageRating: 0, pending: 0 };
    try {
      const allReviews = (await dbUnified.read('reviews')) || [];
      const supplierReviews = allReviews.filter(r => r.supplierId === supplierId);
      const total = supplierReviews.length;
      const averageRating =
        total > 0
          ? parseFloat(
              (
                supplierReviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / total
              ).toFixed(2)
            )
          : 0;
      const pending = supplierReviews.filter(
        r => r.status === 'pending' || r.moderation?.state === 'pending'
      ).length;

      reviewsData = { total, averageRating, pending };
    } catch (err) {
      logger.error('dashboard-summary: reviews sub-query failed:', err);
    }

    // --- Tickets ---
    let ticketsData = { total: 0, open: 0, inProgress: 0 };
    try {
      const allTickets = (await dbUnified.read('tickets')) || [];
      const supplierTickets = allTickets.filter(
        t => t.senderId === userId && t.senderType === 'supplier'
      );
      ticketsData = {
        total: supplierTickets.length,
        open: supplierTickets.filter(t => t.status === 'open').length,
        inProgress: supplierTickets.filter(t => t.status === 'in_progress').length,
      };
    } catch (err) {
      logger.error('dashboard-summary: tickets sub-query failed:', err);
    }

    // --- Subscription ---
    let subscriptionData = {
      tier: 'free',
      status: 'active',
      renewsAt: null,
      trialEndsAt: null,
    };
    try {
      subscriptionData = {
        tier: supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free'),
        status: supplier.subscriptionStatus || supplier.subscription?.status || 'active',
        renewsAt: supplier.subscriptionRenewsAt || supplier.subscription?.renewsAt || null,
        trialEndsAt: supplier.trialEndsAt || null,
      };
    } catch (err) {
      logger.error('dashboard-summary: subscription sub-query failed:', err);
    }

    res.json({
      analytics: analyticsData,
      profile: profileData,
      packages: packagesData,
      messages: messagesData,
      reviews: reviewsData,
      tickets: ticketsData,
      subscription: subscriptionData,
    });
  } catch (error) {
    logger.error('Error fetching dashboard summary:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard summary',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

module.exports = router;
