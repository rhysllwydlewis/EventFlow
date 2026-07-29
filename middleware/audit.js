/**
 * Audit Logging Middleware
 * Tracks admin actions for compliance and security
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

/**
 * Log an admin action to the audit log
 * Resilient: does not throw on logging failures
 * @param {Object} params - Audit log parameters
 * @param {string} params.adminId - ID of the admin user performing the action
 * @param {string} params.adminEmail - Email of the admin user
 * @param {string} params.action - Type of action performed
 * @param {string} params.targetType - Type of resource affected (user, supplier, review, etc.)
 * @param {string} params.targetId - ID of the affected resource
 * @param {Object} params.details - Additional details about the action
 * @param {string} params.ipAddress - IP address of the request
 * @param {string} params.userAgent - User agent string
 * @returns {Promise<Object|null>} The created audit log entry or null on error
 */
async function auditLog(params) {
  let logEntry = null;
  try {
    const {
      adminId,
      adminEmail,
      action,
      targetType,
      targetId,
      details = {},
      ipAddress = null,
      userAgent = null,
    } = params || {};

    const now = new Date().toISOString();
    logEntry = {
      id: dbUnified.uid('audit'),
      adminId,
      adminEmail,
      action,
      targetType,
      targetId,
      details,
      ipAddress,
      userAgent,
      timestamp: now,
      createdAt: now,
    };

    // dbUnified.insertOne normalises storage failures to null instead of throwing.
    // Check the return value so callers that need fail-closed auditing can
    // distinguish a durable audit record from a swallowed database failure.
    const inserted = await dbUnified.insertOne('audit_logs', logEntry);
    if (!inserted) {
      logger.error('[AUDIT ERROR] Audit storage returned no persisted entry');
      logger.error('[AUDIT ERROR] Failed log entry:', logEntry);
      return null;
    }

    logger.info(`[AUDIT] ${adminEmail} performed ${action} on ${targetType} ${targetId}`);

    return logEntry;
  } catch (error) {
    // Audit logging is deliberately non-throwing. Fail-closed callers inspect the
    // null return and can compensate/rollback their own state change.
    logger.error('[AUDIT ERROR] Failed to write audit log:', error.message);
    if (logEntry) {
      logger.error('[AUDIT ERROR] Failed log entry:', logEntry);
    }
    return null;
  }
}

/**
 * Express middleware to automatically log admin actions
 * Usage: router.post('/api/admin/users/:id/ban', auditMiddleware('user_ban'), handler)
 *
 * @param {string} action - The action being performed
 * @param {Function} getTargetInfo - Optional function to extract target type and ID from req
 * @returns {Function} Express middleware function
 */
function auditMiddleware(action, getTargetInfo = null) {
  return (req, res, next) => {
    // Store original res.json to intercept successful responses
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Only log if the response was successful (2xx status code)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Fire and forget - don't wait for audit log
        (async () => {
          try {
            let targetType = 'unknown';
            let targetId = 'unknown';

            // Extract target info from custom function or request params
            if (getTargetInfo) {
              const targetInfo = getTargetInfo(req, data);
              targetType = targetInfo.targetType;
              targetId = targetInfo.targetId;
            } else if (req.params.id) {
              targetId = req.params.id;
              // Try to infer type from URL
              if (req.path.includes('/users/')) {
                targetType = 'user';
              } else if (req.path.includes('/suppliers/')) {
                targetType = 'supplier';
              } else if (req.path.includes('/reviews/')) {
                targetType = 'review';
              } else if (req.path.includes('/reports/')) {
                targetType = 'report';
              }
            }

            await auditLog({
              adminId: req.user.id,
              adminEmail: req.user.email,
              action,
              targetType,
              targetId,
              details: {
                body: req.body,
                query: req.query,
                params: req.params,
              },
              ipAddress: req.ip || req.connection.remoteAddress,
              userAgent: req.get('user-agent'),
            });
          } catch (err) {
            // Error already logged in auditLog function
            // Just silently continue here
          }
        })();
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Get audit logs with optional filtering
 * Supports filtering by adminId, adminEmail, action, targetType, targetId, date range, and limit
 * @param {Object} filters - Filter options
 * @param {string} filters.adminId - Filter by admin user ID
 * @param {string} filters.adminEmail - Filter by admin email
 * @param {string} filters.action - Filter by action type
 * @param {string} filters.targetType - Filter by target type
 * @param {string} filters.targetId - Filter by target ID
 * @param {string} filters.startDate - Filter by start date (ISO string)
 * @param {string} filters.endDate - Filter by end date (ISO string)
 * @param {number} filters.limit - Maximum number of results
 * @returns {Promise<Array>} Filtered audit log entries, sorted newest-first
 */
async function getAuditLogs(filters = {}) {
  const {
    adminId,
    adminEmail,
    action,
    targetType,
    targetId,
    startDate,
    endDate,
    limit = 100,
  } = filters;

  try {
    let logs = await dbUnified.read('audit_logs');

    // Apply filters
    if (adminId) {
      logs = logs.filter(log => log.adminId === adminId);
    }
    if (adminEmail) {
      logs = logs.filter(log => log.adminEmail === adminEmail);
    }
    if (action) {
      logs = logs.filter(log => log.action === action);
    }
    if (targetType) {
      logs = logs.filter(log => log.targetType === targetType);
    }
    if (targetId) {
      logs = logs.filter(log => log.targetId === targetId);
    }
    if (startDate) {
      logs = logs.filter(log => log.timestamp >= startDate);
    }
    if (endDate) {
      logs = logs.filter(log => log.timestamp <= endDate);
    }

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime;
    });

    // Apply limit
    return logs.slice(0, limit);
  } catch (error) {
    logger.error('Error fetching audit logs:', error.message);
    // Return empty array on error - don't fail the request
    return [];
  }
}

const { AUDIT_ACTIONS } = require('./audit-actions');

module.exports = {
  auditLog,
  auditMiddleware,
  getAuditLogs,
  AUDIT_ACTIONS,
};
