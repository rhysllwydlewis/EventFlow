/**
 * Metrics Routes
 * Analytics and metrics tracking endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
let seed;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Metrics routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = ['dbUnified', 'authRequired', 'roleRequired', 'csrfProtection', 'seed'];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Metrics routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  seed = deps.seed;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// ---------- Metrics Routes ----------

router.post('/metrics/track', applyCsrfProtection, async (req, res) => {
  // In a real deployment you could log req.body here.
  res.json({ ok: true });
});

// Real timeseries for admin charts (last 14 days)
router.get(
  '/admin/metrics/timeseries',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (_req, res) => {
    try {
      const today = new Date();
      const days = 14;

      // Build date labels for the last 14 days
      const dateLabels = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dateLabels.push(d.toISOString().slice(0, 10));
      }

      // Load users and plans to count by createdAt date
      const [users, plans] = await Promise.all([
        dbUnified.read('users').then(d => d || []),
        dbUnified.read('plans').then(d => d || []),
      ]);

      // Count signups per day
      const signupsByDate = {};
      users.forEach(u => {
        if (u.createdAt) {
          const day = new Date(u.createdAt).toISOString().slice(0, 10);
          signupsByDate[day] = (signupsByDate[day] || 0) + 1;
        }
      });

      // Count plan creations per day
      const plansByDate = {};
      plans.forEach(p => {
        if (p.createdAt) {
          const day = new Date(p.createdAt).toISOString().slice(0, 10);
          plansByDate[day] = (plansByDate[day] || 0) + 1;
        }
      });

      const series = dateLabels.map(iso => ({
        date: iso,
        // visitors: no visitor tracking collection — omitted
        signups: signupsByDate[iso] || 0,
        plans: plansByDate[iso] || 0,
      }));

      res.json({ series });
    } catch (error) {
      logger.error('Error fetching timeseries metrics:', error);
      res.status(500).json({ error: 'Failed to fetch timeseries metrics', series: [] });
    }
  }
);

// ---------- Admin ----------
router.get('/admin/metrics', applyAuthRequired, applyRoleRequired('admin'), async (_req, res) => {
  try {
    const users = await dbUnified.read('users');
    const suppliers = await dbUnified.read('suppliers');
    const plans = await dbUnified.read('plans');
    const msgs = await dbUnified.read('messages');
    const pkgs = await dbUnified.read('packages');
    const threads = await dbUnified.read('threads');
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
    logger.error('Error reading admin metrics:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/admin/reset-demo',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
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
      for (const name of collections) {
        await dbUnified.write(name, []);
      }
      await seed();
      res.json({ ok: true });
    } catch (err) {
      logger.error('Reset demo failed', err);
      res.status(500).json({ error: 'Reset demo failed' });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
