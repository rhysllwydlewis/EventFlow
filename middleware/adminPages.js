/**
 * Admin Page Protection Middleware
 * Protects all admin HTML pages from unauthorized access at the server level
 * CRITICAL: This middleware MUST come before express.static()
 */

'use strict';

const logger = require('../utils/logger');
const { getUserFromCookie } = require('./auth');
const { getAdminPagesAllowlist } = require('../config/adminRegistry');

// Allowlist of valid admin pages derived from the central admin registry.
// Both the canonical clean URLs and legacy .html variants are included so that
// protection is enforced regardless of which form the browser requests.
// Add new pages to config/adminRegistry.js — do NOT edit this list directly.
const ADMIN_PAGES = getAdminPagesAllowlist();

/**
 * Admin HTML Page Protection Middleware
 * Checks authentication and authorization for admin pages
 * @returns {Function} Express middleware
 */
function adminPageProtectionMiddleware() {
  return (req, res, next) => {
    // Check if requesting an admin page (using allowlist for security)
    if (ADMIN_PAGES.includes(req.path)) {
      const user = getUserFromCookie(req);

      // Not authenticated - redirect to login with sanitized return path
      if (!user) {
        logger.info(`Admin page access denied (not authenticated): ${req.path}`, {
          ip: req.ip,
          userAgent: req.get('user-agent'),
        });
        // Redirect path is already validated by allowlist check above
        return res.redirect(`/auth?redirect=${encodeURIComponent(req.path)}`);
      }

      // Authenticated but not admin - redirect to dashboard with message
      if (user.role !== 'admin') {
        logger.warn(`Admin page access denied (insufficient role): ${req.path}`, {
          userId: user.id,
          userRole: user.role,
          ip: req.ip,
        });
        return res.redirect('/dashboard?msg=admin_required');
      }

      // Admin user - allow access
      logger.info(`Admin page access granted: ${req.path}`, {
        userId: user.id,
        userRole: user.role,
      });
    }
    next();
  };
}

module.exports = {
  adminPageProtectionMiddleware,
  ADMIN_PAGES,
};
