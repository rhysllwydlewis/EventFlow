/**
 * Maintenance Mode Middleware
 * Checks if maintenance mode is enabled and blocks non-admin users
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

// Health check endpoints that should remain accessible during maintenance
// for platform health checks (Railway, Kubernetes, etc.)
const HEALTH_ENDPOINTS = ['/api/health', '/api/ready', '/api/status'];

/**
 * Middleware to check maintenance mode
 * If enabled, non-admin users are redirected to maintenance page
 * Admins can still access the site normally
 * Auto-disables maintenance if expiration time has passed
 */
async function maintenanceMode(req, res, next) {
  try {
    // Get maintenance settings from dbUnified (same as admin API)
    const settings = (await dbUnified.read('settings')) || {};
    const maintenance = settings.maintenance || { enabled: false };

    // Check if maintenance has expired and auto-disable if needed
    if (maintenance.enabled && maintenance.expiresAt) {
      const now = new Date();
      const expiresAt = new Date(maintenance.expiresAt);

      if (now >= expiresAt) {
        // Maintenance period has expired - auto-disable
        logger.info('Maintenance mode expired, auto-disabling...');
        maintenance.enabled = false;
        maintenance.autoDisabledAt = now.toISOString();
        settings.maintenance = maintenance;
        await dbUnified.write('settings', settings);
      }
    }

    // If maintenance mode is not enabled, continue normally
    if (!maintenance.enabled) {
      return next();
    }

    // Allow access to maintenance page itself
    if (req.path === '/maintenance.html') {
      return next();
    }

    // Allow access to auth page for admin login
    if (req.path === '/auth' || req.path === '/auth.html' || req.path.startsWith('/api/auth')) {
      return next();
    }

    // Allow access to admin pages and API endpoints (will be protected by auth middleware)
    // This ensures admins can access admin dashboard even during maintenance
    if (req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) {
      return next();
    }

    // Allow CSRF token endpoint (needed for login)
    if (req.path === '/api/csrf-token') {
      return next();
    }

    // Allow access to verification page (users need to verify their accounts)
    if (req.path === '/verify.html' || req.path === '/verify') {
      return next();
    }

    // Allow access to static assets
    if (req.path.startsWith('/assets/') || req.path.startsWith('/favicon')) {
      return next();
    }

    // Allow public access to maintenance message endpoint
    if (req.path === '/api/maintenance/message') {
      return next();
    }

    // Allow health check endpoints to pass through for platform health checks
    // These endpoints must remain accessible even during maintenance for Railway, etc.
    if (HEALTH_ENDPOINTS.includes(req.path)) {
      return next();
    }

    // Allow admins to access the site normally
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    // For API requests from non-admin users, return 503
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        maintenance: true,
        message:
          maintenance.message || "We're performing scheduled maintenance. We'll be back soon!",
      });
    }

    // For HTML requests from non-admin users, redirect to maintenance page
    res.redirect('/maintenance.html');
  } catch (error) {
    logger.error('Error in maintenance middleware:', error);
    // On error, allow access (fail-open for safety)
    next();
  }
}

module.exports = maintenanceMode;
