/**
 * Dashboard & Admin Page Routes
 * Handles dashboard redirects and admin page routes
 */

'use strict';

const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');

const router = express.Router();

/**
 * GET /dashboard
 * Role-based dashboard redirect page — requires authentication.
 * Performs a server-side redirect to the role-specific dashboard so
 * unauthenticated users cannot access any dashboard content.
 */
router.get('/dashboard', apiLimiter, authRequired, async (req, res) => {
  try {
    const role = req.user?.role;
    if (role === 'customer') {
      return res.redirect('/dashboard/customer');
    }
    if (role === 'supplier') {
      return res.redirect('/dashboard/supplier');
    }
    if (role === 'admin') {
      return res.redirect('/admin');
    }
    // Authenticated but unknown role — fall back to the generic redirect page
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
  } catch (error) {
    logger.error('Error serving dashboard redirect:', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /dashboard/customer
 * Serve customer dashboard HTML page
 */
router.get('/dashboard/customer', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.redirect('/auth');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-customer.html'));
  } catch (error) {
    logger.error('Error serving customer dashboard:', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /dashboard/customer/plans/:id
 * Serve the customer dashboard with the plan ID embedded in the URL so the
 * client-side JS can highlight / scroll to the correct plan.
 */
router.get('/dashboard/customer/plans/:id', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.redirect('/auth');
    }
    // Validate the plan ID format (prefix_alphanumeric as produced by uid()).
    // An invalid format cannot belong to a real plan — redirect to the dashboard.
    if (!/^[a-z]+_[0-9a-z]+$/.test(req.params.id)) {
      return res.redirect('/dashboard/customer');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-customer.html'));
  } catch (error) {
    logger.error('Error serving customer dashboard (plan detail):', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /dashboard/supplier
 * Serve supplier dashboard HTML page
 */
router.get('/dashboard/supplier', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'supplier') {
      return res.redirect('/auth');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-supplier.html'));
  } catch (error) {
    logger.error('Error serving supplier dashboard:', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /admin
 * Serve admin dashboard HTML page
 */
router.get('/admin', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.redirect('/auth');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
  } catch (error) {
    logger.error('Error serving admin dashboard:', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * GET /admin-debug
 * Serve admin debug/system-checks page
 */
router.get('/admin-debug', apiLimiter, authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.redirect('/auth');
    }
    res.sendFile(path.join(__dirname, '..', 'public', 'admin-debug.html'));
  } catch (error) {
    logger.error('Error serving admin debug page:', error);
    return res.status(500).send('Internal server error');
  }
});

module.exports = router;
