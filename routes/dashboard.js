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
 * Role-based dashboard redirect page
 */
router.get('/dashboard', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
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

module.exports = router;
