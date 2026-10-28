/**
 * Audit Logging Middleware
 * Tracks admin actions for compliance and security
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { AUDIT_ACTIONS } = require('./audit-actions');

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
// skipcq: JS-0067 -- CommonJS module scope prevents this declaration becoming a browser global.
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
      logger.error('[AUDIT ERROR] Failed log entry', {
        adminId,
        adminEmail,
        action,
        targetType,
        targetId,
      });
      return null;
    }

    logger.info('[AUDIT] Admin action recorded', { adminEmail, action, targetType, targetId });

    return logEntry;
  } catch (error) {
    // Audit logging is deliberately non-throwing. Fail-closed callers inspect the
    // null return and can compensate/rollback their own state change.
    logger.error('[AUDIT ERROR] Failed to write audit log:', error.message);
    if (logEntry) {
      logger.error('[AUDIT ERROR] Failed log entry', {
        adminId: params?.adminId,
        adminEmail: params?.adminEmail,
        action: params?.action,
        targetType: params?.targetType,
        targetId: params?.targetId,
      });
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
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns a date filter into an ISO timestamp. A plain date ("2026-10-28", what a date picker
 * gives) covers the whole day: a start date means the beginning of it, an end date the very end,
 * so an end date no longer leaves out everything that happened on that day.
 * @param {string} value - Plain date or ISO timestamp
 * @param {'start'|'end'} bound - Which end of the range this is
 * @returns {string|null} ISO timestamp, or null when the value is not a date
 */
function auditDateBound(value, bound) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  if (DATE_ONLY.test(text)) {
    return bound === 'end' ? `${text}T23:59:59.999Z` : `${text}T00:00:00.000Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** When an entry was written (older entries carry createdAt only). */
function entryTime(entry) {
  return entry.timestamp || entry.createdAt || '';
}

/**
 * Apply audit log filters to a list of entries and sort them newest-first.
 * @param {Array<Object>} entries - Audit log entries
 * @param {Object} filters - See getAuditLogs
 * @returns {Array<Object>} Matching entries, newest first
 */
function filterAuditLogs(entries, filters) {
  const { adminId, adminEmail, action, targetType, targetId, startDate, endDate } = filters;
  const from = auditDateBound(startDate, 'start');
  const until = auditDateBound(endDate, 'end');
  // Accept one type or a comma-separated list ("features,settings,maintenance")
  const targetTypes = targetType
    ? String(targetType)
        .split(',')
        .map(type => type.trim())
        .filter(Boolean)
    : null;

  const matches = entries.filter(
    log =>
      (!adminId || log.adminId === adminId) &&
      (!adminEmail || log.adminEmail === adminEmail) &&
      (!action || log.action === action) &&
      (!targetTypes || targetTypes.includes(log.targetType)) &&
      (!targetId || log.targetId === targetId) &&
      (!from || entryTime(log) >= from) &&
      (!until || entryTime(log) <= until)
  );

  // Sort by timestamp descending (newest first)
  return matches.sort(
    (first, second) => new Date(entryTime(second)).getTime() - new Date(entryTime(first)).getTime()
  );
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
 * @param {string} filters.startDate - Filter by start date (ISO string or YYYY-MM-DD)
 * @param {string} filters.endDate - Filter by end date (ISO string or YYYY-MM-DD, inclusive)
 * @param {number} filters.limit - Maximum number of results
 * @param {number} filters.offset - Number of matching entries to skip
 * @returns {Promise<Array>} Filtered audit log entries, sorted newest-first
 */
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function getAuditLogs(filters = {}) {
  const { limit = 100, offset = 0 } = filters;

  try {
    const logs = filterAuditLogs(await dbUnified.read('audit_logs'), filters);
    return logs.slice(offset, offset + limit);
  } catch (error) {
    logger.error('Error fetching audit logs:', error.message);
    // Return empty array on error - don't fail the request
    return [];
  }
}

/**
 * One page of audit logs together with how many entries match in total, so a screen can say
 * "showing 1-100 of 342" instead of silently stopping at the first page.
 * @param {Object} filters - As getAuditLogs, plus page (1-based) and limit
 * @returns {Promise<{logs: Array, total: number, page: number, limit: number}>} The page
 */
async function getAuditLogsPage(filters = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 100));
  const page = Math.max(1, parseInt(filters.page, 10) || 1);

  try {
    const matches = filterAuditLogs(await dbUnified.read('audit_logs'), filters);
    const offset = (page - 1) * limit;
    return { logs: matches.slice(offset, offset + limit), total: matches.length, page, limit };
  } catch (error) {
    logger.error('Error fetching audit logs:', error.message);
    return { logs: [], total: 0, page, limit, failed: true };
  }
}

/**
 * The actions and target types an admin can filter the audit log by: every one the system can
 * write, plus any that exist in stored entries (older or one-off ones such as the export).
 * @returns {Promise<{actions: string[], targetTypes: string[]}>} Sorted distinct values
 */
async function getAuditFilterOptions() {
  const actions = new Set(Object.values(AUDIT_ACTIONS));
  const targetTypes = new Set();
  const entries = (await dbUnified.read('audit_logs')) || [];
  for (const entry of entries) {
    if (entry.action) {
      actions.add(entry.action);
    }
    if (entry.targetType) {
      targetTypes.add(entry.targetType);
    }
  }
  return { actions: [...actions].sort(), targetTypes: [...targetTypes].sort() };
}

module.exports = {
  auditLog,
  auditMiddleware,
  getAuditLogs,
  getAuditLogsPage,
  filterAuditLogs,
  getAuditFilterOptions,
  auditDateBound,
  AUDIT_ACTIONS,
};
