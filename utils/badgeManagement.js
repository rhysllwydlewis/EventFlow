/**
 * Badge Management and Automated Issuance
 * Handles automated badge awarding based on supplier performance metrics
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('./logger');

/**
 * Badge type definitions with auto-award criteria
 */
const BADGE_DEFINITIONS = {
  FAST_RESPONDER: {
    id: 'fast-responder',
    name: 'Fast Responder',
    slug: 'fast-responder',
    type: 'custom',
    description: 'Responds to enquiries within 24 hours',
    icon: '⚡',
    color: '#F59E0B',
    autoAssign: true,
    autoAssignCriteria: {
      avgResponseTime: { lt: 24 }, // Less than 24 hours
      minMessages: 5, // Must have at least 5 messages
    },
    displayOrder: 5,
  },
  TOP_RATED: {
    id: 'top-rated',
    name: 'Top Rated',
    slug: 'top-rated',
    type: 'custom',
    description: 'Maintains an average rating of 4.5 stars or higher',
    icon: '🌟',
    color: '#EAB308',
    autoAssign: true,
    autoAssignCriteria: {
      avgRating: { gte: 4.5 }, // Greater than or equal to 4.5
      minReviews: 3, // Must have at least 3 reviews
    },
    displayOrder: 4,
  },
  EXPERT: {
    id: 'expert',
    name: 'Expert',
    slug: 'expert',
    type: 'custom',
    description: 'Has successfully completed over 50 events',
    icon: '🎓',
    color: '#8B5CF6',
    autoAssign: true,
    autoAssignCriteria: {
      completedEvents: { gt: 50 }, // Greater than 50
    },
    displayOrder: 3,
  },
  VERIFIED: {
    id: 'verified',
    name: 'Verified',
    slug: 'verified',
    type: 'verified',
    description: 'Verified supplier with confirmed business details',
    icon: '✓',
    color: '#10B981',
    autoAssign: false,
    displayOrder: 2,
  },
  FEATURED: {
    id: 'featured',
    name: 'Featured',
    slug: 'featured',
    type: 'featured',
    description: 'Featured supplier on the platform',
    icon: '⭐',
    color: '#F59E0B',
    autoAssign: false,
    displayOrder: 1,
  },
  FOUNDING: {
    id: 'founding',
    name: 'Founding Supplier',
    slug: 'founding',
    type: 'founding',
    description: 'Early supporter and founding supplier',
    icon: '⭐',
    color: '#f59e0b',
    autoAssign: false,
    displayOrder: 0,
  },
};

/**
 * Initialize default badges in the database if they don't exist
 * @returns {Promise<void>}
 */
async function initializeDefaultBadges() {
  try {
    const badges = await dbUnified.read('badges');
    const insertPromises = [];

    for (const badgeDef of Object.values(BADGE_DEFINITIONS)) {
      const exists = badges.find(b => b.id === badgeDef.id);
      if (!exists) {
        const badge = {
          ...badgeDef,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        insertPromises.push(dbUnified.insertOne('badges', badge));
        logger.info(`✓ Initialized badge: ${badge.name}`);
      }
    }

    await Promise.all(insertPromises);
  } catch (error) {
    logger.error('Error initializing default badges:', error);
  }
}

/**
 * Check if a supplier meets the criteria for a specific badge
 * @param {Object} supplier - Supplier object
 * @param {Object} criteria - Badge criteria
 * @param {Object} stats - Additional stats (messages, reviews, etc.)
 * @returns {boolean}
 */
function meetsCriteria(supplier, criteria, stats = {}) {
  for (const [field, condition] of Object.entries(criteria)) {
    // Handle min thresholds
    if (field.startsWith('min')) {
      const dataField = field.replace('min', '').toLowerCase();
      const value = stats[dataField] || 0;
      if (value < condition) {
        return false;
      }
      continue;
    }

    // Get value from supplier or stats
    const value = supplier[field] !== undefined ? supplier[field] : stats[field];

    if (value === undefined) {
      return false;
    }

    // Handle different comparison operators
    if (typeof condition === 'object') {
      if (condition.gt !== undefined && value <= condition.gt) {
        return false;
      }
      if (condition.gte !== undefined && value < condition.gte) {
        return false;
      }
      if (condition.lt !== undefined && value >= condition.lt) {
        return false;
      }
      if (condition.lte !== undefined && value > condition.lte) {
        return false;
      }
      if (condition.eq !== undefined && value !== condition.eq) {
        return false;
      }
    } else {
      // Direct comparison
      if (value !== condition) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Calculate supplier stats for badge evaluation
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>}
 */
async function calculateSupplierStats(supplierId) {
  try {
    const messages = await dbUnified.read('messages');
    const reviews = await dbUnified.read('reviews');
    const threads = await dbUnified.read('threads');
    const suppliers = await dbUnified.read('suppliers');

    // Get supplier data
    const supplier = suppliers.find(s => s.id === supplierId);

    // Calculate message stats based on actual conversation flow
    const supplierThreads = threads.filter(t => t.supplierId === supplierId);
    let totalCustomerMessages = 0;
    // Track responded messages for future response rate calculation
    // eslint-disable-next-line no-unused-vars
    let respondedToCustomerMessages = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    for (const thread of supplierThreads) {
      const threadMessages = messages
        .filter(m => m.threadId === thread.id && !m.isDraft)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      // Track customer messages and supplier responses
      for (let i = 0; i < threadMessages.length; i++) {
        const msg = threadMessages[i];

        // If this is a customer message
        if (msg.fromUserId === thread.customerId) {
          totalCustomerMessages++;

          // Check if supplier responded to this message (look for next non-customer message)
          const supplierResponse = threadMessages
            .slice(i + 1)
            .find(m => m.fromUserId !== thread.customerId);

          if (supplierResponse) {
            // eslint-disable-next-line no-unused-vars
            respondedToCustomerMessages++;

            // Calculate response time
            const responseTime = new Date(supplierResponse.createdAt) - new Date(msg.createdAt);
            totalResponseTime += responseTime;
            responseCount++;
          }
        }
      }
    }

    // Calculate average response time (in hours)
    let avgResponseTime = 0;
    if (responseCount > 0) {
      avgResponseTime = totalResponseTime / responseCount / (1000 * 60 * 60);
    }

    // Calculate review stats
    const supplierReviews = reviews.filter(
      r => r.supplierId === supplierId && r.moderation?.state === 'approved'
    );

    let avgRating = 0;
    if (supplierReviews.length > 0) {
      const totalRating = supplierReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
      avgRating = totalRating / supplierReviews.length;
    }

    return {
      messages: totalCustomerMessages,
      reviews: supplierReviews.length,
      avgResponseTime,
      avgRating,
      completedEvents: supplier?.completedEvents || 0, // Get from supplier record
    };
  } catch (error) {
    logger.error('Error calculating supplier stats:', error);
    return {
      messages: 0,
      reviews: 0,
      avgResponseTime: 0,
      avgRating: 0,
      completedEvents: 0,
    };
  }
}

/**
 * Evaluate and award badges to a supplier
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} - { awarded: [], revoked: [] }
 */
async function evaluateSupplierBadges(supplierId) {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const badges = await dbUnified.read('badges');
    const supplierIndex = suppliers.findIndex(s => s.id === supplierId);

    if (supplierIndex === -1) {
      throw new Error('Supplier not found');
    }

    const supplier = suppliers[supplierIndex];
    const stats = await calculateSupplierStats(supplierId);

    // Get auto-assignable badges
    const autoAssignBadges = badges.filter(b => b.autoAssign && b.active);

    // Initialize badges array if not exists
    if (!supplier.badges) {
      supplier.badges = [];
    }

    const awarded = [];
    const revoked = [];

    for (const badge of autoAssignBadges) {
      const hasBadge = supplier.badges.includes(badge.id);
      const meetsRequirements = meetsCriteria(supplier, badge.autoAssignCriteria, stats);

      if (meetsRequirements && !hasBadge) {
        // Award badge
        supplier.badges.push(badge.id);
        awarded.push(badge.id);
        logger.info(`✓ Awarded badge "${badge.name}" to supplier ${supplier.name}`);
      } else if (!meetsRequirements && hasBadge) {
        // Revoke badge if no longer meets criteria
        supplier.badges = supplier.badges.filter(b => b !== badge.id);
        revoked.push(badge.id);
        logger.info(`✗ Revoked badge "${badge.name}" from supplier ${supplier.name}`);
      }
    }

    // Update supplier if badges changed
    if (awarded.length > 0 || revoked.length > 0) {
      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: { badges: supplier.badges },
        }
      );
    }

    return { awarded, revoked };
  } catch (error) {
    logger.error('Error evaluating supplier badges:', error);
    throw error;
  }
}

/**
 * Evaluate badges for all suppliers
 * @returns {Promise<Object>} - Summary of results
 */
async function evaluateAllSupplierBadges() {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const results = {
      total: suppliers.length,
      evaluated: 0,
      awarded: 0,
      revoked: 0,
      errors: 0,
    };

    for (const supplier of suppliers) {
      try {
        const { awarded, revoked } = await evaluateSupplierBadges(supplier.id);
        results.evaluated++;
        results.awarded += awarded.length;
        results.revoked += revoked.length;
      } catch (error) {
        logger.error(`Error evaluating badges for supplier ${supplier.id}:`, error);
        results.errors++;
      }
    }

    return results;
  } catch (error) {
    logger.error('Error evaluating all supplier badges:', error);
    throw error;
  }
}

module.exports = {
  BADGE_DEFINITIONS,
  initializeDefaultBadges,
  evaluateSupplierBadges,
  evaluateAllSupplierBadges,
  calculateSupplierStats,
};
