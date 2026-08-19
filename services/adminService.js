/**
 * Admin Service
 * Business logic for all admin operations
 * Provides data aggregation, batch operations, and metrics
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { createAuditLog } = require('../utils/auditTrail');
const { approvalDecision } = require('./seoRecordLifecycle.util');

/**
 * Get dashboard overview statistics
 * @returns {Promise<Object>} Dashboard overview data
 */
async function getDashboardOverview() {
  try {
    const [users, suppliers, packages, reviews, auditLogs] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('reviews'),
      dbUnified.read('audit_logs'),
    ]);

    // Calculate time-based metrics
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const newUsers7Days = users.filter(
      u => u.createdAt && new Date(u.createdAt) >= last7Days
    ).length;
    const newUsers30Days = users.filter(
      u => u.createdAt && new Date(u.createdAt) >= last30Days
    ).length;

    // Active users (logged in within last 30 days)
    const activeUsers = users.filter(
      u => u.lastLoginAt && new Date(u.lastLoginAt) >= last30Days
    ).length;

    // Suppliers statistics
    const approvedSuppliers = suppliers.filter(s => s.approved).length;
    const pendingSuppliers = suppliers.filter(s => !s.approved).length;
    const proSuppliers = suppliers.filter(s => s.isPro || s.proExpiresAt).length;

    // Packages statistics
    const approvedPackages = packages.filter(p => p.approved).length;
    const pendingPackages = packages.filter(p => !p.approved).length;
    const featuredPackages = packages.filter(p => p.featured).length;

    // Reviews statistics
    const approvedReviews = reviews.filter(r => r.status === 'approved').length;
    const pendingReviews = reviews.filter(r => r.status === 'pending' || r.flagged).length;

    // Recent activity from audit logs
    const recentActivity = auditLogs
      .filter(log => new Date(log.timestamp) >= last7Days)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map(log => ({
        action: log.action,
        actor: log.actor?.email || 'unknown',
        resource: `${log.resource?.type || 'unknown'}:${log.resource?.id || 'unknown'}`,
        timestamp: log.timestamp,
      }));

    return {
      success: true,
      data: {
        users: {
          total: users.length,
          active: activeUsers,
          newLast7Days: newUsers7Days,
          newLast30Days: newUsers30Days,
          verified: users.filter(u => u.verified).length,
          admins: users.filter(u => u.role === 'admin').length,
        },
        suppliers: {
          total: suppliers.length,
          approved: approvedSuppliers,
          pending: pendingSuppliers,
          pro: proSuppliers,
        },
        packages: {
          total: packages.length,
          approved: approvedPackages,
          pending: pendingPackages,
          featured: featuredPackages,
        },
        reviews: {
          total: reviews.length,
          approved: approvedReviews,
          pending: pendingReviews,
        },
        activity: {
          recentActions: recentActivity,
          totalActionsLast7Days: auditLogs.filter(log => new Date(log.timestamp) >= last7Days)
            .length,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get dashboard overview', { error: error.message });
    throw error;
  }
}

/**
 * Get detailed metrics
 * @returns {Promise<Object>} Detailed metrics data
 */
async function getDetailedMetrics() {
  try {
    const [users, suppliers, packages, reviews] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('reviews'),
    ]);

    // User metrics by role
    const usersByRole = users.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    // User metrics by month (last 12 months)
    const userSignupsByMonth = {};
    const last12Months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }).reverse();

    last12Months.forEach(month => {
      userSignupsByMonth[month] = users.filter(u => {
        if (!u.createdAt) {
          return false;
        }
        const userMonth = u.createdAt.substring(0, 7);
        return userMonth === month;
      }).length;
    });

    // Supplier metrics by category
    const suppliersByCategory = suppliers.reduce((acc, supplier) => {
      const category = supplier.category || 'Uncategorized';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    // Package metrics - count packages per supplier
    const avgPackagesPerSupplier = suppliers.length > 0 ? packages.length / suppliers.length : 0;

    // Review metrics
    const avgReviewsPerSupplier = suppliers.length > 0 ? reviews.length / suppliers.length : 0;

    const reviewsByRating = reviews.reduce((acc, review) => {
      const rating = review.rating || 0;
      acc[rating] = (acc[rating] || 0) + 1;
      return acc;
    }, {});

    return {
      success: true,
      data: {
        users: {
          byRole: usersByRole,
          signupsByMonth: userSignupsByMonth,
          verificationRate:
            users.length > 0 ? (users.filter(u => u.verified).length / users.length) * 100 : 0,
        },
        suppliers: {
          byCategory: suppliersByCategory,
          approvalRate:
            suppliers.length > 0
              ? (suppliers.filter(s => s.approved).length / suppliers.length) * 100
              : 0,
        },
        packages: {
          avgPerSupplier: avgPackagesPerSupplier.toFixed(2),
          total: packages.length,
        },
        reviews: {
          avgPerSupplier: avgReviewsPerSupplier.toFixed(2),
          byRating: reviewsByRating,
          total: reviews.length,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get detailed metrics', { error: error.message });
    throw error;
  }
}

/**
 * Batch approve items (packages, suppliers, reviews, etc.)
 * @param {Object} params - Batch operation parameters
 * @param {string} params.type - Type of items to approve ('packages', 'suppliers', 'reviews')
 * @param {string[]} params.ids - Array of item IDs to approve
 * @param {Object} params.actor - Actor performing the operation
 * @returns {Promise<Object>} Batch operation result
 */
async function batchApprove(params) {
  const { type, ids, actor } = params;

  if (!type || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Invalid batch approve parameters');
  }

  try {
    let collection;
    let actionType;

    switch (type) {
      case 'packages':
        collection = 'packages';
        actionType = 'BATCH_PACKAGES_APPROVED';
        break;
      case 'suppliers':
        collection = 'suppliers';
        actionType = 'BATCH_SUPPLIERS_APPROVED';
        break;
      case 'reviews':
        collection = 'reviews';
        actionType = 'BATCH_REVIEWS_APPROVED';
        break;
      default:
        throw new Error(`Unsupported batch approve type: ${type}`);
    }

    const items = await dbUnified.read(collection);
    const updatedIds = [];
    const errors = [];
    const now = new Date().toISOString();

    ids.forEach(id => {
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        const approval = type === 'reviews' ? { allowed: true } : approvalDecision(items[index]);
        if (approval.allowed) {
          updatedIds.push(id);
        } else {
          errors.push({ id, error: 'Fixture approval blocked', code: approval.reason });
        }
      } else {
        errors.push({ id, error: 'Item not found' });
      }
    });

    if (updatedIds.length > 0) {
      const approveFields =
        type === 'reviews'
          ? { status: 'approved', approvedAt: now, approvedBy: actor.id }
          : { approved: true, approvedAt: now, approvedBy: actor.id };
      await Promise.all(
        updatedIds.map(id => dbUnified.updateOne(collection, { id }, { $set: approveFields }))
      );

      // Create audit log
      await createAuditLog({
        actor,
        action: actionType,
        resource: {
          type: type,
          id: 'batch',
        },
        details: {
          approvedIds: updatedIds,
          count: updatedIds.length,
        },
        ipAddress: null,
        userAgent: null,
      });
    }

    return {
      success: true,
      data: {
        approved: updatedIds.length,
        failed: errors.length,
        errors,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Batch approve failed', { error: error.message, type, ids });
    throw error;
  }
}

/**
 * Batch reject items
 * @param {Object} params - Batch operation parameters
 * @param {string} params.type - Type of items to reject
 * @param {string[]} params.ids - Array of item IDs to reject
 * @param {Object} params.actor - Actor performing the operation
 * @param {string} params.reason - Reason for rejection (optional)
 * @returns {Promise<Object>} Batch operation result
 */
async function batchReject(params) {
  const { type, ids, actor, reason = '' } = params;

  if (!type || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Invalid batch reject parameters');
  }

  try {
    let collection;
    let actionType;

    switch (type) {
      case 'packages':
        collection = 'packages';
        actionType = 'BATCH_PACKAGES_REJECTED';
        break;
      case 'suppliers':
        collection = 'suppliers';
        actionType = 'BATCH_SUPPLIERS_REJECTED';
        break;
      case 'reviews':
        collection = 'reviews';
        actionType = 'BATCH_REVIEWS_REJECTED';
        break;
      default:
        throw new Error(`Unsupported batch reject type: ${type}`);
    }

    const items = await dbUnified.read(collection);
    const updatedIds = [];
    const errors = [];
    const now = new Date().toISOString();

    ids.forEach(id => {
      const index = items.findIndex(item => item.id === id);
      if (index !== -1) {
        updatedIds.push(id);
      } else {
        errors.push({ id, error: 'Item not found' });
      }
    });

    if (updatedIds.length > 0) {
      const rejectFields =
        type === 'reviews'
          ? { status: 'rejected', rejectedAt: now, rejectedBy: actor.id, rejectionReason: reason }
          : { approved: false, rejectedAt: now, rejectedBy: actor.id, rejectionReason: reason };
      await Promise.all(
        updatedIds.map(id => dbUnified.updateOne(collection, { id }, { $set: rejectFields }))
      );

      // Create audit log
      await createAuditLog({
        actor,
        action: actionType,
        resource: {
          type: type,
          id: 'batch',
        },
        details: {
          rejectedIds: updatedIds,
          count: updatedIds.length,
          reason,
        },
        ipAddress: null,
        userAgent: null,
      });
    }

    return {
      success: true,
      data: {
        rejected: updatedIds.length,
        failed: errors.length,
        errors,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Batch reject failed', { error: error.message, type, ids });
    throw error;
  }
}

/**
 * Batch delete items
 * @param {Object} params - Batch operation parameters
 * @param {string} params.type - Type of items to delete
 * @param {string[]} params.ids - Array of item IDs to delete
 * @param {Object} params.actor - Actor performing the operation
 * @returns {Promise<Object>} Batch operation result
 */
async function batchDelete(params) {
  const { type, ids, actor } = params;

  if (!type || !Array.isArray(ids) || ids.length === 0) {
    throw new Error('Invalid batch delete parameters');
  }

  try {
    let collection;
    let actionType;

    switch (type) {
      case 'packages':
        collection = 'packages';
        actionType = 'BATCH_PACKAGES_DELETED';
        break;
      case 'suppliers':
        collection = 'suppliers';
        actionType = 'BATCH_SUPPLIERS_DELETED';
        break;
      case 'users':
        collection = 'users';
        actionType = 'BATCH_USERS_DELETED';
        break;
      default:
        throw new Error(`Unsupported batch delete type: ${type}`);
    }

    const items = await dbUnified.read(collection);
    const deletedIds = [];
    const errors = [];

    items.forEach(item => {
      if (ids.includes(item.id)) {
        deletedIds.push(item.id);
      }
    });
    // Check for IDs not found
    ids.forEach(id => {
      if (!deletedIds.includes(id)) {
        errors.push({ id, error: 'Item not found' });
      }
    });

    if (deletedIds.length > 0) {
      await Promise.all(deletedIds.map(id => dbUnified.deleteOne(collection, id)));

      // Create audit log
      await createAuditLog({
        actor,
        action: actionType,
        resource: {
          type: type,
          id: 'batch',
        },
        details: {
          deletedIds,
          count: deletedIds.length,
        },
        ipAddress: null,
        userAgent: null,
      });
    }

    // Track errors for IDs not found
    ids.forEach(id => {
      if (!deletedIds.includes(id)) {
        errors.push({ id, error: 'Item not found' });
      }
    });

    return {
      success: true,
      data: {
        deleted: deletedIds.length,
        failed: errors.length,
        errors,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Batch delete failed', { error: error.message, type, ids });
    throw error;
  }
}

/**
 * Get system health information
 * @returns {Promise<Object>} System health data
 */
async function getSystemHealth() {
  try {
    const dbStatus = dbUnified.getDatabaseStatus();

    // Check data collections
    const [users, suppliers, packages] = await Promise.all([
      dbUnified.read('users'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
    ]);

    return {
      success: true,
      data: {
        database: {
          type: dbStatus.type,
          state: dbStatus.state,
          initialized: dbStatus.initialized,
        },
        collections: {
          users: users.length,
          suppliers: suppliers.length,
          packages: packages.length,
        },
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
        },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get system health', { error: error.message });
    throw error;
  }
}

module.exports = {
  getDashboardOverview,
  getDetailedMetrics,
  batchApprove,
  batchReject,
  batchDelete,
  getSystemHealth,
};
