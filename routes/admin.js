/**
 * Admin Routes
 * Handles admin-only operations: approvals, metrics, moderation, and exports
 */

'use strict';

const path = require('path');
const logger = require('../utils/logger');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { uid } = require('../store');
const { authRequired, roleRequired } = require('../middleware/auth');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { normalizeTicketRecord } = require('../utils/ticketNormalization');
const { PRIORITY_RANK } = require('../utils/tierPriority');
const photoUpload = require('../photo-upload');
const postmark = require('../utils/postmark');
const { FROM_SUPPORT: POSTMARK_FROM_SUPPORT_ADDR } = postmark;

const router = express.Router();

// Constants
const BATCH_PHOTO_LIMIT = 50; // Maximum photos that can be processed in a single batch operation

/**
 * Check if collage debug logging is enabled
 * @returns {boolean} True if debug logging should be enabled
 */
function isCollageDebugEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_COLLAGE === 'true';
}

// Initialize Stripe if available
let stripe = null;
let STRIPE_ENABLED = false;

try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    // Try to load Stripe module - it might not be installed
    try {
      const stripeLib = require('stripe');
      stripe = stripeLib(stripeSecretKey);
      STRIPE_ENABLED = true;
      logger.info('Stripe initialized successfully for admin routes');
    } catch (requireErr) {
      logger.warn('Stripe package not available:', requireErr.message);
    }
  } else {
    logger.info('Stripe secret key not configured, Stripe features will be disabled');
  }
} catch (err) {
  logger.error('Failed to initialize Stripe in admin routes:', err.message);
}

// This will be set by the main server.js when mounting these routes
let supplierIsProActiveFn = null;
let seedFn = null;

/**
 * Set helper functions (injected from server.js)
 * @param {Function} supplierIsProActive - Check if supplier Pro plan is active
 * @param {Function} seed - Re-seed database function
 */
function setHelperFunctions(supplierIsProActive, seed) {
  supplierIsProActiveFn = supplierIsProActive;
  seedFn = seed;
}

/**
 * GET /api/admin/db-status
 * Get database connection status
 */
router.get('/db-status', authRequired, roleRequired('admin'), (_req, res) => {
  const status = dbUnified.getDatabaseStatus();
  res.json({
    dbType: status.type,
    initialized: status.state === 'completed',
    state: status.state,
    connected: status.connected,
    error: status.error,
  });
});

// Cache for dashboard stats
let dashboardStatsCache = null;
let dashboardStatsCacheTime = 0;
const DASHBOARD_STATS_CACHE_TTL = 60000; // 60 seconds

/**
 * Calculate dashboard statistics using efficient counting
 * @returns {Promise<Object>} Dashboard statistics
 */
async function calculateDashboardStats() {
  // Use Promise.all with count operations instead of full reads
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    verifiedUsers,
    unverifiedUsers,
    suspendedUsers,
    customerCount,
    supplierCount,
    adminCount,
    totalSuppliers,
    pendingSuppliers,
    approvedSuppliers,
    verifiedSuppliers,
    proSuppliers,
    featuredSuppliers,
    totalPackages,
    pendingPackages,
    approvedPackages,
    featuredPackages,
    totalPhotos,
    approvedPhotos,
    rejectedPhotos,
    totalTickets,
    openTickets,
    inProgressTickets,
    closedTickets,
    totalPlans,
    activePlans,
    totalMarketplace,
  ] = await Promise.all([
    dbUnified.count('users'),
    dbUnified.count('users', { verified: true }),
    dbUnified.count('users', { verified: false }),
    dbUnified.count('users', { suspended: true }),
    dbUnified.count('users', { role: 'customer' }),
    dbUnified.count('users', { role: 'supplier' }),
    dbUnified.count('users', { role: 'admin' }),
    dbUnified.count('suppliers'),
    dbUnified.count('suppliers', { approved: false }),
    dbUnified.count('suppliers', { approved: true }),
    dbUnified.count('suppliers', { verified: true }),
    dbUnified.count('suppliers', { isPro: true }),
    dbUnified.count('suppliers', { featured: true }),
    dbUnified.count('packages'),
    dbUnified.count('packages', { approved: false }),
    dbUnified.count('packages', { approved: true }),
    dbUnified.count('packages', { featured: true }),
    dbUnified.count('photos'),
    dbUnified.count('photos', { approved: true }),
    dbUnified.count('photos', { rejected: true }),
    dbUnified.count('tickets'),
    dbUnified.count('tickets', { status: 'open' }),
    dbUnified.count('tickets', { status: 'in_progress' }),
    dbUnified.count('tickets', { status: 'closed' }),
    dbUnified.count('plans'),
    dbUnified.count('plans', { status: 'active' }),
    dbUnified.count('marketplace_listings'),
  ]);

  // For complex filters (date comparisons, multiple conditions), we need to use MongoDB's query language
  // For local storage fallback, we still need to load and filter
  const dbType = dbUnified.getDatabaseType();
  let recentSignups = 0;
  let pendingPhotos = 0;
  let highPriorityTickets = 0;
  let pendingMarketplace = 0;
  let activeMarketplace = 0;
  let recentActivity24h = 0;
  let recentActivity7d = 0;

  if (dbType === 'mongodb') {
    // Use MongoDB date queries for efficiency
    const [
      recentSignupsResult,
      pendingPhotosResult,
      highPriorityResult,
      pendingMarketplaceResult,
      activeMarketplaceResult,
      recent24hResult,
      recent7dResult,
    ] = await Promise.all([
      dbUnified.count('users', { createdAt: { $gte: dayAgo.toISOString() } }),
      dbUnified.count('photos', { approved: false, rejected: false }),
      dbUnified.count('tickets', { priority: 'high', status: { $ne: 'closed' } }),
      dbUnified.count('marketplace_listings', { approved: false, status: 'pending' }),
      dbUnified.count('marketplace_listings', { approved: true, status: 'active' }),
      dbUnified.count('audit_logs', { timestamp: { $gte: dayAgo.toISOString() } }),
      dbUnified.count('audit_logs', { timestamp: { $gte: weekAgo.toISOString() } }),
    ]);

    recentSignups = recentSignupsResult;
    pendingPhotos = pendingPhotosResult;
    highPriorityTickets = highPriorityResult;
    pendingMarketplace = pendingMarketplaceResult;
    activeMarketplace = activeMarketplaceResult;
    recentActivity24h = recent24hResult;
    recentActivity7d = recent7dResult;
  } else {
    // Fallback for local storage - need to load and filter
    const [users, photos, ticketsRaw, marketplaceListings, auditLogs] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('photos'),
      dbUnified.read('tickets'),
      dbUnified.read('marketplace_listings'),
      dbUnified.read('audit_logs'),
    ]);

    const tickets = ticketsRaw.map(ticket => normalizeTicketRecord(ticket, { generateId: uid }));

    recentSignups = users.filter(u => {
      const createdAt = new Date(u.createdAt);
      return createdAt > dayAgo;
    }).length;

    pendingPhotos = photos.filter(p => !p.approved && !p.rejected).length;

    highPriorityTickets = tickets.filter(
      t => t.priority === 'high' && t.status !== 'closed'
    ).length;

    pendingMarketplace = marketplaceListings.filter(
      l => !l.approved && l.status === 'pending'
    ).length;

    activeMarketplace = marketplaceListings.filter(l => l.approved && l.status === 'active').length;

    recentActivity24h = auditLogs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime > dayAgo;
    }).length;

    recentActivity7d = auditLogs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime > weekAgo;
    }).length;
  }

  return {
    users: {
      total: totalUsers,
      verified: verifiedUsers,
      unverified: unverifiedUsers,
      suspended: suspendedUsers,
      customers: customerCount,
      suppliers: supplierCount,
      admins: adminCount,
      recentSignups,
    },
    suppliers: {
      total: totalSuppliers,
      pending: pendingSuppliers,
      approved: approvedSuppliers,
      verified: verifiedSuppliers,
      pro: proSuppliers,
      featured: featuredSuppliers,
    },
    packages: {
      total: totalPackages,
      pending: pendingPackages,
      approved: approvedPackages,
      featured: featuredPackages,
    },
    photos: {
      total: totalPhotos,
      pending: pendingPhotos,
      approved: approvedPhotos,
      rejected: rejectedPhotos,
    },
    tickets: {
      total: totalTickets,
      open: openTickets,
      inProgress: inProgressTickets,
      closed: closedTickets,
      highPriority: highPriorityTickets,
    },
    marketplace: {
      total: totalMarketplace,
      pending: pendingMarketplace,
      active: activeMarketplace,
    },
    plans: {
      total: totalPlans,
      active: activePlans,
    },
    recentActivity: {
      last24Hours: recentActivity24h,
      last7Days: recentActivity7d,
    },
    pendingActions: {
      totalPending: pendingSuppliers + pendingPackages + pendingPhotos + pendingMarketplace,
      breakdown: {
        suppliers: pendingSuppliers,
        packages: pendingPackages,
        photos: pendingPhotos,
        marketplace: pendingMarketplace,
      },
    },
  };
}

/**
 * GET /api/admin/dashboard/stats
 * Get comprehensive dashboard statistics for admin overview
 */
router.get('/dashboard/stats', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const now = Date.now();

    // Return cached stats if still valid
    if (dashboardStatsCache && now - dashboardStatsCacheTime < DASHBOARD_STATS_CACHE_TTL) {
      return res.json(dashboardStatsCache);
    }

    // Calculate fresh stats using Promise.all([dbUnified.read('users'), dbUnified.read('suppliers'), ...])
    // Returns: { users:, suppliers:, packages:, photos:, tickets:, marketplace:, pendingActions: }
    const stats = await calculateDashboardStats();

    // Update cache
    dashboardStatsCache = stats;
    dashboardStatsCacheTime = now;

    res.json(stats);
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

/**
 * GET /api/admin/dashboard/recent-activity
 * Get recent admin activity for timeline view
 */
router.get('/dashboard/recent-activity', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const auditLogs = await dbUnified.read('audit_logs');

    // Sort by timestamp descending (newest first) and limit
    const recentLogs = auditLogs
      .sort((a, b) => {
        const aTime = new Date(a.timestamp).getTime();
        const bTime = new Date(b.timestamp).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);

    // Enrich with human-readable descriptions
    const enrichedLogs = recentLogs.map(log => ({
      ...log,
      description: formatActionDescription(log),
      timeAgo: getTimeAgo(log.timestamp),
    }));

    res.json({ activities: enrichedLogs });
  } catch (error) {
    logger.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// Helper function to parse duration strings into milliseconds
// Supports: '1d', '2h', '30m', '7days', '24hours', '60minutes'
function parseDuration(str) {
  if (!str) {
    return 0;
  }
  const days = str.match(/(\d+)\s*d(ay)?s?/i);
  const hours = str.match(/(\d+)\s*h(our)?s?/i);
  const minutes = str.match(/(\d+)\s*m(in(ute)?)?s?/i);
  return (
    (days ? Number(days[1]) * 86400000 : 0) +
    (hours ? Number(hours[1]) * 3600000 : 0) +
    (minutes ? Number(minutes[1]) * 60000 : 0)
  );
}

// Helper function to format action descriptions
function formatActionDescription(log) {
  const action = log.action || '';
  const targetType = log.targetType || '';

  const actionMap = {
    user_suspended: `Suspended user`,
    user_unsuspended: `Unsuspended user`,
    user_verified: `Verified user`,
    user_banned: `Banned user`,
    supplier_approved: `Approved supplier`,
    supplier_rejected: `Rejected supplier`,
    package_approved: `Approved package`,
    package_rejected: `Rejected package`,
    photo_approved: `Approved photo`,
    photo_rejected: `Rejected photo`,
    marketplace_listing_approved: `Approved marketplace listing`,
    marketplace_listing_rejected: `Rejected marketplace listing`,
    BULK_PACKAGES_APPROVED: `Bulk approved packages`,
    BULK_PACKAGES_FEATURED: `Bulk featured packages`,
    BULK_USERS_VERIFIED: `Bulk verified users`,
    BULK_USERS_SUSPENDED: `Bulk suspended users`,
  };

  return actionMap[action] || `Performed ${action} on ${targetType}`;
}

// Helper function to get human-readable time ago
function getTimeAgo(timestamp) {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  const diff = now - time;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (days < 30) {
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

/**
 * GET /api/admin/export/all
 * Export all core collections as JSON
 */
router.get('/export/all', authRequired, roleRequired('admin'), async (_req, res) => {
  const payload = {
    exportedAt: new Date().toISOString(),
    users: await dbUnified.read('users'),
    suppliers: await dbUnified.read('suppliers'),
    packages: await dbUnified.read('packages'),
    plans: await dbUnified.read('plans'),
    notes: await dbUnified.read('notes'),
    events: await dbUnified.read('events'),
    threads: await dbUnified.read('threads'),
    messages: await dbUnified.read('messages'),
  };
  const json = JSON.stringify(payload, null, 2);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="eventflow-export.json"');
  res.send(json);
});

/**
 * GET /api/admin/metrics/timeseries
 * Get synthetic timeseries data for admin charts
 */
router.get('/metrics/timeseries', authRequired, roleRequired('admin'), (_req, res) => {
  const today = new Date();
  const days = 14;
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    series.push({
      date: iso,
      visitors: 20 + ((i * 7) % 15),
      signups: 3 + (i % 4),
      plans: 1 + (i % 3),
    });
  }
  res.json({ series });
});

/**
 * GET /api/admin/metrics
 * Get admin dashboard metrics
 */
router.get('/metrics', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const [users, suppliers, plans, msgs, pkgs, threads] = await Promise.all([
      dbUnified.read('users').then(d => d || []),
      dbUnified.read('suppliers').then(d => d || []),
      dbUnified.read('plans').then(d => d || []),
      dbUnified.read('messages').then(d => d || []),
      dbUnified.read('packages').then(d => d || []),
      dbUnified.read('threads').then(d => d || []),
    ]);
    res.json({
      counts: {
        usersTotal: users.length,
        usersByRole: users.reduce((a, u) => {
          a[u.role] = (a[u.role] || 0) + 1;
          return a;
        }, {}),
        suppliersTotal: suppliers.length,
        packagesTotal: pkgs.length,
        plansTotal: plans.length,
        messagesTotal: msgs.length,
        threadsTotal: threads.length,
      },
    });
  } catch (error) {
    logger.error('Error fetching metrics:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      counts: {
        usersTotal: 0,
        usersByRole: {},
        suppliersTotal: 0,
        packagesTotal: 0,
        plansTotal: 0,
        messagesTotal: 0,
        threadsTotal: 0,
      },
    });
  }
});

/**
 * POST /api/admin/reset-demo
 * Reset demo data by clearing all collections and re-seeding
 */
router.post(
  '/reset-demo',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      // Clear key collections and rerun seeding
      const collections = [
        'users',
        'suppliers',
        'packages',
        'plans',
        'notes',
        'messages',
        'threads',
        'events',
      ];
      await Promise.all(collections.map(name => dbUnified.write(name, [])));
      if (seedFn) {
        seedFn();
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('Reset demo failed', err);
      res.status(500).json({ error: 'Reset demo failed' });
    }
  }
);

/**
 * GET /api/admin/suppliers
 * List all suppliers for admin moderation
 */
router.get('/suppliers', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const raw = await dbUnified.read('suppliers');
    const items = await Promise.all(
      raw.map(async s => ({
        ...s,
        isPro: supplierIsProActiveFn ? await supplierIsProActiveFn(s) : s.isPro,
        proExpiresAt: s.proExpiresAt || null,
      }))
    );
    res.json({ items });
  } catch (error) {
    logger.error('Error reading suppliers:', error);
    res.status(500).json({ error: 'Failed to load suppliers' });
  }
});

/**
 * GET /api/admin/suppliers/pending-verification
 * Get suppliers awaiting verification.
 * Must be declared BEFORE /suppliers/:id to prevent Express wildcard capture.
 */
router.get(
  '/suppliers/pending-verification',
  authRequired,
  roleRequired('admin'),
  async (_req, res) => {
    try {
      const suppliers = (await dbUnified.read('suppliers')) || [];
      const pending = suppliers.filter(
        s =>
          !s.verified &&
          (!s.verificationStatus ||
            s.verificationStatus === 'pending' ||
            s.verificationStatus === 'unverified' ||
            s.verificationStatus === 'pending_review')
      );

      res.json({
        suppliers: pending.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          location: s.location,
          ownerUserId: s.ownerUserId,
          createdAt: s.createdAt,
          verificationStatus: s.verificationStatus || 'unverified',
          submittedAt: s.verificationSubmittedAt || null,
        })),
        count: pending.length,
      });
    } catch (error) {
      logger.error('Error fetching pending verification suppliers:', error);
      res.status(500).json({ suppliers: [], count: 0, error: 'Failed to fetch pending suppliers' });
    }
  }
);

/**
 * GET /api/admin/suppliers/:id
 * Get details of a specific supplier
 */
router.get('/suppliers/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const raw = await dbUnified.read('suppliers');
    const supplier = raw.find(s => s.id === req.params.id);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Add computed fields
    const enrichedSupplier = {
      ...supplier,
      isPro: supplierIsProActiveFn ? await supplierIsProActiveFn(supplier) : supplier.isPro,
      proExpiresAt: supplier.proExpiresAt || null,
    };

    res.json({ supplier: enrichedSupplier });
  } catch (error) {
    logger.error('Error reading supplier:', error);
    res.status(500).json({ error: 'Failed to load supplier' });
  }
});

/**
 * DELETE /api/admin/suppliers/:id
 * Delete a supplier
 */
// prettier-ignore
router.delete('/suppliers/:id', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const idx = all.findIndex(s => s.id === req.params.id);
      if (idx < 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      await dbUnified.deleteOne('suppliers', req.params.id);
      await auditLog({
        action: AUDIT_ACTIONS.SUPPLIER_DELETED || 'supplier_deleted',
        userId: req.user.id,
        targetId: req.params.id,
      });
      res.json({ success: true });
    } catch (error) {
      logger.error('Error deleting supplier:', error);
      res.status(500).json({ error: 'Failed to delete supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/approve
 * Approve or reject a supplier
 */
// prettier-ignore
router.post('/suppliers/:id/approve', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const i = all.findIndex(s => s.id === req.params.id);
      if (i < 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      const approved = !!(req.body && req.body.approved);
      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: { approved } });
      res.json({ ok: true, supplier: { ...all[i], approved } });
    } catch (error) {
      logger.error('Error approving supplier:', error);
      res.status(500).json({ error: 'Failed to approve supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/reject
 * Reject a supplier (sets approved=false and records reason)
 */
router.post(
  '/suppliers/:id/reject',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const all = await dbUnified.read('suppliers');
      const i = all.findIndex(s => s.id === req.params.id);
      if (i < 0) {
        return res.status(404).json({ error: 'Not found' });
      }
      const { reason } = req.body || {};
      const now = new Date().toISOString();
      const rejectedFields = {
        approved: false,
        rejected: true,
        rejectedAt: now,
        rejectedReason: reason || '',
      };
      await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: rejectedFields });
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'supplier_rejected',
        targetType: 'supplier',
        targetId: req.params.id,
        details: { reason: reason || '' },
        ipAddress: req.ip,
      });
      res.json({ ok: true, supplier: { ...all[i], ...rejectedFields } });
    } catch (error) {
      logger.error('Error rejecting supplier:', error);
      res.status(500).json({ error: 'Failed to reject supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/pro
 * Manage supplier Pro subscription
 */
router.post(
  '/suppliers/:id/pro',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { mode, duration } = req.body || {};
      const all = await dbUnified.read('suppliers');
      const i = all.findIndex(s => s.id === req.params.id);
      if (i < 0) {
        return res.status(404).json({ error: 'Not found' });
      }

      const s = all[i];
      const now = Date.now();

      if (mode === 'cancel') {
        s.isPro = false;
        s.proExpiresAt = null;
      } else if (mode === 'duration') {
        let ms = 0;
        switch (duration) {
          case '1d':
            ms = 1 * 24 * 60 * 60 * 1000;
            break;
          case '7d':
            ms = 7 * 24 * 60 * 60 * 1000;
            break;
          case '1m':
            ms = 30 * 24 * 60 * 60 * 1000;
            break;
          case '1y':
            ms = 365 * 24 * 60 * 60 * 1000;
            break;
          default:
            return res.status(400).json({ error: 'Invalid duration' });
        }
        s.isPro = true;
        s.proExpiresAt = new Date(now + ms).toISOString();
      } else {
        return res.status(400).json({ error: 'Invalid mode' });
      }

      // Optionally mirror Pro flag to the owning user, if present.
      try {
        if (s.ownerUserId) {
          await dbUnified.updateOne('users', { id: s.ownerUserId }, { $set: { isPro: !!s.isPro } });
        }
      } catch (_e) {
        // ignore errors from user store
      }

      all[i] = s;
      await dbUnified.updateOne(
        'suppliers',
        { id: req.params.id },
        { $set: { isPro: s.isPro, proExpiresAt: s.proExpiresAt } }
      );

      const active = supplierIsProActiveFn ? await supplierIsProActiveFn(s) : s.isPro;
      res.json({
        ok: true,
        supplier: {
          ...s,
          isPro: active,
          proExpiresAt: s.proExpiresAt || null,
        },
      });
    } catch (error) {
      logger.error('Error updating supplier Pro status:', error);
      res.status(500).json({ error: 'Failed to update supplier Pro status' });
    }
  }
);

/**
 * POST /api/admin/suppliers/import-demo
 * Import demo suppliers from data/suppliers.json into the database
 * Idempotent: uses supplier ID as unique key (upsert behavior)
 */
router.post(
  '/suppliers/import-demo',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      // Read demo suppliers from JSON file
      const demoSuppliersPath = path.join(__dirname, '../data/suppliers.json');

      if (!fs.existsSync(demoSuppliersPath)) {
        return res.status(500).json({
          error: 'Demo suppliers file not found at data/suppliers.json',
        });
      }

      let demoSuppliers;
      try {
        const fileContent = fs.readFileSync(demoSuppliersPath, 'utf8');
        demoSuppliers = JSON.parse(fileContent);
      } catch (parseError) {
        logger.error('Error parsing suppliers.json:', parseError);
        return res.status(500).json({
          error: `Failed to parse demo suppliers file: ${parseError.message}`,
        });
      }

      if (!Array.isArray(demoSuppliers)) {
        return res.status(500).json({
          error: 'Invalid demo suppliers format: expected an array',
        });
      }

      // Get current suppliers from database
      const existingSuppliers = await dbUnified.read('suppliers');

      // Create a map of existing suppliers by ID for quick lookup with their indices
      const existingById = new Map();
      existingSuppliers.forEach((supplier, index) => {
        existingById.set(supplier.id, index);
      });

      let insertedCount = 0;
      let updatedCount = 0;
      const now = new Date().toISOString();

      // Process each demo supplier (idempotent upsert)
      const upsertOps = [];
      for (const demoSupplier of demoSuppliers) {
        if (!demoSupplier.id) {
          logger.warn('Skipping supplier without ID:', demoSupplier);
          continue;
        }

        const existingIndex = existingById.get(demoSupplier.id);
        if (existingIndex !== undefined) {
          upsertOps.push(
            dbUnified.updateOne(
              'suppliers',
              { id: demoSupplier.id },
              {
                $set: { ...demoSupplier, updatedAt: now },
              }
            )
          );
          updatedCount++;
        } else {
          upsertOps.push(
            dbUnified.insertOne('suppliers', {
              ...demoSupplier,
              createdAt: demoSupplier.createdAt || now,
              updatedAt: now,
            })
          );
          insertedCount++;
        }
      }

      await Promise.all(upsertOps);

      // Create audit log using DATA_EXPORT action as it's the closest match for data import
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.DATA_EXPORT,
        targetType: 'suppliers',
        targetId: 'demo-import',
        details: {
          imported: true,
          inserted: insertedCount,
          updated: updatedCount,
          total: demoSuppliers.length,
        },
      });

      res.json({
        ok: true,
        inserted: insertedCount,
        updated: updatedCount,
        total: demoSuppliers.length,
        message: `Successfully imported ${demoSuppliers.length} demo supplier(s): ${insertedCount} new, ${updatedCount} updated`,
      });
    } catch (error) {
      logger.error('Error importing demo suppliers:', error);
      res.status(500).json({
        error: `Failed to import demo suppliers: ${error.message}`,
      });
    }
  }
);

/**
 * GET /api/admin/packages
 * List all packages for admin moderation (optionally filtered by supplierId and/or featured)
 */
router.get('/packages', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    let items = await dbUnified.read('packages');
    const { supplierId, featured } = req.query;
    if (supplierId) {
      items = items.filter(pkg => pkg.supplierId === supplierId || pkg.supplier_id === supplierId);
    }
    if (featured === 'true') {
      items = items.filter(pkg => pkg.featured === true);
    }
    res.json({ items });
  } catch (error) {
    logger.error('Error reading packages:', error);
    res.status(500).json({ error: 'Failed to load packages' });
  }
});

/**
 * Generate a URL-safe slug from a title
 * @param {string} title - The title to convert to a slug
 * @returns {string} URL-safe slug
 */
function generateSlug(title) {
  if (!title) {
    return '';
  }
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * POST /api/admin/packages
 * Create a new package
 */
router.post('/packages', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const { supplierId, title, description, price_display, image, approved, featured } = req.body;

    // Validate required fields
    if (!supplierId || !title) {
      return res.status(400).json({ error: 'Supplier ID and title are required' });
    }

    // Validate that supplier exists
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) {
      return res.status(400).json({ error: 'Invalid supplier ID' });
    }

    const packages = await dbUnified.read('packages');
    const now = new Date().toISOString();

    // Generate slug from title
    const slug = generateSlug(title);
    if (!slug) {
      return res
        .status(400)
        .json({ error: 'Title must contain valid characters for slug generation' });
    }

    // Check if slug already exists
    const existingPackage = packages.find(p => p.slug === slug);
    if (existingPackage) {
      return res
        .status(400)
        .json({ error: 'A package with this title already exists. Please use a different title.' });
    }

    // Create new package
    const newPackage = {
      id: uid(),
      supplierId,
      title,
      slug,
      description: description || '',
      price_display: price_display || 'Contact for pricing',
      image: image || '/assets/images/placeholders/package-event.svg',
      approved: approved === true,
      featured: featured === true,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.id,
      versionHistory: [],
    };

    await dbUnified.insertOne('packages', newPackage);

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.PACKAGE_CREATED,
      targetType: 'package',
      targetId: newPackage.id,
      details: { packageTitle: newPackage.title },
    });

    res.status(201).json({ success: true, package: newPackage });
  } catch (error) {
    logger.error('Error creating package:', error);
    res.status(500).json({ error: 'Failed to create package' });
  }
});

/**
 * POST /api/admin/packages/:id/approve
 * Approve or reject a package
 */
router.post(
  '/packages/:id/approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const pkg = await dbUnified.findOne('packages', { id: req.params.id });
    if (!pkg) {
      return res.status(404).json({ error: 'Not found' });
    }
    const approved = !!(req.body && req.body.approved);
    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: { approved } });
    res.json({ ok: true, package: { ...pkg, approved } });
  }
);

/**
 * POST /api/admin/packages/:id/feature
 * Feature or unfeature a package
 */
router.post(
  '/packages/:id/feature',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const pkg = await dbUnified.findOne('packages', { id: req.params.id });
    if (!pkg) {
      return res.status(404).json({ error: 'Not found' });
    }
    const featured = !!(req.body && req.body.featured);
    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: { featured } });
    res.json({ ok: true, package: { ...pkg, featured } });
  }
);

/**
 * POST /api/admin/packages/bulk-approve
 * Bulk approve packages
 * Body: { packageIds: string[], approved: boolean }
 */
router.post(
  '/packages/bulk-approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { packageIds, approved = true } = req.body;

      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return res.status(400).json({ error: 'packageIds must be a non-empty array' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (packageIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
        });
      }

      const packages = await dbUnified.read('packages');
      const now = new Date().toISOString();
      const toUpdate = packageIds.filter(id => packages.some(p => p.id === id));
      const updatedCount = toUpdate.length;

      if (updatedCount > 0) {
        await Promise.all(
          toUpdate.map(id =>
            dbUnified.updateOne(
              'packages',
              { id },
              {
                $set: { approved: !!approved, updatedAt: now, approvedBy: req.user.id },
              }
            )
          )
        );
      }

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: approved ? 'BULK_PACKAGES_APPROVED' : 'BULK_PACKAGES_REJECTED',
        targetType: 'packages',
        targetId: 'bulk',
        details: { packageIds, count: updatedCount, approved },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully ${approved ? 'approved' : 'rejected'} ${updatedCount} package(s)`,
        updatedCount,
      });
    } catch (error) {
      logger.error('Error bulk approving packages:', error);
      res.status(500).json({ error: 'Failed to bulk approve packages' });
    }
  }
);

/**
 * POST /api/admin/packages/bulk-feature
 * Bulk feature/unfeature packages
 * Body: { packageIds: string[], featured: boolean }
 */
router.post(
  '/packages/bulk-feature',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { packageIds, featured = true } = req.body;

      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return res.status(400).json({ error: 'packageIds must be a non-empty array' });
      }

      const packages = await dbUnified.read('packages');
      const now = new Date().toISOString();
      const toUpdate = packageIds.filter(id => packages.some(p => p.id === id));
      const updatedCount = toUpdate.length;

      if (updatedCount > 0) {
        await Promise.all(
          toUpdate.map(id =>
            dbUnified.updateOne(
              'packages',
              { id },
              {
                $set: { featured: !!featured, updatedAt: now, featuredBy: req.user.id },
              }
            )
          )
        );
      }

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: featured ? 'BULK_PACKAGES_FEATURED' : 'BULK_PACKAGES_UNFEATURED',
        targetType: 'packages',
        targetId: 'bulk',
        details: { packageIds, count: updatedCount, featured },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully ${featured ? 'featured' : 'unfeatured'} ${updatedCount} package(s)`,
        updatedCount,
      });
    } catch (error) {
      logger.error('Error bulk featuring packages:', error);
      res.status(500).json({ error: 'Failed to bulk feature packages' });
    }
  }
);

/**
 * POST /api/admin/packages/bulk-delete
 * Bulk delete packages
 * Body: { packageIds: string[] }
 */
router.post(
  '/packages/bulk-delete',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { packageIds } = req.body;

      if (!Array.isArray(packageIds) || packageIds.length === 0) {
        return res.status(400).json({ error: 'packageIds must be a non-empty array' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (packageIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
        });
      }

      const packages = await dbUnified.read('packages');
      const toDelete = packageIds.filter(id => packages.some(p => p.id === id));
      const deletedCount = toDelete.length;

      if (deletedCount > 0) {
        await Promise.all(toDelete.map(id => dbUnified.deleteOne('packages', id)));
      }

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_PACKAGES_DELETED',
        targetType: 'packages',
        targetId: 'bulk',
        details: { packageIds, count: deletedCount },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully deleted ${deletedCount} package(s)`,
        deletedCount,
      });
    } catch (error) {
      logger.error('Error bulk deleting packages:', error);
      res.status(500).json({ error: 'Failed to bulk delete packages' });
    }
  }
);

// ---------- Bulk Supplier Actions ----------

/**
 * POST /api/admin/suppliers/bulk-approve
 * Bulk approve/reject suppliers
 */
// prettier-ignore
router.post('/suppliers/bulk-approve', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
    try {
      const { supplierIds, approved = true } = req.body;
      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }
      const all = await dbUnified.read('suppliers');
      const now = new Date().toISOString();
      const toUpdate = supplierIds.filter(id => all.some(s => s.id === id));
      const count = toUpdate.length;
      await Promise.all(
        toUpdate.map(id =>
          dbUnified.updateOne('suppliers', { id }, {
            $set: { approved, approvedAt: approved ? now : null },
          })
        )
      );
      await auditLog({
        action: AUDIT_ACTIONS.SUPPLIER_APPROVED,
        userId: req.user.id,
        meta: { count },
      });
      res.json({ success: true, count });
    } catch (error) {
      logger.error('Bulk approve suppliers error:', error);
      res.status(500).json({ error: 'Failed to bulk approve suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/bulk-reject
 * Bulk reject suppliers
 */
// prettier-ignore
router.post('/suppliers/bulk-reject', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
    try {
      const { supplierIds } = req.body;
      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }
      const all = await dbUnified.read('suppliers');
      const now = new Date().toISOString();
      const toUpdate = supplierIds.filter(id => all.some(s => s.id === id));
      const count = toUpdate.length;
      await Promise.all(
        toUpdate.map(id =>
          dbUnified.updateOne('suppliers', { id }, {
            $set: { approved: false, rejectedAt: now },
          })
        )
      );
      await auditLog({
        action: AUDIT_ACTIONS.SUPPLIER_REJECTED,
        userId: req.user.id,
        meta: { count },
      });
      res.json({ success: true, count });
    } catch (error) {
      logger.error('Bulk reject suppliers error:', error);
      res.status(500).json({ error: 'Failed to bulk reject suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/bulk-delete
 * Bulk delete suppliers
 */
// prettier-ignore
router.post('/suppliers/bulk-delete', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
    try {
      const { supplierIds } = req.body;
      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }
      const all = await dbUnified.read('suppliers');
      const toDelete = supplierIds.filter(id => all.some(s => s.id === id));
      await Promise.all(toDelete.map(id => dbUnified.deleteOne('suppliers', id)));
      await auditLog({
        action: AUDIT_ACTIONS.SUPPLIER_DELETED,
        userId: req.user.id,
        meta: { count: toDelete.length },
      });
      res.json({ success: true, deleted: toDelete.length });
    } catch (error) {
      logger.error('Bulk delete suppliers error:', error);
      res.status(500).json({ error: 'Failed to bulk delete suppliers' });
    }
  }
);

// ---------- Bulk User Actions ----------

/**
 * POST /api/admin/users/bulk-verify
 * Bulk verify users
 */
router.post(
  '/users/bulk-verify',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }
      const all = await dbUnified.read('users');
      let count = 0;
      const now = new Date().toISOString();
      const verifyPromises = userIds.map(userId => {
        const user = all.find(u => u.id === userId);
        if (user) {
          count++;
          return dbUnified.updateOne(
            'users',
            { id: userId },
            {
              $set: { verified: true, verifiedAt: now },
            }
          );
        }
        return Promise.resolve();
      });
      await Promise.all(verifyPromises);
      await auditLog({
        action: AUDIT_ACTIONS.BULK_USERS_VERIFIED,
        userId: req.user.id,
        meta: { count },
      });
      res.json({ success: true, count, BULK_USERS_VERIFIED: AUDIT_ACTIONS.BULK_USERS_VERIFIED });
    } catch (error) {
      logger.error('Bulk verify users error:', error);
      res.status(500).json({ error: 'Failed to bulk verify users' });
    }
  }
);

/**
 * POST /api/admin/users/bulk-suspend
 * Bulk suspend users (cannot suspend self)
 */
router.post(
  '/users/bulk-suspend',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds, duration } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }
      // Prevent self-suspension
      const filteredIds = userIds.filter(id => id !== req.user.id);
      if (filteredIds.length === 0 && userIds.length > 0) {
        return res.status(400).json({ error: 'Cannot suspend your own account' });
      }
      const suspendUntil = duration ? new Date(Date.now() + parseDuration(duration)) : null;
      const all = await dbUnified.read('users');
      let count = 0;
      const suspendedAt = new Date().toISOString();
      const suspendPromises = filteredIds
        .filter(id => id !== req.user.id && all.find(u => u.id === id))
        .map(userId => {
          count++;
          return dbUnified.updateOne(
            'users',
            { id: userId },
            {
              $set: {
                suspended: true,
                suspendedAt,
                suspendedUntil: suspendUntil ? suspendUntil.toISOString() : null,
              },
            }
          );
        });
      await Promise.all(suspendPromises);
      await auditLog({
        action: AUDIT_ACTIONS.BULK_USERS_SUSPENDED,
        userId: req.user.id,
        meta: { count },
      });
      res.json({ success: true, count, BULK_USERS_SUSPENDED: AUDIT_ACTIONS.BULK_USERS_SUSPENDED });
    } catch (error) {
      logger.error('Bulk suspend users error:', error);
      res.status(500).json({ error: 'Failed to bulk suspend users' });
    }
  }
);

// ---------- User Search ----------

/**
 * GET /api/admin/users/search
 * Search users with filters and pagination
 */
router.get('/users/search', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const { q, role, verified, suspended, startDate, endDate, limit = 20, offset = 0 } = req.query;
    let users = await dbUnified.read('users');

    // Apply filters
    if (q) {
      const query = q.toLowerCase();
      users = users.filter(
        u =>
          (u.email || '').toLowerCase().includes(query) ||
          (u.name || '').toLowerCase().includes(query)
      );
    }
    if (role) {
      users = users.filter(u => u.role === role);
    }
    if (verified !== undefined) {
      users = users.filter(u => u.verified === (verified === 'true'));
    }
    if (suspended !== undefined) {
      users = users.filter(u => u.suspended === (suspended === 'true'));
    }
    if (startDate) {
      users = users.filter(u => new Date(u.createdAt) >= new Date(startDate));
    }
    if (endDate) {
      users = users.filter(u => new Date(u.createdAt) <= new Date(endDate));
    }

    const total = users.length;
    const startIndex = Number(offset);
    const endIndex = startIndex + Number(limit);
    const page = users.slice(startIndex, endIndex);
    const hasMore = endIndex < total;

    // Sanitize: remove sensitive fields
    const sanitizedUsers = page.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      verified: u.verified,
      suspended: u.suspended,
      createdAt: u.createdAt,
    }));

    res.json({ users: sanitizedUsers, total, hasMore, offset: startIndex, limit: Number(limit) });
  } catch (error) {
    logger.error('Users search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// ---------- Photo Moderation ----------

/**
 * GET /api/admin/photos/pending
 * Get all photos pending approval
 */
router.get('/photos/pending', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const photos = await dbUnified.read('photos');
    const pendingPhotos = photos.filter(p => p.status === 'pending');

    // Enrich with supplier information
    const suppliers = await dbUnified.read('suppliers');
    const enrichedPhotos = pendingPhotos.map(photo => {
      const supplier = suppliers.find(s => s.id === photo.supplierId);
      return {
        ...photo,
        supplierName: supplier ? supplier.name : 'Unknown',
        supplierCategory: supplier ? supplier.category : null,
      };
    });

    res.json({ photos: enrichedPhotos });
  } catch (error) {
    logger.error('Error fetching pending photos:', error);
    res.status(500).json({ error: 'Failed to fetch pending photos' });
  }
});

/**
 * POST /api/admin/photos/:id/approve
 * Approve a photo
 */
router.post(
  '/photos/:id/approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const photos = await dbUnified.read('photos');
      const photoIndex = photos.findIndex(p => p.id === id);

      if (photoIndex === -1) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const photo = photos[photoIndex];
      const now = new Date().toISOString();

      // Update photo status
      photo.status = 'approved';
      photo.approvedAt = now;
      photo.approvedBy = req.user.id;

      await dbUnified.updateOne(
        'photos',
        { id: photo.id },
        {
          $set: {
            status: photo.status,
            approvedAt: photo.approvedAt,
            approvedBy: photo.approvedBy,
          },
        }
      );

      // Add photo to supplier's photos array if not already there
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === photo.supplierId);

      if (supplierIndex !== -1) {
        if (!suppliers[supplierIndex].photos) {
          suppliers[supplierIndex].photos = [];
        }
        if (!suppliers[supplierIndex].photos.includes(photo.url)) {
          suppliers[supplierIndex].photos.push(photo.url);
          await dbUnified.updateOne(
            'suppliers',
            { id: suppliers[supplierIndex].id },
            { $set: { photos: suppliers[supplierIndex].photos } }
          );
        }
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.CONTENT_APPROVED,
        targetType: 'photo',
        targetId: photo.id,
        details: { supplierId: photo.supplierId, url: photo.url },
      });

      res.json({ success: true, message: 'Photo approved successfully', photo });
    } catch (error) {
      logger.error('Error approving photo:', error);
      res.status(500).json({ error: 'Failed to approve photo' });
    }
  }
);

/**
 * POST /api/admin/photos/:id/reject
 * Reject a photo
 */
router.post(
  '/photos/:id/reject',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const photos = await dbUnified.read('photos');
      const photoIndex = photos.findIndex(p => p.id === id);

      if (photoIndex === -1) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const photo = photos[photoIndex];
      const now = new Date().toISOString();

      // Update photo status
      photo.status = 'rejected';
      photo.rejectedAt = now;
      photo.rejectedBy = req.user.id;
      photo.rejectionReason = reason || 'No reason provided';

      photos[photoIndex] = photo;
      await dbUnified.updateOne(
        'photos',
        { id: photo.id },
        {
          $set: {
            status: photo.status,
            rejectedAt: photo.rejectedAt,
            rejectedBy: photo.rejectedBy,
            rejectionReason: photo.rejectionReason,
          },
        }
      );

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.CONTENT_REJECTED,
        targetType: 'photo',
        targetId: photo.id,
        details: {
          supplierId: photo.supplierId,
          url: photo.url,
          reason: photo.rejectionReason,
        },
      });

      res.json({ success: true, message: 'Photo rejected successfully', photo });
    } catch (error) {
      logger.error('Error rejecting photo:', error);
      res.status(500).json({ error: 'Failed to reject photo' });
    }
  }
);

/**
 * POST /api/admin/photos/batch-approve
 * Batch approve multiple photos
 * Body: { photoIds: string[], action: 'approve' | 'reject', reason?: string }
 */
router.post(
  '/photos/batch-approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { photoIds, action, reason } = req.body;

      // Validate input
      if (!Array.isArray(photoIds) || photoIds.length === 0) {
        return res.status(400).json({ error: 'photoIds array is required' });
      }

      if (action !== 'approve' && action !== 'reject') {
        return res.status(400).json({ error: 'action must be "approve" or "reject"' });
      }

      // Limit batch size
      if (photoIds.length > BATCH_PHOTO_LIMIT) {
        return res.status(400).json({
          error: `Cannot process more than ${BATCH_PHOTO_LIMIT} photos at once`,
        });
      }

      const photos = await dbUnified.read('photos');
      const suppliers = await dbUnified.read('suppliers');
      const now = new Date().toISOString();

      const results = {
        success: [],
        failed: [],
      };

      const photoUpdates = [];
      const supplierPhotoUpdates = new Map(); // supplierId -> new photos array

      for (const photoId of photoIds) {
        try {
          const photo = photos.find(p => p.id === photoId);

          if (!photo) {
            results.failed.push({ photoId, error: 'Photo not found' });
            continue;
          }

          if (action === 'approve') {
            photoUpdates.push(
              dbUnified.updateOne(
                'photos',
                { id: photoId },
                {
                  $set: { status: 'approved', approvedAt: now, approvedBy: req.user.id },
                }
              )
            );

            // Collect supplier photo-array updates
            const supplier = suppliers.find(s => s.id === photo.supplierId);
            if (supplier) {
              const existing = supplierPhotoUpdates.get(photo.supplierId) || [
                ...(supplier.photos || []),
              ];
              if (!existing.includes(photo.url)) {
                existing.push(photo.url);
              }
              supplierPhotoUpdates.set(photo.supplierId, existing);
            }

            auditLog({
              adminId: req.user.id,
              adminEmail: req.user.email,
              action: AUDIT_ACTIONS.CONTENT_APPROVED,
              targetType: 'photo',
              targetId: photoId,
              details: { supplierId: photo.supplierId, batch: true },
            });
          } else {
            photoUpdates.push(
              dbUnified.updateOne(
                'photos',
                { id: photoId },
                {
                  $set: {
                    status: 'rejected',
                    rejectedAt: now,
                    rejectedBy: req.user.id,
                    rejectionReason: reason || 'Batch rejection',
                  },
                }
              )
            );

            auditLog({
              adminId: req.user.id,
              adminEmail: req.user.email,
              action: AUDIT_ACTIONS.CONTENT_REJECTED,
              targetType: 'photo',
              targetId: photoId,
              details: {
                supplierId: photo.supplierId,
                reason: reason || 'Batch rejection',
                batch: true,
              },
            });
          }

          results.success.push(photoId);
        } catch (error) {
          results.failed.push({ photoId, error: error.message });
        }
      }

      // Persist all photo updates atomically
      await Promise.all(photoUpdates);
      if (action === 'approve') {
        await Promise.all(
          [...supplierPhotoUpdates.entries()].map(([supplierId, updatedPhotos]) =>
            dbUnified.updateOne(
              'suppliers',
              { id: supplierId },
              { $set: { photos: updatedPhotos } }
            )
          )
        );
      }

      res.json({
        success: true,
        message: `Batch ${action} completed`,
        results: {
          total: photoIds.length,
          succeeded: results.success.length,
          failed: results.failed.length,
          details: results,
        },
      });
    } catch (error) {
      logger.error('Error in batch photo approval:', error);
      res.status(500).json({ error: 'Failed to batch approve photos' });
    }
  }
);

// ---------- Smart Tagging ----------

/**
 * POST /api/admin/suppliers/smart-tags
 * Generate smart tags for all suppliers based on their descriptions and categories
 *
 * Smart tagging logic:
 * 1. Only processes approved suppliers
 * 2. Combines supplier name, descriptions, category, and amenities into searchable text
 * 3. Applies three types of tags:
 *    - Category-based tags: Direct mapping from supplier category (e.g., "Venues" -> venue, location, space)
 *    - Context-based tags: Keywords found in supplier text (e.g., "wedding", "luxury", "outdoor")
 *    - Location-based tags: Extracts words from location field (min 4 characters)
 * 4. Limits each supplier to 10 tags maximum to avoid overwhelming the system
 * 5. Creates an audit log entry tracking how many suppliers were tagged
 */
router.post(
  '/suppliers/smart-tags',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const suppliers = await dbUnified.read('suppliers');
      let taggedCount = 0;

      // Common wedding/event industry tags mapped to supplier categories
      // These tags are automatically applied based on the supplier's category field
      const tagMapping = {
        venues: ['venue', 'location', 'space', 'ceremony', 'reception'],
        catering: ['food', 'catering', 'menu', 'dining', 'buffet', 'meal'],
        photography: ['photo', 'photography', 'photographer', 'camera', 'pictures'],
        entertainment: ['music', 'band', 'dj', 'entertainment', 'performance'],
        flowers: ['flowers', 'floral', 'bouquet', 'decoration', 'decor'],
        transport: ['transport', 'car', 'vehicle', 'limousine', 'travel'],
        extras: ['extras', 'accessories', 'favors', 'gifts'],
      };

      // Context-based tags that are applied when keywords are found in supplier text
      // Key = tag to add, Value = array of keywords that trigger the tag
      const contextTags = {
        wedding: ['wedding', 'bride', 'groom', 'marriage', 'nuptial'],
        outdoor: ['outdoor', 'garden', 'countryside', 'open-air'],
        indoor: ['indoor', 'barn', 'hall', 'ballroom'],
        luxury: ['luxury', 'premium', 'exclusive', 'upscale'],
        rustic: ['rustic', 'countryside', 'barn', 'rural'],
        modern: ['modern', 'contemporary', 'stylish'],
        traditional: ['traditional', 'classic', 'formal'],
        budget: ['affordable', 'budget', 'value'],
      };

      const tagUpdates = [];
      suppliers.forEach(supplier => {
        // Skip unapproved suppliers - only tag suppliers that are live on the platform
        if (!supplier.approved) {
          return;
        }

        const tags = new Set(); // Use Set to automatically handle duplicates

        // Combine all searchable text from supplier profile
        const text = [
          supplier.name || '',
          supplier.description_short || '',
          supplier.description_long || '',
          supplier.category || '',
          ...(supplier.amenities || []),
        ]
          .join(' ')
          .toLowerCase();

        // Step 1: Add category-based tags
        // Normalize category name (remove spaces/special chars) to match mapping keys
        const categoryKey = (supplier.category || '').toLowerCase().replace(/[^a-z]/g, '');
        if (tagMapping[categoryKey]) {
          tagMapping[categoryKey].forEach(tag => tags.add(tag));
        }

        // Step 2: Add context-based tags by scanning text for keywords
        Object.entries(contextTags).forEach(([tag, keywords]) => {
          // If ANY keyword is found in the text, add the tag
          if (keywords.some(keyword => text.includes(keyword))) {
            tags.add(tag);
          }
        });

        // Step 3: Add location-based tags
        // Extract meaningful words from location (min 4 chars to avoid "UK", "NY", etc.)
        if (supplier.location) {
          const locationWords = supplier.location.toLowerCase().split(/[,\s]+/);
          locationWords.forEach(word => {
            if (word.length > 3) {
              tags.add(word);
            }
          });
        }

        // Only update supplier if we generated at least one tag
        if (tags.size > 0) {
          const supplierTags = Array.from(tags).slice(0, 10); // Limit to 10 tags per supplier
          tagUpdates.push(
            dbUnified.updateOne('suppliers', { id: supplier.id }, { $set: { tags: supplierTags } })
          );
          taggedCount++;
        }
      });

      await Promise.all(tagUpdates);

      // Create audit log for tracking when tags were generated
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'SMART_TAGS_GENERATED',
        targetType: 'suppliers',
        targetId: null,
        details: { suppliersTagged: taggedCount },
      });

      res.json({
        success: true,
        message: `Smart tags generated for ${taggedCount} suppliers`,
        taggedCount,
      });
    } catch (error) {
      logger.error('Error generating smart tags:', error);
      res.status(500).json({ error: 'Failed to generate smart tags', details: error.message });
    }
  }
);

// ---------- Badge Counts ----------

/**
 * Generate a unique ID using crypto module
 * @param {string} prefix - Prefix for the ID (e.g., 'announcement', 'faq')
 * @returns {string} Unique ID
 */
function generateUniqueId(prefix) {
  // Use crypto.randomUUID if available (Node 14.17+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  // Fallback for older Node versions
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  return `${prefix}_${timestamp}_${random}${random2}`;
}

/**
 * GET /api/admin/badge-counts
 * Get counts for sidebar badges (pending items for admin review)
 * Returns: pending suppliers, packages, photos, reviews, reports, and totals
 */
router.get('/badge-counts', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    // Use efficient counting instead of loading full collections
    const [
      pendingSuppliers,
      pendingPackages,
      pendingReviews,
      pendingReports,
      totalSuppliers,
      totalPackages,
      totalReviews,
      totalReports,
    ] = await Promise.all([
      dbUnified.count('suppliers', { approved: false }),
      dbUnified.count('packages', { approved: false }),
      dbUnified.count('reviews', { status: 'pending' }),
      dbUnified.count('reports', { status: 'pending' }),
      dbUnified.count('suppliers'),
      dbUnified.count('packages'),
      dbUnified.count('reviews'),
      dbUnified.count('reports'),
    ]);

    // pendingSuppliers = suppliers where !s.approved
    // pendingReviews includes status 'pending' and flagged reviews
    // Note: pendingPhotos requires special handling since photos are nested
    let pendingPhotos = 0;
    const suppliers = await dbUnified.read('suppliers');
    const packages = await dbUnified.read('packages');
    suppliers.forEach(s => {
      if (s.photosGallery && Array.isArray(s.photosGallery)) {
        pendingPhotos += s.photosGallery.filter(p => !p.approved).length;
      }
    });
    packages.forEach(pkg => {
      if (pkg.gallery && Array.isArray(pkg.gallery)) {
        pendingPhotos += pkg.gallery.filter(p => !p.approved).length;
      }
    });

    res.json({
      pending: {
        suppliers: pendingSuppliers,
        packages: pendingPackages,
        photos: pendingPhotos,
        reviews: pendingReviews,
        reports: pendingReports,
      },
      totals: {
        suppliers: totalSuppliers,
        packages: totalPackages,
        reviews: totalReviews,
        reports: totalReports,
      },
    });
  } catch (error) {
    logger.error('Error fetching badge counts:', error);
    // Return zeroed counts instead of crashing
    res.status(500).json({
      error: 'Failed to fetch badge counts',
      pending: {
        suppliers: 0,
        packages: 0,
        photos: 0,
        reviews: 0,
        reports: 0,
      },
      totals: {
        suppliers: 0,
        packages: 0,
        reviews: 0,
        reports: 0,
      },
    });
  }
});

/**
 * GET /api/admin/dashboard/counts
 * Get badge counts for admin dashboard
 * Returns counts for pending items that need admin action
 */
router.get('/dashboard/counts', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const photos = await dbUnified.read('photos');
    const suppliers = await dbUnified.read('suppliers');
    const reviews = await dbUnified.read('reviews');
    const reports = await dbUnified.read('reports');
    const tickets = await dbUnified.read('tickets');

    const pendingPhotos = photos.filter(p => p.status === 'pending').length;
    const pendingSuppliers = suppliers.filter(s => s.approvalStatus === 'pending').length;
    const pendingReviews = reviews.filter(r => r.status === 'pending').length;
    const openReports = reports.filter(r => r.status === 'open').length;
    const openTickets = tickets.filter(t => t.status === 'open').length;

    res.json({
      success: true,
      counts: {
        pendingPhotos,
        pendingSuppliers,
        pendingReviews,
        openReports,
        openTickets,
      },
    });
  } catch (error) {
    logger.error('Error fetching dashboard counts:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard counts',
      counts: {
        pendingPhotos: 0,
        pendingSuppliers: 0,
        pendingReviews: 0,
        openReports: 0,
        openTickets: 0,
      },
    });
  }
});

// ---------- Content Management ----------

/**
 * GET /api/admin/content/homepage
 * Get homepage hero content
 */
router.get('/content/homepage', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const homepage = content.homepage || {
      title: 'Plan Your Perfect Event',
      subtitle: 'Discover amazing suppliers and packages for your special day',
      ctaText: 'Start Planning',
    };
    res.json(homepage);
  } catch (error) {
    logger.error('Error reading content/homepage:', error);
    res.status(500).json({ error: 'Failed to load homepage content' });
  }
});

/**
 * PUT /api/admin/content/homepage
 * Update homepage hero content
 */
router.put(
  '/content/homepage',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { title, subtitle, ctaText } = req.body;

    const content = (await dbUnified.read('content')) || {};
    content.homepage = {
      title: title || 'Plan Your Perfect Event',
      subtitle: subtitle || 'Discover amazing suppliers and packages for your special day',
      ctaText: ctaText || 'Start Planning',
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.email,
    };

    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'CONTENT_UPDATED',
      targetType: 'homepage',
      targetId: null,
      details: { title, subtitle, ctaText },
    });

    res.json({ success: true, content: content.homepage });
  }
);

/**
 * POST /api/admin/homepage/hero-image
 * Upload hero image for homepage
 */
const heroImageUploadDir = path.join(__dirname, '../public/uploads/hero');

// Ensure upload directory exists
if (!fs.existsSync(heroImageUploadDir)) {
  fs.mkdirSync(heroImageUploadDir, { recursive: true });
}

const heroImageUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, heroImageUploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `hero-${uniqueSuffix}${ext}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow only images
    const allowedTypes = /^image\/(jpeg|jpg|png|gif|webp)$/;
    if (!allowedTypes.test(file.mimetype)) {
      cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WebP)'));
      return;
    }
    cb(null, true);
  },
});

router.post(
  '/homepage/hero-image',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  heroImageUpload.single('image'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      const imageUrl = `/uploads/hero/${req.file.filename}`;

      // Optionally resize image using sharp if available
      try {
        const sharp = require('sharp');
        const outputPath = path.join(heroImageUploadDir, req.file.filename);
        await sharp(req.file.path)
          .resize(1920, 1080, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 85 })
          .toFile(`${outputPath}.optimized`);

        // Replace original with optimized
        fs.renameSync(`${outputPath}.optimized`, outputPath);
      } catch (sharpError) {
        // Sharp not available or error, use original image
        logger.info('Sharp not available for image optimization:', sharpError.message);
      }

      // Save to homepage settings
      const content = (await dbUnified.read('content')) || {};
      if (!content.homepage) {
        content.homepage = {};
      }
      content.homepage.heroImage = imageUrl;
      content.homepage.heroImageUpdatedAt = new Date().toISOString();
      content.homepage.heroImageUpdatedBy = req.user.email;
      await dbUnified.write('content', content);

      // Audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'CONTENT_UPDATED',
        targetType: 'homepage',
        targetId: 'hero-image',
        details: { imageUrl },
      });

      res.json({
        success: true,
        imageUrl,
        filename: req.file.filename,
      });
    } catch (error) {
      logger.error('Hero image upload error:', error);
      res.status(500).json({
        error: 'Failed to upload hero image',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/content/announcements
 * Get all announcements
 */
router.get('/content/announcements', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const announcements = content.announcements || [];
    res.json(announcements);
  } catch (error) {
    logger.error('Error reading content/announcements:', error);
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

/**
 * POST /api/admin/content/announcements
 * Create a new announcement
 */
router.post(
  '/content/announcements',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { message, type, active } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const content = (await dbUnified.read('content')) || {};
    if (!content.announcements) {
      content.announcements = [];
    }

    const announcement = {
      id: generateUniqueId('announcement'),
      message,
      type: type || 'info',
      active: active !== false,
      createdAt: new Date().toISOString(),
      createdBy: req.user.email,
    };

    content.announcements.push(announcement);
    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'ANNOUNCEMENT_CREATED',
      targetType: 'announcement',
      targetId: announcement.id,
      details: { message, type },
    });

    res.json({ success: true, announcement });
  }
);

/**
 * GET /api/admin/content/announcements/:id
 * Get a specific announcement
 */
router.get('/content/announcements/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const announcements = content.announcements || [];
    const announcement = announcements.find(a => a.id === req.params.id);

    if (!announcement) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    res.json(announcement);
  } catch (error) {
    logger.error('Error reading announcement:', error);
    res.status(500).json({ error: 'Failed to load announcement' });
  }
});

/**
 * PUT /api/admin/content/announcements/:id
 * Update an announcement
 */
router.put(
  '/content/announcements/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { message, type, active } = req.body;

    const content = (await dbUnified.read('content')) || {};
    if (!content.announcements) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const announcementIndex = content.announcements.findIndex(a => a.id === req.params.id);
    if (announcementIndex === -1) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    content.announcements[announcementIndex] = {
      ...content.announcements[announcementIndex],
      message: message || content.announcements[announcementIndex].message,
      type: type || content.announcements[announcementIndex].type,
      active: active !== undefined ? active : content.announcements[announcementIndex].active,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.email,
    };

    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'ANNOUNCEMENT_UPDATED',
      targetType: 'announcement',
      targetId: req.params.id,
      details: { message, type, active },
    });

    res.json({ success: true, announcement: content.announcements[announcementIndex] });
  }
);

/**
 * DELETE /api/admin/content/announcements/:id
 * Delete an announcement
 */
router.delete(
  '/content/announcements/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const content = (await dbUnified.read('content')) || {};
    if (!content.announcements) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const announcementIndex = content.announcements.findIndex(a => a.id === req.params.id);
    if (announcementIndex === -1) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    const deleted = content.announcements.splice(announcementIndex, 1)[0];
    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'ANNOUNCEMENT_DELETED',
      targetType: 'announcement',
      targetId: req.params.id,
      details: { message: deleted.message },
    });

    res.json({ success: true, message: 'Announcement deleted' });
  }
);

/**
 * GET /api/admin/content/faqs
 * Get all FAQs
 */
router.get('/content/faqs', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const faqs = content.faqs || [];
    res.json(faqs);
  } catch (error) {
    logger.error('Error reading content/faqs:', error);
    res.status(500).json({ error: 'Failed to load FAQs' });
  }
});

/**
 * POST /api/admin/content/faqs
 * Create a new FAQ
 */
router.post(
  '/content/faqs',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { question, answer, category } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const content = (await dbUnified.read('content')) || {};
    if (!content.faqs) {
      content.faqs = [];
    }

    const faq = {
      id: generateUniqueId('faq'),
      question,
      answer,
      category: category || 'General',
      createdAt: new Date().toISOString(),
      createdBy: req.user.email,
    };

    content.faqs.push(faq);
    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'FAQ_CREATED',
      targetType: 'faq',
      targetId: faq.id,
      details: { question, category },
    });

    res.json({ success: true, faq });
  }
);

/**
 * GET /api/admin/content/faqs/:id
 * Get a specific FAQ
 */
router.get('/content/faqs/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const content = (await dbUnified.read('content')) || {};
    const faqs = content.faqs || [];
    const faq = faqs.find(f => f.id === req.params.id);

    if (!faq) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    res.json(faq);
  } catch (error) {
    logger.error('Error reading FAQ:', error);
    res.status(500).json({ error: 'Failed to load FAQ' });
  }
});

/**
 * PUT /api/admin/content/faqs/:id
 * Update a FAQ
 */
router.put(
  '/content/faqs/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { question, answer, category } = req.body;

    const content = (await dbUnified.read('content')) || {};
    if (!content.faqs) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    const faqIndex = content.faqs.findIndex(f => f.id === req.params.id);
    if (faqIndex === -1) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    content.faqs[faqIndex] = {
      ...content.faqs[faqIndex],
      question: question || content.faqs[faqIndex].question,
      answer: answer || content.faqs[faqIndex].answer,
      category: category || content.faqs[faqIndex].category,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.email,
    };

    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'FAQ_UPDATED',
      targetType: 'faq',
      targetId: req.params.id,
      details: { question, category },
    });

    res.json({ success: true, faq: content.faqs[faqIndex] });
  }
);

/**
 * DELETE /api/admin/content/faqs/:id
 * Delete a FAQ
 */
router.delete(
  '/content/faqs/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const content = (await dbUnified.read('content')) || {};
    if (!content.faqs) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    const faqIndex = content.faqs.findIndex(f => f.id === req.params.id);
    if (faqIndex === -1) {
      return res.status(404).json({ error: 'FAQ not found' });
    }

    const deleted = content.faqs.splice(faqIndex, 1)[0];
    await dbUnified.write('content', content);

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'FAQ_DELETED',
      targetType: 'faq',
      targetId: req.params.id,
      details: { question: deleted.question },
    });

    res.json({ success: true, message: 'FAQ deleted' });
  }
);

// ---------- System Settings ----------

/**
 * GET /api/admin/settings/site
 * Get site configuration
 */
router.get('/settings/site', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const site = settings.site || {
      name: 'EventFlow',
      tagline: 'Event planning made simple',
      contactEmail: 'hello@eventflow.com',
      supportEmail: 'support@eventflow.com',
    };
    res.json(site);
  } catch (error) {
    logger.error('Error reading site settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

/**
 * PUT /api/admin/settings/site
 * Update site configuration
 */
router.put(
  '/settings/site',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { name, tagline, contactEmail, supportEmail } = req.body;

      const settings = (await dbUnified.read('settings')) || {};
      settings.site = {
        name: name || 'EventFlow',
        tagline: tagline || 'Event planning made simple',
        contactEmail: contactEmail || 'hello@eventflow.com',
        supportEmail: supportEmail || 'support@eventflow.com',
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.email,
      };

      // Write and verify to ensure persistence
      const result = await dbUnified.writeAndVerify('settings', settings);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'SETTINGS_UPDATED',
        targetType: 'site',
        targetId: null,
        details: { name, tagline },
      });

      // Return verified data from database
      res.json({ success: true, site: result.data.site });
    } catch (error) {
      logger.error('Error updating site settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

/**
 * GET /api/admin/settings/features
 * Get feature flags
 */
router.get('/settings/features', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {
      registration: true,
      supplierApplications: true,
      reviews: true,
      photoUploads: true,
      supportTickets: true,
      pexelsCollage: false,
    };

    // Ensure metadata fields are included in response
    // If they don't exist (older data), keep them undefined so frontend can handle gracefully
    const response = {
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
      reviews: features.reviews !== false,
      photoUploads: features.photoUploads !== false,
      supportTickets: features.supportTickets !== false,
      pexelsCollage: features.pexelsCollage === true,
      updatedAt: features.updatedAt,
      updatedBy: features.updatedBy,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error reading feature settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

/**
 * PUT /api/admin/settings/features
 * Update feature flags with timeout protection
 */
router.put(
  '/settings/features',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const startTime = Date.now();
    const requestId = `features-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    logger.info(`[${requestId}] Starting feature flags update by ${req.user.email}`);

    try {
      const {
        registration,
        supplierApplications,
        reviews,
        photoUploads,
        supportTickets,
        pexelsCollage,
      } = req.body;

      logger.info(`[${requestId}] Request body validated, reading current settings...`);

      // Helper function to create timeout promise
      const createTimeout = (ms, operation) => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
        });
      };

      // Read current settings with timeout
      const settings = await Promise.race([
        dbUnified.read('settings'),
        createTimeout(5000, 'Read operation'),
      ]).then(result => result || {});

      logger.info(`[${requestId}] Current settings read in ${Date.now() - startTime}ms`);

      // Validate all request data (all should be boolean or undefined)
      const featureFlags = [
        'registration',
        'supplierApplications',
        'reviews',
        'photoUploads',
        'supportTickets',
        'pexelsCollage',
      ];

      for (const flag of featureFlags) {
        const value = req.body[flag];
        if (value !== undefined && typeof value !== 'boolean') {
          logger.error(`[${requestId}] Invalid ${flag} value:`, value);
          return res.status(400).json({
            error: `Invalid feature flag value: ${flag} must be boolean`,
            field: flag,
          });
        }
      }

      const newFeatures = {
        registration: registration !== false,
        supplierApplications: supplierApplications !== false,
        reviews: reviews !== false,
        photoUploads: photoUploads !== false,
        supportTickets: supportTickets !== false,
        pexelsCollage: pexelsCollage === true,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.email,
      };

      settings.features = newFeatures;

      logger.info(`[${requestId}] Writing new feature flags to database...`, {
        pexelsCollage: newFeatures.pexelsCollage,
        registration: newFeatures.registration,
      });

      // Write and verify with timeout protection
      const writeStart = Date.now();
      const result = await Promise.race([
        dbUnified.writeAndVerify('settings', settings),
        createTimeout(5000, 'Write and verify operation'),
      ]);

      logger.info(
        `[${requestId}] Database write and verify completed in ${Date.now() - writeStart}ms`
      );

      // Log Pexels feature flag changes specifically
      if (pexelsCollage !== undefined) {
        logger.info(
          `[${requestId}] Pexels collage feature flag ${pexelsCollage ? 'ENABLED' : 'DISABLED'} by ${req.user.email}`
        );
      }

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'FEATURES_UPDATED',
        targetType: 'features',
        targetId: null,
        details: result.data.features,
      });

      const totalTime = Date.now() - startTime;
      logger.info(`[${requestId}] Feature flags update completed successfully in ${totalTime}ms`);

      // Return verified data from database
      res.json({ success: true, features: result.data.features });
    } catch (error) {
      const totalTime = Date.now() - startTime;
      logger.error(
        `[${requestId}] Error updating feature settings after ${totalTime}ms:`,
        error.message
      );
      logger.error(`[${requestId}] Stack trace:`, error.stack);

      // Provide detailed error message based on error type
      if (error.message.includes('timed out')) {
        return res.status(504).json({
          error: 'Request timed out',
          details: 'Database operation took too long to complete. Please try again.',
          duration: totalTime,
        });
      }

      res.status(500).json({
        error: 'Failed to update settings',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        duration: totalTime,
      });
    }
  }
);

/**
 * GET /api/admin/settings/maintenance
 * Get maintenance mode settings
 */
router.get('/settings/maintenance', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const maintenance = settings.maintenance || {
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    };
    res.json(maintenance);
  } catch (error) {
    logger.error('Error reading maintenance settings:', error);
    res.status(500).json({ error: 'Failed to read settings' });
  }
});

/**
 * PUT /api/admin/settings/maintenance
 * Update maintenance mode settings
 */
// prettier-ignore
router.put('/settings/maintenance', authRequired, roleRequired('admin'), csrfProtection, writeLimiter, async (req, res) => {
    try {
      const { enabled, message, duration } = req.body;

      const settings = (await dbUnified.read('settings')) || {};

      // Calculate expiration time if duration is provided and maintenance is being enabled
      let expiresAt = null;
      if (enabled && duration && Number(duration) > 0) {
        const durationMs = Number(duration) * 60 * 1000; // duration is in minutes
        expiresAt = new Date(Date.now() + durationMs).toISOString();
      }

      settings.maintenance = {
        enabled: enabled === true,
        message: message || "We're performing scheduled maintenance. We'll be back soon!",
        duration: duration ? Number(duration) : null, // Store duration in minutes
        expiresAt: expiresAt,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.email,
      };

      // Write and verify to ensure persistence
      const result = await dbUnified.writeAndVerify('settings', settings);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'MAINTENANCE_UPDATED',
        targetType: 'maintenance',
        targetId: null,
        details: { enabled, message, duration, expiresAt },
      });

      // Return verified data from database
      res.json({ success: true, maintenance: result.data.maintenance });
    } catch (error) {
      logger.error('Error updating maintenance settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

/**
 * GET /api/admin/settings/email-templates/:name
 * Get email template
 */
router.get(
  '/settings/email-templates/:name',
  authRequired,
  roleRequired('admin'),
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const emailTemplates = settings.emailTemplates || {};

      const defaultTemplates = {
        welcome: {
          subject: 'Welcome to EventFlow!',
          body: "Hi {{name}},\n\nWelcome to EventFlow! We're excited to help you plan your perfect event.\n\nBest regards,\nThe EventFlow Team",
        },
        verification: {
          subject: 'Verify your email address',
          body: 'Hi {{name}},\n\nPlease verify your email address by clicking the link below:\n\n{{verificationLink}}\n\nBest regards,\nThe EventFlow Team',
        },
        'password-reset': {
          subject: 'Reset your password',
          body: "Hi {{name}},\n\nYou requested a password reset. Click the link below to reset your password:\n\n{{resetLink}}\n\nIf you didn't request this, please ignore this email.\n\nBest regards,\nThe EventFlow Team",
        },
        'ticket-response': {
          subject: 'New response to your support ticket',
          body: 'Hi {{name}},\n\nYou have received a new response to your support ticket #{{ticketId}}.\n\n{{response}}\n\nBest regards,\nThe EventFlow Team',
        },
      };

      const template = emailTemplates[req.params.name] || defaultTemplates[req.params.name];

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json(template);
    } catch (error) {
      logger.error('Error reading email template:', error);
      res.status(500).json({ error: 'Failed to read settings' });
    }
  }
);

/**
 * PUT /api/admin/settings/email-templates/:name
 * Update email template
 */
router.put(
  '/settings/email-templates/:name',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { subject, body } = req.body;

      if (!subject || !body) {
        return res.status(400).json({ error: 'Subject and body are required' });
      }

      const settings = (await dbUnified.read('settings')) || {};
      if (!settings.emailTemplates) {
        settings.emailTemplates = {};
      }

      settings.emailTemplates[req.params.name] = {
        subject,
        body,
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.email,
      };

      // Write and verify to ensure persistence
      const result = await dbUnified.writeAndVerify('settings', settings);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'EMAIL_TEMPLATE_UPDATED',
        targetType: 'email-template',
        targetId: req.params.name,
        details: { subject },
      });

      // Return verified data from database
      res.json({ success: true, template: result.data.emailTemplates[req.params.name] });
    } catch (error) {
      logger.error('Error updating email template:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  }
);

/**
 * POST /api/admin/settings/email-templates/:name/reset
 * Reset email template to default
 */
router.post(
  '/settings/email-templates/:name/reset',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const settings = (await dbUnified.read('settings')) || {};
      if (!settings.emailTemplates) {
        settings.emailTemplates = {};
      }

      // Remove the custom template, will fall back to default
      delete settings.emailTemplates[req.params.name];
      await dbUnified.writeAndVerify('settings', settings);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'EMAIL_TEMPLATE_RESET',
        targetType: 'email-template',
        targetId: req.params.name,
        details: {},
      });

      res.json({ success: true, message: 'Template reset to default' });
    } catch (error) {
      logger.error('Error resetting email template:', error);
      res.status(500).json({ error: 'Failed to reset template' });
    }
  }
);

/**
 * GET /api/admin/settings/system-info
 * Get system information
 */
router.get('/settings/system-info', authRequired, roleRequired('admin'), (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const uptimeStr = `${hours}h ${minutes}m`;

  res.json({
    version: 'v17.0.0',
    environment: process.env.NODE_ENV || 'production',
    database: 'JSON File Store',
    uptime: uptimeStr,
  });
});

// ---------- Public API Endpoints ----------

/**
 * GET /api/public/features
 * Get feature flags status (public endpoint, no auth required)
 * Returns which features are enabled/disabled for frontend UI
 */
router.get('/public/features', async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {};

    res.json({
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
      reviews: features.reviews !== false,
      photoUploads: features.photoUploads !== false,
      supportTickets: features.supportTickets !== false,
      pexelsCollage: features.pexelsCollage === true,
    });
  } catch (error) {
    logger.error('Error reading feature flags:', error);
    // Return all features enabled as fallback
    res.json({
      registration: true,
      supplierApplications: true,
      reviews: true,
      photoUploads: true,
      supportTickets: true,
      pexelsCollage: false,
    });
  }
});

// ---------- Tickets Management ----------

const ADMIN_TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const ADMIN_TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/**
 * GET /api/admin/tickets
 * List all support tickets
 */
router.get('/tickets', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );

    // Queue-oriented sort: surface unresolved, urgent/high-priority, and unassigned
    // tickets first so admins can triage the most critical work immediately.
    const ACTIVE_STATUSES = new Set(['open', 'in_progress']);
    tickets.sort((a, b) => {
      // 1. Active tickets before resolved/closed
      const aActive = ACTIVE_STATUSES.has(a.status) ? 1 : 0;
      const bActive = ACTIVE_STATUSES.has(b.status) ? 1 : 0;
      if (bActive !== aActive) {
        return bActive - aActive;
      }

      // 2. Higher priority first (urgent > high > medium > low)
      const aPriority = PRIORITY_RANK[a.priority] || 2;
      const bPriority = PRIORITY_RANK[b.priority] || 2;
      if (bPriority !== aPriority) {
        return bPriority - aPriority;
      }

      // 3. Unassigned before assigned (unassigned needs attention sooner)
      const aUnassigned = a.assignedTo ? 0 : 1;
      const bUnassigned = b.assignedTo ? 0 : 1;
      if (bUnassigned !== aUnassigned) {
        return bUnassigned - aUnassigned;
      }

      // 4. Oldest first within the same bucket (FIFO within priority)
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return aTime - bTime;
    });

    res.json({ items: tickets });
  } catch (error) {
    logger.error('Error loading admin tickets:', error);
    res.status(500).json({ error: 'Failed to load tickets' });
  }
});

/**
 * GET /api/admin/tickets/:id
 * Get single ticket details
 */
router.get('/tickets/:id', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const tickets = (await dbUnified.read('tickets')).map(ticket =>
      normalizeTicketRecord(ticket, { generateId: uid })
    );
    const ticket = tickets.find(t => t.id === req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json({ ticket });
  } catch (error) {
    logger.error('Error loading admin ticket:', error);
    res.status(500).json({ error: 'Failed to load ticket' });
  }
});

/**
 * PUT /api/admin/tickets/:id
 * Update ticket (status, priority, assigned)
 */
router.put(
  '/tickets/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const tickets = (await dbUnified.read('tickets')).map(ticket =>
        normalizeTicketRecord(ticket, { generateId: uid })
      );
      const index = tickets.findIndex(t => t.id === req.params.id);

      if (index < 0) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const { status, priority, assignedTo } = req.body;
      const ticket = tickets[index];

      if (status) {
        if (!ADMIN_TICKET_STATUSES.includes(status)) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        ticket.status = status;
      }
      if (priority) {
        if (!ADMIN_TICKET_PRIORITIES.includes(priority)) {
          return res.status(400).json({ error: 'Invalid priority' });
        }
        ticket.priority = priority;
        ticket.prioritySource = 'admin';
      }
      if (assignedTo !== undefined) {
        ticket.assignedTo = assignedTo || null;
      }

      ticket.updatedAt = new Date().toISOString();
      ticket.updatedBy = req.user.id;

      tickets[index] = ticket;
      await dbUnified.updateOne(
        'tickets',
        { id: ticket.id },
        {
          $set: {
            status: ticket.status,
            priority: ticket.priority,
            prioritySource: ticket.prioritySource,
            assignedTo: ticket.assignedTo,
            updatedAt: ticket.updatedAt,
            updatedBy: ticket.updatedBy,
          },
        }
      );

      res.json({ ticket });
    } catch (error) {
      logger.error('Error updating admin ticket:', error);
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  }
);

/**
 * POST /api/admin/tickets/:id/reply
 * Add a reply to a ticket and notify the ticket creator by email.
 */
router.post(
  '/tickets/:id/reply',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const tickets = (await dbUnified.read('tickets')).map(ticket =>
        normalizeTicketRecord(ticket, { generateId: uid })
      );
      const index = tickets.findIndex(t => t.id === req.params.id);

      if (index < 0) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const ticket = tickets[index];
      const now = new Date().toISOString();
      const reply = {
        id: uid('reply'),
        userId: req.user.id,
        userName: req.user.name || req.user.email,
        userRole: 'admin',
        message,
        createdAt: now,
      };

      ticket.responses = Array.isArray(ticket.responses)
        ? ticket.responses
        : Array.isArray(ticket.replies)
          ? ticket.replies
          : [];
      ticket.responses.push(reply);
      ticket.updatedAt = now;
      ticket.lastReplyAt = now;
      ticket.lastReplyBy = 'admin';
      if (ticket.status === 'open') {
        ticket.status = 'in_progress';
      }

      delete ticket.replies;
      await dbUnified.updateOne(
        'tickets',
        { id: ticket.id },
        {
          $set: {
            responses: ticket.responses,
            updatedAt: ticket.updatedAt,
            status: ticket.status,
            lastReplyAt: ticket.lastReplyAt,
            lastReplyBy: ticket.lastReplyBy,
          },
          $unset: { replies: '' },
        }
      );

      // Notify the ticket creator by email (best-effort, non-blocking)
      if (ticket.senderEmail) {
        const baseUrl =
          process.env.BASE_URL || process.env.APP_BASE_URL || 'https://event-flow.co.uk';
        const ticketUrl = `${baseUrl}/support`;
        const senderName = ticket.senderName || 'there';
        const subjectText = ticket.subject || 'your support ticket';

        // Escape user-supplied values before embedding in HTML to prevent XSS
        const escapeHtml = str =>
          String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const safeSenderName = escapeHtml(senderName);
        const safeSubjectText = escapeHtml(subjectText);
        const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

        try {
          await postmark.sendMail({
            to: ticket.senderEmail,
            from: process.env.POSTMARK_FROM_SUPPORT || process.env.POSTMARK_FROM,
            subject: `Re: ${subjectText}`,
            text: [
              `Hi ${senderName},`,
              '',
              `You have received a reply to your support ticket: "${subjectText}"`,
              '',
              `Reply from support team:`,
              message,
              '',
              `To view and respond to your ticket, please visit:`,
              ticketUrl,
              '',
              '— The EventFlow Support Team',
            ].join('\n'),
            html: `
              <p>Hi ${safeSenderName},</p>
              <p>You have received a reply to your support ticket: <strong>${safeSubjectText}</strong></p>
              <blockquote style="border-left:3px solid #0B8073;padding:0.5rem 1rem;margin:1rem 0;background:#f0fdfa;border-radius:4px;">
                ${safeMessage}
              </blockquote>
              <p><a href="${ticketUrl}" style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,#0B8073,#13B6A2);color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">View your ticket</a></p>
              <p style="color:#6b7280;font-size:0.875rem;">— The EventFlow Support Team</p>
            `,
            messageStream: 'outbound',
          });
          logger.info(
            `📧 Admin reply notification sent to ${ticket.senderEmail} for ticket ${ticket.id}`
          );
        } catch (emailError) {
          // Non-fatal — log but do not fail the API response
          logger.error(
            `Failed to send admin reply notification email for ticket ${ticket.id}:`,
            emailError
          );
        }
      }

      // Audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'TICKET_REPLIED',
        targetType: 'ticket',
        targetId: ticket.id,
        details: { subject: ticket.subject, replyBy: 'admin', notified: !!ticket.senderEmail },
      });

      res.json({ ticket, reply });
    } catch (error) {
      logger.error('Error replying to admin ticket:', error);
      res.status(500).json({ error: 'Failed to reply to ticket' });
    }
  }
);

// ---------- Contact Enquiries (External / Contact Form) ----------

const CONTACT_ENQUIRY_STATUSES = ['new', 'in_progress', 'resolved', 'closed'];

/**
 * GET /api/admin/contact-enquiries
 * List all contact form enquiries from external visitors
 */
router.get('/contact-enquiries', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const enquiries = await dbUnified.read('contact_enquiries');
    // Sort: newest first
    enquiries.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    res.json({ items: enquiries });
  } catch (error) {
    logger.error('Error loading contact enquiries:', error);
    res.status(500).json({ error: 'Failed to load contact enquiries' });
  }
});

/**
 * PUT /api/admin/contact-enquiries/:id
 * Update enquiry status or assignment
 */
router.put(
  '/contact-enquiries/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const enquiries = await dbUnified.read('contact_enquiries');
      const index = enquiries.findIndex(e => e.id === req.params.id);
      if (index < 0) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }

      const { status, assignedTo } = req.body;
      const enquiry = enquiries[index];

      if (status) {
        if (!CONTACT_ENQUIRY_STATUSES.includes(status)) {
          return res.status(400).json({ error: 'Invalid status' });
        }
        enquiry.status = status;
      }
      if (assignedTo !== undefined) {
        enquiry.assignedTo = assignedTo || null;
      }

      enquiry.updatedAt = new Date().toISOString();
      enquiry.updatedBy = req.user.id;

      await dbUnified.updateOne(
        'contact_enquiries',
        { id: enquiry.id },
        {
          $set: {
            status: enquiry.status,
            assignedTo: enquiry.assignedTo,
            updatedAt: enquiry.updatedAt,
            updatedBy: enquiry.updatedBy,
          },
        }
      );

      res.json({ enquiry });
    } catch (error) {
      logger.error('Error updating contact enquiry:', error);
      res.status(500).json({ error: 'Failed to update contact enquiry' });
    }
  }
);

/**
 * POST /api/admin/contact-enquiries/:id/reply
 * Reply to a contact form enquiry — sends email to the original sender via Postmark
 */
router.post(
  '/contact-enquiries/:id/reply',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const enquiries = await dbUnified.read('contact_enquiries');
      const index = enquiries.findIndex(e => e.id === req.params.id);
      if (index < 0) {
        return res.status(404).json({ error: 'Enquiry not found' });
      }

      const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const enquiry = enquiries[index];
      const now = new Date().toISOString();

      const reply = {
        id: uid('reply'),
        userId: req.user.id,
        userName: req.user.name || req.user.email,
        userRole: 'admin',
        message,
        createdAt: now,
      };

      if (!Array.isArray(enquiry.responses)) {
        enquiry.responses = [];
      }
      enquiry.responses.push(reply);
      enquiry.updatedAt = now;
      enquiry.lastReplyAt = now;
      if (enquiry.status === 'new') {
        enquiry.status = 'in_progress';
      }

      await dbUnified.updateOne(
        'contact_enquiries',
        { id: enquiry.id },
        {
          $set: {
            responses: enquiry.responses,
            updatedAt: enquiry.updatedAt,
            lastReplyAt: enquiry.lastReplyAt,
            status: enquiry.status,
          },
        }
      );

      // Email the original sender via Postmark (best-effort, non-blocking)
      if (enquiry.senderEmail) {
        const baseUrl =
          process.env.BASE_URL || process.env.APP_BASE_URL || 'https://event-flow.co.uk';
        const senderName = enquiry.senderName || 'there';
        const subjectText = enquiry.subject || 'your enquiry';

        // XSS-escape user content before embedding in HTML
        const escapeHtml = str =>
          String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        const safeName = escapeHtml(senderName);
        const safeSubject = escapeHtml(subjectText);
        const safeMessage = escapeHtml(message).replace(/\n/g, '<br>');

        try {
          await postmark.sendMail({
            to: enquiry.senderEmail,
            from: POSTMARK_FROM_SUPPORT_ADDR,
            subject: `Re: ${subjectText}`,
            text: [
              `Hi ${senderName},`,
              '',
              `Thank you for contacting EventFlow. We have a reply to your enquiry: "${subjectText}"`,
              '',
              message,
              '',
              'If you have any further questions, please visit our contact page:',
              `${baseUrl}/contact`,
              '',
              '— The EventFlow Team',
            ].join('\n'),
            html: `
              <p>Hi ${safeName},</p>
              <p>Thank you for contacting EventFlow. We have a reply to your enquiry: <strong>${safeSubject}</strong></p>
              <blockquote style="border-left:3px solid #0B8073;padding:0.5rem 1rem;margin:1rem 0;background:#f0fdfa;border-radius:4px;">
                ${safeMessage}
              </blockquote>
              <p>If you have further questions, feel free to <a href="${baseUrl}/contact">contact us again</a>.</p>
              <p style="color:#6b7280;font-size:0.875rem;">— The EventFlow Team</p>
            `,
            messageStream: 'outbound',
          });
          logger.info(
            `📧 Contact enquiry reply sent to ${enquiry.senderEmail} for enquiry ${enquiry.id}`
          );
        } catch (emailError) {
          logger.error(`Failed to send contact enquiry reply email for ${enquiry.id}:`, emailError);
        }
      }

      // Audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'CONTACT_ENQUIRY_REPLIED',
        targetType: 'contact_enquiry',
        targetId: enquiry.id,
        details: { subject: enquiry.subject, notified: !!enquiry.senderEmail },
      });

      res.json({ enquiry, reply });
    } catch (error) {
      logger.error('Error replying to contact enquiry:', error);
      res.status(500).json({ error: 'Failed to reply to contact enquiry' });
    }
  }
);

// ---------- Payments ----------

/**
 * GET /api/admin/payments
 * List all payments for admin analytics
 */
router.get('/payments', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const payments = await dbUnified.read('payments');
    // Sort by createdAt descending (newest first)
    payments.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });
    res.json({ items: payments });
  } catch (error) {
    logger.error('Error reading payments:', error);
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

/**
 * GET /api/admin/stripe-analytics
 * Get live Stripe analytics data for admin dashboard
 */
router.get('/stripe-analytics', authRequired, roleRequired('admin'), async (_req, res) => {
  if (!STRIPE_ENABLED || !stripe) {
    return res.json({
      error: 'Stripe not configured',
      available: false,
      message: 'Stripe analytics are not available. Using local payment data instead.',
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

    // Fetch data from Stripe
    const [charges, subscriptions, customers, balance] = await Promise.all([
      stripe.charges.list({
        limit: 100,
        created: { gte: thirtyDaysAgo },
      }),
      stripe.subscriptions.list({
        limit: 100,
        status: 'active',
      }),
      stripe.customers.list({
        limit: 100,
        created: { gte: thirtyDaysAgo },
      }),
      stripe.balance.retrieve(),
    ]);

    // Calculate analytics
    const totalRevenue = charges.data.reduce((sum, charge) => {
      return sum + (charge.amount_captured || 0);
    }, 0);

    const monthRevenue = charges.data
      .filter(charge => charge.created >= thirtyDaysAgo)
      .reduce((sum, charge) => {
        return sum + (charge.amount_captured || 0);
      }, 0);

    const analytics = {
      available: true,
      totalRevenue: totalRevenue / 100, // Convert from pence to pounds
      monthRevenue: monthRevenue / 100,
      activeSubscriptions: subscriptions.data.length,
      totalCharges: charges.data.length,
      newCustomers: customers.data.length,
      availableBalance:
        balance.available && balance.available.length > 0 ? balance.available[0].amount / 100 : 0,
      pendingBalance:
        balance.pending && balance.pending.length > 0 ? balance.pending[0].amount / 100 : 0,
      currency:
        balance.available && balance.available.length > 0 ? balance.available[0].currency : 'gbp',
      recentCharges: charges.data.slice(0, 10).map(charge => ({
        id: charge.id,
        amount: charge.amount / 100,
        currency: charge.currency,
        status: charge.status,
        created: charge.created,
        description: charge.description,
        customer: charge.customer,
      })),
      subscriptionBreakdown: {
        active: subscriptions.data.filter(s => s.status === 'active').length,
        trialing: subscriptions.data.filter(s => s.status === 'trialing').length,
        past_due: subscriptions.data.filter(s => s.status === 'past_due').length,
      },
    };

    res.json(analytics);
  } catch (error) {
    logger.error('Error fetching Stripe analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch Stripe analytics',
      available: false,
      message: error.message,
    });
  }
});

/**

// ---------- Audit Logs ----------

/**
 * GET /api/admin/audit-logs
 * Get audit logs with optional filtering (canonical endpoint)
 */
router.get('/audit-logs', authRequired, roleRequired('admin'), async (req, res) => {
  const { adminId, adminEmail, action, targetType, targetId, startDate, endDate, limit } =
    req.query;

  const filters = {};
  if (adminId) {
    filters.adminId = adminId;
  }
  if (adminEmail) {
    filters.adminEmail = adminEmail;
  }
  if (action) {
    filters.action = action;
  }
  if (targetType) {
    filters.targetType = targetType;
  }
  if (targetId) {
    filters.targetId = targetId;
  }
  if (startDate) {
    filters.startDate = startDate;
  }
  if (endDate) {
    filters.endDate = endDate;
  }
  if (limit) {
    filters.limit = parseInt(limit, 10);
  }

  const { getAuditLogs } = require('../middleware/audit');
  const logs = await getAuditLogs(filters);

  res.json({ logs, count: logs.length });
});

/**
 * GET /api/admin/audit
 * Get audit logs with optional filtering
 * Backwards compatible endpoint - returns same format as /api/admin/audit-logs
 */
router.get('/audit', authRequired, roleRequired('admin'), async (req, res) => {
  const { adminId, adminEmail, action, targetType, targetId, startDate, endDate, limit } =
    req.query;

  const filters = {};
  if (adminId) {
    filters.adminId = adminId;
  }
  if (adminEmail) {
    filters.adminEmail = adminEmail;
  }
  if (action) {
    filters.action = action;
  }
  if (targetType) {
    filters.targetType = targetType;
  }
  if (targetId) {
    filters.targetId = targetId;
  }
  if (startDate) {
    filters.startDate = startDate;
  }
  if (endDate) {
    filters.endDate = endDate;
  }
  if (limit) {
    filters.limit = parseInt(limit, 10);
  }

  const { getAuditLogs } = require('../middleware/audit');
  const logs = await getAuditLogs(filters);

  // Use standardized response format
  res.json({ logs, count: logs.length });
});

// ---------- Marketplace Admin ----------

/**
 * GET /api/admin/marketplace/listings
 * Get all marketplace listings (including pending) for admin moderation
 */
router.get('/marketplace/listings', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const listings = await dbUnified.read('marketplace_listings');
    const users = await dbUnified.read('users');

    // Enrich listings with user info
    const enrichedListings = listings.map(listing => {
      const user = users.find(u => u.id === listing.userId);
      return {
        ...listing,
        userEmail: user ? user.email : 'Unknown',
        userName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown',
      };
    });

    res.json({ listings: enrichedListings });
  } catch (error) {
    logger.error('Error fetching admin marketplace listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

/**
 * POST /api/admin/marketplace/listings/:id/approve
 * Approve or reject a marketplace listing
 */
router.post(
  '/marketplace/listings/:id/approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { approved } = req.body || {};
      const listings = await dbUnified.read('marketplace_listings');
      const listing = listings.find(l => l.id === req.params.id);

      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }

      listing.approved = !!approved;
      listing.status = approved ? 'active' : 'pending';
      listing.updatedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'marketplace_listings',
        { id: listing.id },
        {
          $set: {
            approved: listing.approved,
            status: listing.status,
            updatedAt: listing.updatedAt,
          },
        }
      );

      // Log audit using auditLog function
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: approved ? 'marketplace_listing_approved' : 'marketplace_listing_rejected',
        targetType: 'marketplace_listing',
        targetId: listing.id,
        details: { listingTitle: listing.title, approved },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({ ok: true, listing });
    } catch (error) {
      logger.error('Error approving marketplace listing:', error);
      res.status(500).json({ error: 'Failed to approve listing' });
    }
  }
);

/**
 * DELETE /api/admin/marketplace/listings/:id
 * Admin delete marketplace listing with image cleanup
 */
router.delete(
  '/marketplace/listings/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const listings = await dbUnified.read('marketplace_listings');
      const listing = listings.find(l => l.id === req.params.id);

      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }

      // Delete associated marketplace images from database
      const deletedImageCount = await photoUpload.deleteMarketplaceImages(req.params.id);

      // Remove listing
      await dbUnified.deleteOne('marketplace_listings', req.params.id);

      // Log audit
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'marketplace_listing_deleted',
        targetType: 'marketplace_listing',
        targetId: listing.id,
        details: {
          listingTitle: listing.title,
          deletedImageCount,
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({ ok: true, deletedImageCount });
    } catch (error) {
      logger.error('Error deleting marketplace listing:', error);
      res.status(500).json({ error: 'Failed to delete listing' });
    }
  }
);

// ============================================
// COLLAGE WIDGET ENDPOINTS
// ============================================

/**
 * Configure multer for local collage media storage
 * Stores files in /public/uploads/homepage-collage/
 */
const collageUploadDir = path.join(__dirname, '../public/uploads/homepage-collage');

// Ensure upload directory exists
if (!fs.existsSync(collageUploadDir)) {
  fs.mkdirSync(collageUploadDir, { recursive: true });
}

const collageUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, collageUploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `collage-${uniqueSuffix}${ext}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for videos
  },
  fileFilter: function (req, file, cb) {
    // Allow images and videos
    const allowedTypes = /^(image|video)\//;
    if (!allowedTypes.test(file.mimetype)) {
      cb(new Error('Only image and video files are allowed'));
      return;
    }
    cb(null, true);
  },
});

/**
 * GET /api/admin/homepage/collage-widget
 * Get collage widget configuration
 */
router.get('/homepage/collage-widget', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const collageWidget = settings.collageWidget || {
      enabled: false,
      source: 'pexels',
      mediaTypes: { photos: true, videos: true },
      intervalSeconds: 2.5,
      pexelsQueries: {
        venues: 'wedding venue elegant ballroom',
        catering: 'wedding catering food elegant',
        entertainment: 'live band wedding party',
        photography: 'wedding photography professional',
      },
      pexelsVideoQueries: {
        venues: 'wedding venue video aerial',
        catering: 'catering food preparation video',
        entertainment: 'live band music performance video',
        photography: 'wedding videography cinematic',
      },
      uploadGallery: [],
      fallbackToPexels: true,
      heroVideo: {
        enabled: true,
        autoplay: false,
        muted: true,
        loop: true,
        quality: 'hd',
      },
      videoQuality: {
        preference: 'hd',
        adaptive: true,
        mobileOptimized: true,
      },
      transition: {
        effect: 'fade',
        duration: 1000,
      },
      preloading: {
        enabled: true,
        count: 3,
      },
      mobileOptimizations: {
        slowerTransitions: true,
        disableVideos: false,
        touchControls: true,
      },
      contentFiltering: {
        aspectRatio: 'any',
        orientation: 'any',
        minResolution: 'SD',
      },
      playbackControls: {
        showControls: false,
        pauseOnHover: true,
        fullscreen: false,
      },
    };

    res.json(collageWidget);
  } catch (error) {
    logger.error('Error reading collage widget config:', error);
    res.status(500).json({ error: 'Failed to read collage widget configuration' });
  }
});

/**
 * PUT /api/admin/homepage/collage-widget
 * Update collage widget configuration
 */
router.put(
  '/homepage/collage-widget',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const {
        enabled,
        source,
        mediaTypes,
        intervalSeconds,
        pexelsQueries,
        pexelsVideoQueries,
        uploadGallery,
        fallbackToPexels,
        heroVideo,
        videoQuality,
        transition,
        preloading,
        mobileOptimizations,
        contentFiltering,
        playbackControls,
      } = req.body;

      // Validation
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }

      if (source && !['pexels', 'uploads'].includes(source)) {
        return res.status(400).json({ error: 'source must be "pexels" or "uploads"' });
      }

      if (intervalSeconds !== undefined) {
        const interval = Number(intervalSeconds);
        if (isNaN(interval) || interval < 1 || interval > 60) {
          return res.status(400).json({ error: 'intervalSeconds must be between 1 and 60' });
        }
      }

      if (
        transition?.effect &&
        !['fade', 'slide', 'zoom', 'crossfade'].includes(transition.effect)
      ) {
        return res.status(400).json({ error: 'Invalid transition effect' });
      }

      if (preloading?.count !== undefined) {
        const count = Number(preloading.count);
        if (isNaN(count) || count < 0 || count > 5) {
          return res.status(400).json({ error: 'Preloading count must be between 0 and 5' });
        }
      }

      if (videoQuality?.preference && !['hd', 'sd', 'auto'].includes(videoQuality.preference)) {
        return res.status(400).json({ error: 'Invalid video quality preference' });
      }

      // Validate uploadGallery structure if provided
      if (uploadGallery !== undefined) {
        if (!Array.isArray(uploadGallery)) {
          return res.status(400).json({ error: 'uploadGallery must be an array' });
        }
        // Validate all items are non-empty strings
        const invalidItems = uploadGallery.filter(item => typeof item !== 'string' || !item.trim());
        if (invalidItems.length > 0) {
          return res
            .status(400)
            .json({ error: 'All uploadGallery items must be non-empty strings' });
        }
      }

      // Mutual exclusivity check - only validate if source is uploads AND enabled is true
      if (enabled && source === 'uploads' && (!uploadGallery || uploadGallery.length === 0)) {
        return res.status(400).json({
          error: 'Upload gallery cannot be empty when source is "uploads" and widget is enabled',
        });
      }

      const settings = (await dbUnified.read('settings')) || {};
      if (!settings.collageWidget) {
        settings.collageWidget = {};
      }

      // Update only provided fields
      if (enabled !== undefined) {
        settings.collageWidget.enabled = enabled;
      }
      if (source) {
        settings.collageWidget.source = source;
      }
      if (mediaTypes) {
        settings.collageWidget.mediaTypes = mediaTypes;
      }
      if (intervalSeconds !== undefined) {
        settings.collageWidget.intervalSeconds = intervalSeconds;
      }
      if (pexelsQueries) {
        settings.collageWidget.pexelsQueries = pexelsQueries;
      }
      if (pexelsVideoQueries) {
        settings.collageWidget.pexelsVideoQueries = pexelsVideoQueries;
      }
      if (uploadGallery) {
        settings.collageWidget.uploadGallery = uploadGallery;
      }
      if (fallbackToPexels !== undefined) {
        settings.collageWidget.fallbackToPexels = fallbackToPexels;
      }
      if (heroVideo !== undefined) {
        settings.collageWidget.heroVideo = { ...settings.collageWidget.heroVideo, ...heroVideo };
      }
      if (videoQuality !== undefined) {
        settings.collageWidget.videoQuality = {
          ...settings.collageWidget.videoQuality,
          ...videoQuality,
        };
      }
      if (transition !== undefined) {
        settings.collageWidget.transition = { ...settings.collageWidget.transition, ...transition };
      }
      if (preloading !== undefined) {
        settings.collageWidget.preloading = { ...settings.collageWidget.preloading, ...preloading };
      }
      if (mobileOptimizations !== undefined) {
        settings.collageWidget.mobileOptimizations = {
          ...settings.collageWidget.mobileOptimizations,
          ...mobileOptimizations,
        };
      }
      if (contentFiltering !== undefined) {
        settings.collageWidget.contentFiltering = {
          ...settings.collageWidget.contentFiltering,
          ...contentFiltering,
        };
      }
      if (playbackControls !== undefined) {
        settings.collageWidget.playbackControls = {
          ...settings.collageWidget.playbackControls,
          ...playbackControls,
        };
      }

      settings.collageWidget.updatedAt = new Date().toISOString();
      settings.collageWidget.updatedBy = req.user.email;

      // Write and verify to ensure persistence
      const result = await dbUnified.writeAndVerify('settings', settings);

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'COLLAGE_WIDGET_UPDATED',
        targetType: 'homepage',
        targetId: 'collage-widget',
        details: { enabled, source, mediaTypes },
      });

      // Return verified data from database, not in-memory object
      res.json({
        success: true,
        collageWidget: result.data.collageWidget,
      });
    } catch (error) {
      logger.error('Error updating collage widget config:', error);
      res.status(500).json({ error: 'Failed to update collage widget configuration' });
    }
  }
);

/**
 * GET /api/admin/homepage/collage-media
 * List all uploaded collage media files
 */
router.get('/homepage/collage-media', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    if (!fs.existsSync(collageUploadDir)) {
      return res.json({ media: [] });
    }

    const files = fs.readdirSync(collageUploadDir);
    const media = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov'].includes(ext);
      })
      .map(file => {
        const filePath = path.join(collageUploadDir, file);
        const stats = fs.statSync(filePath);
        const ext = path.extname(file).toLowerCase();
        const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);

        return {
          filename: file,
          url: `/uploads/homepage-collage/${file}`,
          type: isVideo ? 'video' : 'photo',
          size: stats.size,
          uploadedAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ media });
  } catch (error) {
    logger.error('Error listing collage media:', error);
    res.status(500).json({ error: 'Failed to list collage media' });
  }
});

/**
 * POST /api/admin/homepage/collage-media
 * Upload new collage media (photo or video)
 */
router.post(
  '/homepage/collage-media',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  collageUpload.array('media', 10), // Allow up to 10 files at once
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No media files provided' });
      }

      const uploadedMedia = req.files.map(file => {
        const ext = path.extname(file.filename).toLowerCase();
        const isVideo = ['.mp4', '.webm', '.mov'].includes(ext);

        return {
          filename: file.filename,
          url: `/uploads/homepage-collage/${file.filename}`,
          type: isVideo ? 'video' : 'photo',
          size: file.size,
          uploadedAt: new Date().toISOString(),
        };
      });

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'COLLAGE_MEDIA_UPLOADED',
        targetType: 'homepage',
        targetId: 'collage-media',
        details: { count: uploadedMedia.length, files: uploadedMedia.map(m => m.filename) },
      });

      res.json({
        success: true,
        media: uploadedMedia,
      });
    } catch (error) {
      logger.error('Error uploading collage media:', error);
      res.status(500).json({ error: 'Failed to upload collage media' });
    }
  }
);

/**
 * DELETE /api/admin/homepage/collage-media/:filename
 * Delete a collage media file
 */
router.delete(
  '/homepage/collage-media/:filename',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { filename } = req.params;

      // Security: prevent directory traversal
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const filePath = path.join(collageUploadDir, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Use async file deletion
      await fs.promises.unlink(filePath);

      // Update settings to remove from uploadGallery if present
      const settings = (await dbUnified.read('settings')) || {};
      if (settings.collageWidget && settings.collageWidget.uploadGallery) {
        const fileUrl = `/uploads/homepage-collage/${filename}`;
        // Filter by comparing URLs without query parameters to handle cache busting
        settings.collageWidget.uploadGallery = settings.collageWidget.uploadGallery.filter(url => {
          const urlWithoutParams = url.split('?')[0];
          return urlWithoutParams !== fileUrl;
        });
        settings.collageWidget.updatedAt = new Date().toISOString();
        settings.collageWidget.updatedBy = req.user.email;
        await dbUnified.writeAndVerify('settings', settings);
      }

      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'COLLAGE_MEDIA_DELETED',
        targetType: 'homepage',
        targetId: 'collage-media',
        details: { filename },
      });

      res.json({
        success: true,
        message: 'Media file deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting collage media:', error);
      res.status(500).json({ error: 'Failed to delete collage media' });
    }
  }
);

/**

/**
 * GET /api/maintenance/message (PUBLIC - no auth required)
 * Get maintenance mode message for display on maintenance page
 * This is intentionally not under /api/admin to avoid auth requirement
 */
router.get('/maintenance/message', async (req, res) => {
  try {
    const settings = (await dbUnified.read('settings')) || {};
    const maintenance = settings.maintenance || {
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    };

    // Only return the message and enabled status, not admin details
    res.json({
      enabled: maintenance.enabled,
      message: maintenance.message,
    });
  } catch (error) {
    logger.error('Error reading maintenance message:', error);
    // Return default message on error
    res.json({
      enabled: false,
      message: "We're performing scheduled maintenance. We'll be back soon!",
    });
  }
});

/**
 * GET /api/public/pexels-collage
 * Public endpoint to fetch Pexels images for homepage collage
 * Uses Pexels API when configured, falls back to curated fallback URLs when API unavailable
 */
router.get('/public/pexels-collage', async (req, res) => {
  try {
    // Check if Pexels collage is enabled via new collageWidget configuration
    const settings = (await dbUnified.read('settings')) || {};
    const collageWidget = settings.collageWidget || {};

    // Check both new collageWidget format and legacy pexelsCollage feature flag for backward compatibility
    const isEnabled = collageWidget.enabled === true || settings.features?.pexelsCollage === true;
    const source = collageWidget.source || 'pexels';

    // Debug logging to help diagnose configuration issues
    if (isCollageDebugEnabled()) {
      logger.info('[Pexels Collage Endpoint] Configuration check:', {
        isEnabled,
        collageWidgetEnabled: collageWidget.enabled,
        legacyPexelsEnabled: settings.features?.pexelsCollage,
        source,
        category: req.query.category,
        photos: req.query.photos,
        videos: req.query.videos,
      });
    }

    if (!isEnabled) {
      return res.status(404).json({
        error: 'Pexels collage feature is not enabled',
        errorType: 'feature_disabled',
      });
    }

    // If source is not 'pexels' (and not empty/undefined), return an error (uploads source should use upload gallery)
    if (source && source !== 'pexels') {
      return res.status(400).json({
        error: 'This endpoint only supports Pexels source',
        errorType: 'invalid_source',
        message: 'Configure collage widget to use Pexels source or use upload gallery',
      });
    }

    const { category, photos = 'true', videos = 'true' } = req.query;

    if (!category) {
      return res.status(400).json({
        error: 'Category parameter required',
        errorType: 'validation',
      });
    }

    const validCategories = ['venues', 'catering', 'entertainment', 'photography'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${validCategories.join(', ')}`,
        errorType: 'validation',
        validCategories,
      });
    }

    // Use new collageWidget.pexelsQueries, fallback to legacy pexelsCollageSettings for backward compatibility
    const pexelsQueries = collageWidget.pexelsQueries ||
      settings.pexelsCollageSettings?.queries || {
        venues: 'wedding venue elegant ballroom',
        catering: 'wedding catering food elegant',
        entertainment: 'live band wedding party',
        photography: 'wedding photography professional',
      };

    // Get video queries if videos are enabled
    const pexelsVideoQueries = collageWidget.pexelsVideoQueries || {
      venues: 'wedding venue video aerial',
      catering: 'catering food preparation video',
      entertainment: 'live band music performance video',
      photography: 'wedding videography cinematic',
    };

    // Support legacy pexelsCollageSettings for collection IDs if configured
    const pexelsCollageSettings = settings.pexelsCollageSettings || {};

    // Import Pexels service
    const { getPexelsService } = require('../utils/pexels-service');
    const pexels = getPexelsService();

    // Determine if we should fetch photos and/or videos
    const shouldFetchPhotos = photos === 'true';
    const shouldFetchVideos = videos === 'true';

    // Try to use Pexels API first
    if (pexels.isConfigured()) {
      try {
        // Check if collection ID is configured for this category or globally
        const collectionId =
          pexelsCollageSettings.collectionIds?.[category] || pexelsCollageSettings.collectionId;

        if (collectionId) {
          // Use collection-based fetching
          logger.info(`📚 Fetching media from collection ${collectionId} for ${category}`);
          const results = await pexels.getCollectionMedia(collectionId, 8, 1, 'all');

          // Filter based on media type settings
          let media = results.media;
          if (!shouldFetchPhotos) {
            media = media.filter(item => item.type !== 'Photo');
          }
          if (!shouldFetchVideos) {
            media = media.filter(item => item.type !== 'Video');
          }

          if (media.length === 0) {
            logger.warn(`⚠️  No media found in collection ${collectionId}, falling back to search`);
            // Fall through to search-based approach
          } else {
            return res.json({
              success: true,
              category,
              collectionId,
              photos: media.filter(item => item.type === 'Photo'),
              videos: media.filter(item => item.type === 'Video'),
              usingFallback: false,
              source: 'collection',
            });
          }
        }

        // Use query-based searching (default behavior or fallback from empty collection)
        const fetchPromises = [];

        if (shouldFetchPhotos) {
          const photoQuery = pexelsQueries[category] || category;
          logger.info(`🔍 Searching photos with query: "${photoQuery}" for ${category}`);
          fetchPromises.push(
            pexels.searchPhotos(photoQuery, 4, 1).then(results => ({
              type: 'photos',
              items: results.photos,
            }))
          );
        }

        if (shouldFetchVideos) {
          const videoQuery = pexelsVideoQueries[category] || category;
          logger.info(`🎥 Searching videos with query: "${videoQuery}" for ${category}`);
          fetchPromises.push(
            pexels.searchVideos(videoQuery, 4, 1).then(results => ({
              type: 'videos',
              items: results.videos
                .map(video => {
                  // Get the best quality video file (prefer HD, fallback to SD, then any available)
                  const videoFiles = video.videoFiles || [];
                  const hdFile =
                    videoFiles.find(f => f.quality === 'hd') ||
                    videoFiles.find(f => f.quality === 'sd') ||
                    videoFiles[0];

                  // Add validation before using
                  if (!hdFile || !hdFile.link) {
                    if (isCollageDebugEnabled()) {
                      logger.warn(
                        `[Pexels Collage] No valid video file found for video ${video.id}`
                      );
                    }
                    return null; // Filter out invalid videos
                  }

                  return {
                    type: 'video',
                    id: video.id,
                    url: video.url,
                    src: {
                      large: hdFile.link,
                      original: hdFile.link,
                    },
                    thumbnail: video.image,
                    videographer: video.user?.name || 'Pexels',
                    videographer_url: video.user?.url || 'https://www.pexels.com',
                    duration: video.duration,
                    width: video.width,
                    height: video.height,
                  };
                })
                .filter(v => v !== null), // Filter out null values
            }))
          );
        }

        const results = await Promise.all(fetchPromises);

        // Separate photos and videos
        const photosResult = results.find(r => r.type === 'photos');
        const videosResult = results.find(r => r.type === 'videos');

        return res.json({
          success: true,
          category,
          photos: photosResult?.items || [],
          videos: videosResult?.items || [],
          usingFallback: false,
          source: 'search',
        });
      } catch (apiError) {
        logger.warn(
          `⚠️  Pexels API failed for ${category} (${apiError.type || 'unknown'}): ${apiError.message}`
        );
        logger.warn('💡 Falling back to curated URLs');
        // Fall through to fallback logic below
      }
    } else {
      logger.info('ℹ️  Pexels API not configured, using fallback URLs');
    }

    // If API not configured or failed, use fallback URLs from config
    const {
      getRandomFallbackPhotos,
      getRandomFallbackVideos,
    } = require('../config/pexels-fallback');

    let fallbackPhotos = [];
    let fallbackVideos = [];

    if (shouldFetchPhotos) {
      const rawPhotos = getRandomFallbackPhotos(4);
      // Convert fallback photo format to match Pexels API format
      fallbackPhotos = rawPhotos.map(photo => ({
        id: photo.id,
        url: photo.url,
        photographer: photo.photographer,
        photographer_url: photo.photographer_url || 'https://www.pexels.com',
        src: {
          original: photo.src.original,
          large: photo.src.large,
          medium: photo.src.medium,
          small: photo.src.small,
        },
        alt: photo.alt,
      }));
    }

    if (shouldFetchVideos) {
      const rawVideos = getRandomFallbackVideos(4);
      // Convert fallback video format to match expected format
      fallbackVideos = rawVideos.map(video => {
        const videoFile = video.videoFiles?.[0];
        return {
          type: 'video',
          id: video.id,
          url: video.url,
          src: {
            large: videoFile?.link || '',
            original: videoFile?.link || '',
          },
          thumbnail: video.image,
          videographer: 'Pexels',
          videographer_url: 'https://www.pexels.com',
          duration: video.duration,
          width: videoFile?.width || 1920,
          height: videoFile?.height || 1080,
        };
      });
    }

    res.json({
      success: true,
      category,
      photos: fallbackPhotos,
      videos: fallbackVideos,
      usingFallback: true,
      source: 'fallback',
      message: 'Using curated fallback media from Pexels collection',
    });
  } catch (error) {
    logger.error('❌ Error fetching Pexels collage images:', error);
    logger.error('🔖 Error type:', error.type || 'unknown');

    // Return appropriate status code based on error type
    const statusCode = error.statusCode || 500;

    res.status(statusCode).json({
      error: 'Failed to fetch Pexels images',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: error.message,
    });
  }
});

/**
 * GET /api/admin/public/pexels-video
 * Public endpoint to fetch Pexels videos for homepage hero section
 * Uses Pexels API when configured, falls back to curated fallback URLs when API unavailable
 */
router.get('/public/pexels-video', async (req, res) => {
  try {
    // Check if Pexels collage is enabled via collageWidget configuration
    const settings = (await dbUnified.read('settings')) || {};
    const collageWidget = settings.collageWidget || {};

    // Check both new collageWidget format and legacy pexelsCollage feature flag for backward compatibility
    const isEnabled = collageWidget.enabled === true || settings.features?.pexelsCollage === true;
    const source = collageWidget.source || 'pexels';

    // Debug logging
    if (isCollageDebugEnabled()) {
      logger.info('[Pexels Video Endpoint] Configuration check:', {
        isEnabled,
        collageWidgetEnabled: collageWidget.enabled,
        legacyPexelsEnabled: settings.features?.pexelsCollage,
        source,
        query: req.query.query,
        mediaTypesVideos: collageWidget.mediaTypes?.videos,
      });
    }

    if (!isEnabled) {
      return res.status(404).json({
        error: 'Pexels collage feature is not enabled',
        errorType: 'feature_disabled',
      });
    }

    // Check if videos are enabled in mediaTypes - default to true if not explicitly disabled
    const videosEnabled = collageWidget.mediaTypes?.videos !== false;
    if (!videosEnabled) {
      return res.status(400).json({
        error: 'Videos are not enabled in collage widget settings',
        errorType: 'videos_disabled',
      });
    }

    // If source is not 'pexels', return an error
    if (source && source !== 'pexels') {
      return res.status(400).json({
        error: 'This endpoint only supports Pexels source',
        errorType: 'invalid_source',
        message: 'Configure collage widget to use Pexels source',
      });
    }

    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter required',
        errorType: 'validation',
      });
    }

    // Import Pexels service
    const { getPexelsService } = require('../utils/pexels-service');
    const pexels = getPexelsService();

    // Try to use Pexels API first
    if (pexels.isConfigured()) {
      try {
        if (isCollageDebugEnabled()) {
          logger.info(`🎥 Searching videos with query: "${query}"`);
        }

        const results = await pexels.searchVideos(query, 5, 1);

        if (results.videos && results.videos.length > 0) {
          // Transform to expected frontend format
          const videos = results.videos.map(video => ({
            id: video.id,
            url: video.url,
            image: video.image,
            duration: video.duration,
            user: {
              name: video.user?.name || 'Pexels',
              url: video.user?.url || 'https://www.pexels.com',
            },
            video_files: (video.videoFiles || []).map(file => ({
              id: file.id,
              quality: file.quality,
              file_type: file.fileType,
              width: file.width,
              height: file.height,
              link: file.link,
            })),
          }));

          return res.json({
            success: true,
            videos,
            query,
            usingFallback: false,
            source: 'pexels-api',
          });
        }

        // If no videos found, fall through to fallback
        logger.warn(`⚠️  No videos found for query "${query}", using fallback`);
      } catch (apiError) {
        logger.warn(
          `⚠️  Pexels API failed for video query "${query}" (${apiError.type || 'unknown'}): ${apiError.message}`
        );
        logger.warn('💡 Falling back to curated video URLs');
        // Fall through to fallback logic below
      }
    } else {
      logger.info('ℹ️  Pexels API not configured, using fallback video URLs');
    }

    // If API not configured or failed, use fallback URLs from config
    const { getRandomFallbackVideos } = require('../config/pexels-fallback');

    const fallbackVideos = getRandomFallbackVideos(5);

    // Transform fallback videos to match expected frontend format
    const videos = fallbackVideos.map(video => {
      const videoFile = video.videoFiles?.[0];
      return {
        id: video.id,
        url: video.url,
        image: video.image,
        duration: video.duration,
        user: {
          name: 'Pexels',
          url: 'https://www.pexels.com',
        },
        video_files: [
          {
            quality: videoFile?.quality || 'hd',
            file_type: 'video/mp4',
            width: videoFile?.width || 1920,
            height: videoFile?.height || 1080,
            link: videoFile?.link || '',
          },
        ],
      };
    });

    res.json({
      success: true,
      videos,
      query,
      usingFallback: true,
      source: 'fallback',
      message: 'Using curated fallback videos from Pexels collection',
    });
  } catch (error) {
    logger.error('❌ Error fetching Pexels videos:', error);
    logger.error('🔖 Error type:', error.type || 'unknown');

    // Return appropriate status code based on error type
    const statusCode = error.statusCode || 500;

    res.status(statusCode).json({
      error: 'Failed to fetch Pexels videos',
      message: error.userFriendlyMessage || error.message,
      errorType: error.type || 'unknown',
      details: error.message,
    });
  }
});

/**
 * PUT /api/admin/content-config
 * Update content configuration (legal dates, company info)
 */
router.put(
  '/content-config',
  csrfProtection,
  authRequired,
  roleRequired('admin'),
  async (req, res) => {
    try {
      const { legalLastUpdated, legalEffectiveDate } = req.body;

      // Validation
      if (!legalLastUpdated || !legalEffectiveDate) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Both legalLastUpdated and legalEffectiveDate are required',
        });
      }

      // Validate date format (Month YYYY)
      const validMonths = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const datePattern = /^([A-Za-z]+)\s+(\d{4})$/;

      const validateDate = (dateStr, fieldName) => {
        const match = dateStr.match(datePattern);
        if (!match) {
          throw new Error(`${fieldName} must be in format "Month YYYY" (e.g., "January 2026")`);
        }
        const [, month, year] = match;
        if (!validMonths.includes(month)) {
          throw new Error(
            `${fieldName} has invalid month "${month}". Use full month name (e.g., "January")`
          );
        }
        const yearNum = parseInt(year, 10);
        if (yearNum < 2020 || yearNum > 2100) {
          throw new Error(
            `${fieldName} has unrealistic year "${year}". Use year between 2020-2100`
          );
        }
      };

      try {
        validateDate(legalLastUpdated, 'legalLastUpdated');
        validateDate(legalEffectiveDate, 'legalEffectiveDate');
      } catch (err) {
        return res.status(400).json({
          error: 'Invalid date format',
          message: err.message,
        });
      }

      // Read the content-config.js file asynchronously
      const fs = require('fs').promises;
      const path = require('path');
      const configPath = path.join(__dirname, '..', 'config', 'content-config.js');

      let configContent = await fs.readFile(configPath, 'utf8');

      // Sanitize inputs by escaping quotes
      const sanitize = str => str.replace(/'/g, "\\'");
      const sanitizedLastUpdated = sanitize(legalLastUpdated);
      const sanitizedEffectiveDate = sanitize(legalEffectiveDate);

      // Update the dates using regex
      configContent = configContent.replace(
        /legalLastUpdated:\s*['"].*?['"]/,
        `legalLastUpdated: '${sanitizedLastUpdated}'`
      );
      configContent = configContent.replace(
        /legalEffectiveDate:\s*['"].*?['"]/,
        `legalEffectiveDate: '${sanitizedEffectiveDate}'`
      );

      // Write the file back asynchronously
      await fs.writeFile(configPath, configContent, 'utf8');

      // Clear the require cache for the config module
      const configModulePath = require.resolve('../config/content-config');
      delete require.cache[configModulePath];

      // Clear the template cache - this is critical for changes to take effect
      try {
        const { clearCache } = require('../utils/template-renderer');
        clearCache();
        logger.info('✅ Template cache cleared successfully');
      } catch (err) {
        logger.error('❌ Failed to clear template cache:', err);
        // Return error since cache clearing is critical
        return res.status(500).json({
          error: 'Configuration updated but cache clearing failed',
          message: 'Changes may not be visible until server restart. Please contact administrator.',
          details: err.message,
        });
      }

      // Audit log
      await auditLog(req, AUDIT_ACTIONS.SETTINGS_UPDATE, {
        category: 'content-config',
        legalLastUpdated,
        legalEffectiveDate,
      });

      res.json({
        success: true,
        message: 'Content configuration updated successfully',
        note: 'Changes take effect immediately for new page requests',
        legalLastUpdated,
        legalEffectiveDate,
      });
    } catch (error) {
      logger.error('Error updating content config:', error);
      res.status(500).json({
        error: 'Failed to update content configuration',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/audit/export
 * Export audit logs with optional filtering
 * Query params: format (csv|json), startDate, endDate
 */
router.get('/audit/export', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const { format = 'json', startDate, endDate } = req.query;

    if (!['csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use csv or json' });
    }

    let logs = await dbUnified.read('audit_logs');

    // Apply date filters if provided
    if (startDate || endDate) {
      logs = logs.filter(log => {
        const logDate = new Date(log.timestamp || log.createdAt);
        if (startDate && logDate < new Date(startDate)) {
          return false;
        }
        if (endDate && logDate > new Date(endDate)) {
          return false;
        }
        return true;
      });
    }

    // Sort by timestamp descending
    logs.sort((a, b) => {
      const dateA = new Date(a.timestamp || a.createdAt);
      const dateB = new Date(b.timestamp || b.createdAt);
      return dateB - dateA;
    });

    // Audit the export action
    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'AUDIT_LOG_EXPORT',
      targetType: 'audit_log',
      targetId: 'export',
      details: { format, startDate, endDate, count: logs.length },
    });

    if (format === 'csv') {
      // Generate CSV
      const headers = [
        'Timestamp',
        'Admin Email',
        'Action',
        'Target Type',
        'Target ID',
        'Details',
        'IP Address',
      ];
      const rows = logs.map(log => [
        log.timestamp || log.createdAt,
        log.adminEmail || '',
        log.action || '',
        log.targetType || '',
        log.targetId || '',
        JSON.stringify(log.details || {}),
        log.ipAddress || '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
      res.send(csvContent);
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.json"`);
      res.json({ logs, count: logs.length, exportedAt: new Date().toISOString() });
    }
  } catch (error) {
    logger.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Failed to export audit logs', details: error.message });
  }
});

/**
 * POST /api/admin/backup/create
 * Create a full database backup
 */
router.post(
  '/backup/create',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const backupsDir = path.join(__dirname, '..', 'backups');

      // Ensure backups directory exists
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }

      // Read all collections
      const collections = [
        'users',
        'suppliers',
        'packages',
        'categories',
        'plans',
        'notes',
        'messages',
        'threads',
        'events',
        'reviews',
        'reports',
        'audit_logs',
        'search_history',
        'photos',
        'payments',
        'settings',
        'badges',
        'marketplace_listings',
        'tickets',
        'newsletterSubscribers',
        'savedItems',
      ];

      const backup = {
        createdAt: new Date().toISOString(),
        createdBy: req.user.email,
        version: '1.0',
        data: {},
      };

      // Read all collections
      for (const collection of collections) {
        try {
          backup.data[collection] = await dbUnified.read(collection);
        } catch (error) {
          logger.warn(`Warning: Could not backup collection ${collection}:`, error.message);
          backup.data[collection] = [];
        }
      }

      // Save backup with timestamp
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const filename = `backup-${timestamp}.json`;
      const filepath = path.join(backupsDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf8');

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BACKUP_CREATED',
        targetType: 'backup',
        targetId: filename,
        details: { collections: collections.length, filename },
      });

      res.json({
        success: true,
        message: 'Backup created successfully',
        filename,
        size: fs.statSync(filepath).size,
        createdAt: backup.createdAt,
      });
    } catch (error) {
      logger.error('Error creating backup:', error);
      res.status(500).json({ error: 'Failed to create backup', details: error.message });
    }
  }
);

/**
 * GET /api/admin/backup/list
 * List all available backups
 */
router.get('/backup/list', authRequired, roleRequired('admin'), writeLimiter, async (req, res) => {
  try {
    const backupsDir = path.join(__dirname, '..', 'backups');

    if (!fs.existsSync(backupsDir)) {
      return res.json({ backups: [] });
    }

    const files = fs
      .readdirSync(backupsDir)
      .filter(f => f.endsWith('.json') && f.startsWith('backup-'))
      .map(filename => {
        const filepath = path.join(backupsDir, filename);
        const stats = fs.statSync(filepath);
        return {
          filename,
          size: stats.size,
          createdAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ backups: files });
  } catch (error) {
    logger.error('Error listing backups:', error);
    res.status(500).json({ error: 'Failed to list backups', details: error.message });
  }
});

/**
 * POST /api/admin/backup/restore
 * Restore database from backup
 * Body: { filename }
 */
router.post(
  '/backup/restore',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { filename } = req.body;

      if (!filename) {
        return res.status(400).json({ error: 'Filename is required' });
      }

      const backupsDir = path.join(__dirname, '..', 'backups');
      const filepath = path.join(backupsDir, filename);

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'Backup file not found' });
      }

      // Read backup file
      const backupData = JSON.parse(fs.readFileSync(filepath, 'utf8'));

      if (!backupData.data || typeof backupData.data !== 'object') {
        return res.status(400).json({ error: 'Invalid backup file format' });
      }

      // Restore all collections
      let restoredCount = 0;
      for (const [collection, data] of Object.entries(backupData.data)) {
        try {
          await dbUnified.write(collection, data);
          restoredCount++;
        } catch (error) {
          logger.warn(`Warning: Could not restore collection ${collection}:`, error.message);
        }
      }

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BACKUP_RESTORED',
        targetType: 'backup',
        targetId: filename,
        details: { filename, collectionsRestored: restoredCount },
      });

      res.json({
        success: true,
        message: 'Backup restored successfully',
        collectionsRestored: restoredCount,
        backupDate: backupData.createdAt,
      });
    } catch (error) {
      logger.error('Error restoring backup:', error);
      res.status(500).json({ error: 'Failed to restore backup', details: error.message });
    }
  }
);

/**
 * POST /api/admin/packages/:id/duplicate
 * Duplicate a package with (Copy) suffix
 */
router.post(
  '/packages/:id/duplicate',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const packages = await dbUnified.read('packages');
      const originalPkg = packages.find(p => p.id === id);

      if (!originalPkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      // Create duplicate with new ID
      const now = new Date().toISOString();
      const duplicatePkg = {
        ...originalPkg,
        id: uid('pkg'),
        title: `${originalPkg.title} (Copy)`,
        slug: `${originalPkg.slug}-copy-${Date.now()}`,
        approved: false,
        featured: false,
        createdAt: now,
        updatedAt: now,
        duplicatedFrom: originalPkg.id,
        duplicatedAt: now,
        duplicatedBy: req.user.id,
      };

      // Remove version history from duplicate
      delete duplicatePkg.versionHistory;

      await dbUnified.insertOne('packages', duplicatePkg);

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'PACKAGE_DUPLICATED',
        targetType: 'package',
        targetId: duplicatePkg.id,
        details: { originalId: originalPkg.id, newId: duplicatePkg.id, title: duplicatePkg.title },
      });

      res.status(201).json({
        success: true,
        message: 'Package duplicated successfully',
        package: duplicatePkg,
      });
    } catch (error) {
      logger.error('Error duplicating package:', error);
      res.status(500).json({ error: 'Failed to duplicate package', details: error.message });
    }
  }
);

/**
 * GET /api/admin/pexels/test
 * Test Pexels API configuration
 */
router.get('/pexels/test', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const apiKey = process.env.PEXELS_API_KEY;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Pexels API key not configured',
        message: 'Please set PEXELS_API_KEY environment variable',
      });
    }

    // Test API by fetching sample images (using Node.js 18+ built-in fetch)
    const response = await fetch('https://api.pexels.com/v1/search?query=event&per_page=5', {
      headers: {
        Authorization: apiKey,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: 'Pexels API request failed',
        status: response.status,
        message: response.statusText,
      });
    }

    const data = await response.json();

    res.json({
      success: true,
      message: 'Pexels API is working correctly',
      apiKey: `${apiKey.substring(0, 10)}...`,
      sampleImages: data.photos
        ? data.photos.slice(0, 3).map(p => ({
            id: p.id,
            url: p.src.medium,
            photographer: p.photographer,
          }))
        : [],
      totalResults: data.total_results || 0,
    });
  } catch (error) {
    logger.error('Error testing Pexels API:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test Pexels API',
      details: error.message,
    });
  }
});

/**

/**
 * GET /api/admin/analytics/competitors (P3-17: Competitor Analysis)
 * Get competitor analysis dashboard data
 */
router.get('/analytics/competitors', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    // Define key competitors
    const competitors = [
      {
        name: 'Bridebook',
        url: 'bridebook.co.uk',
        description: 'Leading UK wedding planning platform',
      },
      {
        name: 'Hitched',
        url: 'hitched.co.uk',
        description: 'Wedding venue and supplier directory',
      },
      {
        name: 'WeddingWire',
        url: 'weddingwire.co.uk',
        description: 'International wedding marketplace',
      },
    ];

    // Basic competitor feature analysis
    const analysis = competitors.map(competitor => ({
      name: competitor.name,
      url: competitor.url,
      description: competitor.description,
      features: {
        marketplace: true,
        planning_tools: competitor.name === 'Bridebook',
        guest_management: true,
        supplier_directory: true,
        budget_tracker: competitor.name === 'Bridebook',
        seating_planner: competitor.name === 'Bridebook' || competitor.name === 'Hitched',
      },
      pricing: {
        free_tier: true,
        supplier_pricing: 'Subscription-based',
        customer_pricing: 'Free',
      },
      userExperience: {
        mobile_app: competitor.name === 'Bridebook' || competitor.name === 'WeddingWire',
        modern_design: true,
        easy_navigation: true,
      },
      marketPosition: {
        primary_market: 'UK',
        focus: competitor.name === 'Bridebook' ? 'Planning tools' : 'Supplier directory',
      },
    }));

    res.json({
      success: true,
      competitors: analysis,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error analyzing competitors:', error);
    res.status(500).json({ error: 'Failed to analyze competitors', details: error.message });
  }
});

/**
 * GET /api/admin/users/segments (P3-31: User Segmentation)
 * Get user segmentation for marketing and analytics
 */

// ---------- Content Date Management Routes ----------

/**
 * GET /api/admin/content-dates
 * Get current date configuration and git-based dates
 */
router.get('/content-dates', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    // Get date service from app.locals (injected by server.js)
    const dateService = req.app.locals.dateService;

    if (!dateService) {
      return res.status(503).json({
        error: 'Date management service not available',
        message: 'The date management service is not initialized',
      });
    }

    // Get current config
    const { getConfig } = require('../config/content-config.js');
    const config = getConfig();

    // Get change detection info
    const changeCheck = await dateService.hasLegalContentChanged();

    // Get service status
    const status = dateService.getStatus();

    res.json({
      success: true,
      config: config.dates,
      changeCheck,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting content dates:', error);
    res.status(500).json({
      error: 'Failed to get content dates',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/content-dates
 * Manually update legal dates (admin override)
 */
router.post(
  '/content-dates',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const dateService = req.app.locals.dateService;

      if (!dateService) {
        return res.status(503).json({
          error: 'Date management service not available',
        });
      }

      const { lastUpdated, effectiveDate } = req.body;

      if (!lastUpdated && !effectiveDate) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Please provide lastUpdated or effectiveDate',
        });
      }

      // Validate date format (e.g., "February 2026")
      const datePattern =
        /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;

      if (lastUpdated && !datePattern.test(lastUpdated)) {
        return res.status(400).json({
          error: 'Invalid date format',
          message: 'Date must be in format "Month YYYY" (e.g., "February 2026")',
        });
      }

      if (effectiveDate && !datePattern.test(effectiveDate)) {
        return res.status(400).json({
          error: 'Invalid date format',
          message: 'Date must be in format "Month YYYY" (e.g., "February 2026")',
        });
      }

      // Update dates
      const result = await dateService.updateLegalDates({
        lastUpdated,
        effectiveDate,
        manual: true,
        userId: req.user.id,
      });

      if (result.success) {
        // Create audit log
        auditLog({
          adminId: req.user.id,
          adminEmail: req.user.email,
          action: 'MANUAL_DATE_UPDATE',
          targetType: 'content_dates',
          targetId: 'legal_dates',
          details: { lastUpdated, effectiveDate },
        });

        // Notify other admins
        await dateService.notifyAdmins({
          type: 'MANUAL_UPDATE',
          userId: req.user.id,
          userEmail: req.user.email,
          lastUpdated,
          effectiveDate,
          timestamp: new Date().toISOString(),
        });

        res.json({
          success: true,
          message: 'Legal dates updated successfully',
          ...result,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to update dates',
          message: result.error,
        });
      }
    } catch (error) {
      logger.error('Error updating content dates:', error);
      res.status(500).json({
        error: 'Failed to update dates',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/content-dates/articles
 * Get all article dates from git history
 */
router.get('/content-dates/articles', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const dateService = req.app.locals.dateService;

    if (!dateService) {
      return res.status(503).json({
        error: 'Date management service not available',
      });
    }

    const articles = await dateService.getArticleDates();

    res.json({
      success: true,
      articles,
      count: articles.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting article dates:', error);
    res.status(500).json({
      error: 'Failed to get article dates',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/content-dates/schedule
 * Enable/disable automated monthly updates
 */
router.post(
  '/content-dates/schedule',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const dateService = req.app.locals.dateService;

      if (!dateService) {
        return res.status(503).json({
          error: 'Date management service not available',
        });
      }

      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid parameter',
          message: 'enabled must be a boolean',
        });
      }

      // Update config file
      const configPath = require('path').resolve(__dirname, '../config/content-config.js');
      let configContent = require('fs').readFileSync(configPath, 'utf8');

      configContent = configContent.replace(
        /autoUpdateEnabled:\s*(?:true|false)/,
        `autoUpdateEnabled: ${enabled}`
      );

      require('fs').writeFileSync(configPath, configContent, 'utf8');

      // Clear require cache
      delete require.cache[require.resolve('../config/content-config.js')];

      // Restart or stop scheduler based on enabled state
      let scheduleResult;
      if (enabled) {
        scheduleResult = dateService.scheduleMonthlyUpdate();
      } else {
        scheduleResult = dateService.cancelScheduledUpdate();
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: enabled ? 'ENABLE_AUTO_DATES' : 'DISABLE_AUTO_DATES',
        targetType: 'content_dates',
        targetId: 'automation',
        details: { enabled },
      });

      res.json({
        success: true,
        message: `Automated updates ${enabled ? 'enabled' : 'disabled'} successfully`,
        enabled,
        schedule: scheduleResult,
      });
    } catch (error) {
      logger.error('Error updating schedule:', error);
      res.status(500).json({
        error: 'Failed to update schedule',
        message: error.message,
      });
    }
  }
);

/**
 * GET /api/admin/content-dates/health
 * Issue 3 Fix: Health check endpoint for date automation system
 */
router.get(
  '/content-dates/health',
  apiLimiter,
  authRequired,
  roleRequired('admin'),
  async (req, res) => {
    try {
      const dateService = req.app.locals.dateService;
      const fs = require('fs').promises;
      const path = require('path');

      if (!dateService) {
        return res.status(503).json({
          success: false,
          error: 'Date management service not available',
        });
      }

      // Get service config and status
      const { getConfig } = require('../config/content-config');
      const config = getConfig();
      const changeCheck = await dateService.hasLegalContentChanged();

      // Test if config file is writable
      let configWritable = false;
      try {
        const configPath = path.join(__dirname, '../config/content-config.js');
        await fs.access(configPath, fs.constants.W_OK);
        configWritable = true;
      } catch (err) {
        configWritable = false;
      }

      res.json({
        success: true,
        health: {
          serviceLoaded: !!dateService,
          autoUpdateEnabled: config.dates.autoUpdateEnabled,
          lastAutoCheck: config.dates.lastAutoCheck,
          lastManualUpdate: config.dates.lastManualUpdate,
          gitAvailable: changeCheck.reason !== 'No git history available',
          contentUpToDate: !changeCheck.changed,
          configWritable: configWritable,
          currentDates: {
            legalLastUpdated: config.dates.legalLastUpdated,
            legalEffectiveDate: config.dates.legalEffectiveDate,
            currentYear: config.dates.currentYear,
          },
        },
      });
    } catch (error) {
      logger.error('Error checking health:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * POST /api/admin/content-dates/check-now
 * Manually trigger a date check (without waiting for scheduled time)
 */
router.post(
  '/content-dates/check-now',
  writeLimiter,
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const dateService = req.app.locals.dateService;

      if (!dateService) {
        return res.status(503).json({
          error: 'Date management service not available',
        });
      }

      const result = await dateService.performMonthlyCheck();

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'MANUAL_DATE_CHECK',
        targetType: 'content_dates',
        targetId: 'check',
        details: result,
      });

      res.json({
        success: true,
        message: result.performed
          ? 'Date check completed and dates updated'
          : 'Date check completed, no update needed',
        result,
      });
    } catch (error) {
      logger.error('Error performing date check:', error);
      res.status(500).json({
        error: 'Failed to perform date check',
        message: error.message,
      });
    }
  }
);

module.exports = router;
module.exports.setHelperFunctions = setHelperFunctions;
