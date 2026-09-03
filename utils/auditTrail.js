/**
 * Enhanced Audit Trail Utilities
 * Provides comprehensive audit logging with filtering and querying
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('./logger');

/**
 * Create a detailed audit log entry
 * @param {Object} params - Audit log parameters
 * @param {Object} params.actor - Actor information (who performed the action)
 * @param {string} params.actor.id - Actor's user ID
 * @param {string} params.actor.email - Actor's email
 * @param {string} params.actor.role - Actor's role
 * @param {string} params.action - Action type (e.g., 'APPROVE_REVIEW')
 * @param {Object} params.resource - Resource affected by the action
 * @param {string} params.resource.type - Resource type (e.g., 'review', 'user')
 * @param {string} params.resource.id - Resource ID
 * @param {Object} params.changes - Before/after changes (optional)
 * @param {string} params.ipAddress - IP address of the request
 * @param {string} params.userAgent - User agent string
 * @param {Object} params.details - Additional details (optional)
 * @returns {Promise<Object>} Created audit log entry
 */
async function createAuditLog(params) {
  const {
    actor,
    action,
    resource,
    changes = null,
    ipAddress = null,
    userAgent = null,
    details = {},
  } = params;

  // Validate required parameters
  if (!actor || !actor.id || !action || !resource || !resource.type) {
    throw new Error('Missing required audit log parameters');
  }

  const timestamp = new Date().toISOString();
  const logEntry = {
    _id: dbUnified.uid('audit'),
    id: dbUnified.uid('audit'), // For backward compatibility
    actor: {
      id: actor.id,
      email: actor.email || 'unknown',
      role: actor.role || 'unknown',
    },
    action,
    resource: {
      type: resource.type,
      id: resource.id || 'unknown',
    },
    changes: changes || null,
    ipAddress,
    userAgent,
    timestamp,
    createdAt: timestamp,
    details,
  };

  try {
    await dbUnified.insertOne('audit_logs', logEntry);

    logger.info('Audit log created', {
      action,
      actorId: actor.id,
      resourceType: resource.type,
      resourceId: resource.id,
    });

    return logEntry;
  } catch (error) {
    logger.error('Failed to create audit log', {
      error: error.message,
      action,
      actorId: actor.id,
    });
    throw error;
  }
}

/**
 * Query audit logs with advanced filtering
 * @param {Object} filters - Query filters
 * @param {string} filters.actorId - Filter by actor ID
 * @param {string} filters.actorEmail - Filter by actor email
 * @param {string} filters.action - Filter by action type
 * @param {string} filters.resourceType - Filter by resource type
 * @param {string} filters.resourceId - Filter by resource ID
 * @param {string} filters.startDate - Start date for time range filter (ISO string)
 * @param {string} filters.endDate - End date for time range filter (ISO string)
 * @param {number} filters.page - Page number (1-based)
 * @param {number} filters.limit - Number of results per page
 * @param {string} filters.sortBy - Sort field (default: 'timestamp')
 * @param {string} filters.sortOrder - Sort order ('asc' or 'desc', default: 'desc')
 * @returns {Promise<Object>} Query results with pagination metadata
 */
async function queryAuditLogs(filters = {}) {
  const {
    actorId,
    actorEmail,
    action,
    resourceType,
    resourceId,
    startDate,
    endDate,
    page = 1,
    limit = 50,
    sortBy = 'timestamp',
    sortOrder = 'desc',
  } = filters;

  try {
    let logs = await dbUnified.read('audit_logs');

    // Apply filters
    if (actorId) {
      logs = logs.filter(log => log.actor && log.actor.id === actorId);
    }
    if (actorEmail) {
      logs = logs.filter(
        log => log.actor && log.actor.email.toLowerCase() === actorEmail.toLowerCase()
      );
    }
    if (action) {
      logs = logs.filter(log => log.action === action);
    }
    if (resourceType) {
      logs = logs.filter(log => log.resource && log.resource.type === resourceType);
    }
    if (resourceId) {
      logs = logs.filter(log => log.resource && log.resource.id === resourceId);
    }
    if (startDate) {
      logs = logs.filter(log => log.timestamp >= startDate);
    }
    if (endDate) {
      logs = logs.filter(log => log.timestamp <= endDate);
    }

    // Sort
    logs.sort((a, b) => {
      const aValue = a[sortBy] || '';
      const bValue = b[sortBy] || '';

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Pagination
    const total = logs.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedLogs = logs.slice(offset, offset + limit);

    return {
      success: true,
      data: paginatedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to query audit logs', {
      error: error.message,
      filters,
    });
    throw error;
  }
}

/**
 * Get a specific audit log entry by ID
 * @param {string} logId - Audit log ID
 * @returns {Promise<Object>} Audit log entry
 */
async function getAuditLogById(logId) {
  try {
    const logs = await dbUnified.read('audit_logs');
    const log = logs.find(l => l.id === logId || l._id === logId);

    if (!log) {
      throw new Error('Audit log not found');
    }

    return {
      success: true,
      data: log,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get audit log', {
      error: error.message,
      logId,
    });
    throw error;
  }
}

/**
 * Get all audit logs for a specific user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} User's audit logs
 */
function getUserAuditLogs(userId, options = {}) {
  return queryAuditLogs({
    actorId: userId,
    ...options,
  });
}

/**
 * Get audit statistics
 * @param {Object} filters - Optional filters for statistics
 * @returns {Promise<Object>} Audit statistics
 */
async function getAuditStatistics(filters = {}) {
  try {
    let logs = await dbUnified.read('audit_logs');

    // Apply date range filter if provided
    if (filters.startDate) {
      logs = logs.filter(log => log.timestamp >= filters.startDate);
    }
    if (filters.endDate) {
      logs = logs.filter(log => log.timestamp <= filters.endDate);
    }

    // Calculate statistics
    const actionCounts = {};
    const actorCounts = {};
    const resourceTypeCounts = {};

    logs.forEach(log => {
      // Count by action
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;

      // Count by actor
      if (log.actor && log.actor.id) {
        actorCounts[log.actor.id] = (actorCounts[log.actor.id] || 0) + 1;
      }

      // Count by resource type
      if (log.resource && log.resource.type) {
        resourceTypeCounts[log.resource.type] = (resourceTypeCounts[log.resource.type] || 0) + 1;
      }
    });

    // Find top actors
    const topActors = Object.entries(actorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([actorId, count]) => {
        const actorLog = logs.find(l => l.actor && l.actor.id === actorId);
        return {
          actorId,
          actorEmail: actorLog?.actor?.email || 'unknown',
          count,
        };
      });

    return {
      success: true,
      data: {
        totalLogs: logs.length,
        actionCounts,
        resourceTypeCounts,
        topActors,
        dateRange: {
          earliest: logs.length > 0 ? logs[logs.length - 1].timestamp : null,
          latest: logs.length > 0 ? logs[0].timestamp : null,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get audit statistics', {
      error: error.message,
      filters,
    });
    throw error;
  }
}

/**
 * Format audit log entry for display
 * @param {Object} log - Audit log entry
 * @returns {Object} Formatted audit log
 */
function formatAuditLog(log) {
  return {
    id: log.id || log._id,
    actor: {
      email: log.actor?.email || 'unknown',
      role: log.actor?.role || 'unknown',
    },
    action: log.action,
    resource: {
      type: log.resource?.type || 'unknown',
      id: log.resource?.id || 'unknown',
    },
    changes: log.changes || null,
    timestamp: log.timestamp,
    details: log.details || {},
  };
}

/**
 * Express middleware to automatically create audit logs
 * @param {string} action - Action type
 * @param {Function} getResourceInfo - Function to extract resource info from request
 * @returns {Function} Express middleware
 */
function auditMiddleware(action, getResourceInfo) {
  return (req, res, next) => {
    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);

    res.json = function (data) {
      // Only log successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Create audit log asynchronously (fire and forget)
        (async () => {
          try {
            let resourceInfo = {
              type: 'unknown',
              id: 'unknown',
            };

            if (getResourceInfo) {
              resourceInfo = getResourceInfo(req, data);
            } else if (req.params.id) {
              resourceInfo.id = req.params.id;
              // Infer resource type from URL
              if (req.path.includes('/users/')) {
                resourceInfo.type = 'user';
              } else if (req.path.includes('/suppliers/')) {
                resourceInfo.type = 'supplier';
              } else if (req.path.includes('/packages/')) {
                resourceInfo.type = 'package';
              } else if (req.path.includes('/reviews/')) {
                resourceInfo.type = 'review';
              }
            }

            await createAuditLog({
              actor: {
                id: req.user.id,
                email: req.user.email,
                role: req.user.role,
              },
              action,
              resource: resourceInfo,
              changes: req.body.changes || null,
              ipAddress: req.ip || req.connection?.remoteAddress,
              userAgent: req.get('user-agent'),
              details: {
                body: req.body,
                query: req.query,
                params: req.params,
              },
            });
          } catch (error) {
            logger.error('Audit middleware error', {
              error: error.message,
              action,
            });
          }
        })();
      }

      return originalJson(data);
    };

    next();
  };
}

module.exports = {
  createAuditLog,
  queryAuditLogs,
  getAuditLogById,
  getUserAuditLogs,
  getAuditStatistics,
  formatAuditLog,
  auditMiddleware,
};
