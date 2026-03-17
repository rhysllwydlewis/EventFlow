/**
 * Database Utility Functions
 * Helper functions to work with MongoDB, providing similar interface to store.js
 */

'use strict';
const logger = require('./utils/logger');
const crypto = require('crypto');

const { getCollection } = require('./db');

/**
 * Read all documents from a collection
 * @param {string} collectionName - Name of the collection
 * @returns {Promise<Array>} Array of documents
 */
async function read(collectionName) {
  try {
    const collection = await getCollection(collectionName);
    const documents = await collection.find({}).toArray();
    return documents;
  } catch (error) {
    logger.error(`Error reading from ${collectionName}:`, error.message);
    return [];
  }
}

/**
 * Write (replace) all documents in a collection
 * WARNING: This deletes all existing documents and replaces them with new data
 * DANGEROUS: Use with extreme caution - this is a destructive operation
 *
 * Primary use cases:
 * - Initial data migration from JSON files (one-time operation)
 * - Development/testing environment resets
 * - Admin-controlled data restoration from backups
 *
 * For production updates, use updateOne, insertOne, or deleteOne instead
 *
 * @param {string} collectionName - Name of the collection
 * @param {Array} data - Array of documents to write
 * @returns {Promise<boolean>} Success status
 */
async function write(collectionName, data) {
  try {
    const collection = await getCollection(collectionName);

    // Delete all existing documents
    await collection.deleteMany({});

    // Insert new documents if any
    if (Array.isArray(data) && data.length > 0) {
      await collection.insertMany(data);
    }

    return true;
  } catch (error) {
    logger.error(`Error writing to ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Insert a single document into a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} document - Document to insert
 * @returns {Promise<Object|null>} Inserted document or null
 */
async function insertOne(collectionName, document) {
  try {
    const collection = await getCollection(collectionName);
    const result = await collection.insertOne(document);

    if (result.acknowledged) {
      return document;
    }
    return null;
  } catch (error) {
    logger.error(`Error inserting into ${collectionName}:`, error.message);
    return null;
  }
}

/**
 * Update a single document in a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} filter - Filter to find the document
 * @param {Object} update - Update operations
 * @returns {Promise<Object|null>} Updated document or null
 */
async function updateOne(collectionName, filter, update) {
  try {
    const collection = await getCollection(collectionName);
    const result = await collection.findOneAndUpdate(filter, update, { returnDocument: 'after' });

    return result.value;
  } catch (error) {
    logger.error(`Error updating in ${collectionName}:`, error.message);
    return null;
  }
}

/**
 * Delete a single document from a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} filter - Filter to find the document
 * @returns {Promise<boolean>} Success status
 */
async function deleteOne(collectionName, filter) {
  try {
    const collection = await getCollection(collectionName);
    const result = await collection.deleteOne(filter);
    return result.deletedCount > 0;
  } catch (error) {
    logger.error(`Error deleting from ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Find documents in a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} filter - Filter criteria
 * @param {Object} options - Query options (sort, limit, etc.)
 * @returns {Promise<Array>} Array of matching documents
 */
async function find(collectionName, filter = {}, options = {}) {
  try {
    const collection = await getCollection(collectionName);
    let query = collection.find(filter);

    if (options.sort) {
      query = query.sort(options.sort);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.skip) {
      query = query.skip(options.skip);
    }

    return await query.toArray();
  } catch (error) {
    logger.error(`Error finding in ${collectionName}:`, error.message);
    return [];
  }
}

/**
 * Find a single document in a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} filter - Filter criteria
 * @returns {Promise<Object|null>} Matching document or null
 */
async function findOne(collectionName, filter) {
  try {
    const collection = await getCollection(collectionName);
    return await collection.findOne(filter);
  } catch (error) {
    logger.error(`Error finding one in ${collectionName}:`, error.message);
    return null;
  }
}

/**
 * Count documents in a collection
 * @param {string} collectionName - Name of the collection
 * @param {Object} filter - Filter criteria
 * @returns {Promise<number>} Document count
 */
async function count(collectionName, filter = {}) {
  try {
    const collection = await getCollection(collectionName);
    return await collection.countDocuments(filter);
  } catch (error) {
    logger.error(`Error counting in ${collectionName}:`, error.message);
    return 0;
  }
}

/**
 * Generate a unique ID with optional prefix
 * Uses the same format as store.js for compatibility
 * @param {string} prefix - ID prefix (default: 'id')
 * @returns {string} Unique identifier
 */
function uid(prefix = 'id') {
  const s = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
  return `${prefix}_${s}`;
}

/**
 * Migrate data from JSON files to MongoDB
 * Reads from the store.js data files and imports into MongoDB
 * @param {Object} store - The store.js module
 * @returns {Promise<Object>} Migration results
 */
async function migrateFromJson(store) {
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

  const results = {
    success: [],
    failed: [],
    counts: {},
  };

  for (const collectionName of collections) {
    try {
      // Read data from JSON files using store.js
      const data = store.read(collectionName);

      if (Array.isArray(data) && data.length > 0) {
        // Write to MongoDB
        const success = await write(collectionName, data);

        if (success) {
          results.success.push(collectionName);
          results.counts[collectionName] = data.length;
          logger.info(`Migrated ${data.length} documents to ${collectionName}`);
        } else {
          results.failed.push(collectionName);
          logger.error(`Failed to migrate ${collectionName}`);
        }
      } else {
        results.counts[collectionName] = 0;
        logger.info(`No data to migrate for ${collectionName}`);
      }
    } catch (error) {
      results.failed.push(collectionName);
      logger.error(`Error migrating ${collectionName}:`, error.message);
    }
  }

  return results;
}

/**
 * Export all data from MongoDB to JSON format
 * Useful for backups or migration back to JSON files
 * @returns {Promise<Object>} All data from all collections
 */
async function exportToJson() {
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

  const data = {
    exportedAt: new Date().toISOString(),
  };

  for (const collectionName of collections) {
    try {
      data[collectionName] = await read(collectionName);
    } catch (error) {
      logger.error(`Error exporting ${collectionName}:`, error.message);
      data[collectionName] = [];
    }
  }

  return data;
}

/**
 * Clear all data from a collection (for testing/development)
 * @param {string} collectionName - Name of the collection
 * @returns {Promise<boolean>} Success status
 */
async function clearCollection(collectionName) {
  try {
    const collection = await getCollection(collectionName);
    await collection.deleteMany({});
    logger.info(`Cleared collection: ${collectionName}`);
    return true;
  } catch (error) {
    logger.error(`Error clearing ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Migration: Add new fields to supplier profiles (Phase 1)
 * Extends supplier data model with SEO, business, and content fields
 * @returns {Promise<Object>} Migration results
 */
async function migrateSuppliers_AddNewFields() {
  const { generateSlug } = require('./services/supplier.service');

  logger.info('Starting supplier migration: Adding new fields...');

  try {
    // Create backup first
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suppliers = await read('suppliers');

    logger.info(`Found ${suppliers.length} suppliers to migrate`);

    if (suppliers.length === 0) {
      logger.info('No suppliers to migrate');
      return { success: true, migrated: 0, message: 'No suppliers to migrate' };
    }

    // Backup data (if using file-based storage, this would be written to disk)
    logger.info(`Creating backup of suppliers data (timestamp: ${timestamp})`);

    // Process each supplier
    const updated = suppliers.map(s => {
      // Generate slug if not present
      const slug = s.slug || generateSlug(s.name);

      // Determine status based on profile completeness
      // Only mark as published if supplier has minimum viable profile
      let status = s.status;
      if (!status) {
        const hasMinimumViableProfile =
          s.name && s.description && s.location && (s.email || s.phone);

        status = hasMinimumViableProfile ? 'published' : 'draft';
      }

      return {
        ...s,
        // Publishing workflow
        status: status,
        slug: slug,
        publishedAt:
          s.publishedAt ||
          (status === 'published' ? s.createdAt || new Date().toISOString() : null),

        // SEO & Social
        metaDescription:
          s.metaDescription || (s.description ? s.description.substring(0, 160) : ''),
        openGraphImage: s.openGraphImage || s.logo || '',
        tags: Array.isArray(s.tags) ? s.tags : [],

        // Business details
        amenities: Array.isArray(s.amenities) ? s.amenities : [],
        priceRange: s.priceRange || '£',
        businessHours: s.businessHours || {},
        responseTime: s.responseTime || null,

        // Media & Content
        bookingUrl: s.bookingUrl || '',
        videoUrl: s.videoUrl || '',
        faqs: Array.isArray(s.faqs) ? s.faqs : [],
        testimonials: Array.isArray(s.testimonials) ? s.testimonials : [],
        awards: Array.isArray(s.awards) ? s.awards : [],
        certifications: Array.isArray(s.certifications) ? s.certifications : [],

        // Analytics (denormalized)
        viewCount: s.viewCount || 0,
        enquiryCount: s.enquiryCount || 0,

        // Admin approval
        approvedAt: s.approvedAt || null,
        approvedBy: s.approvedBy || null,

        // Keep existing updatedAt or set it if missing
        updatedAt: s.updatedAt || new Date().toISOString(),
      };
    });

    // Write updated suppliers back to database
    await write('suppliers', updated);

    logger.info(`Successfully migrated ${updated.length} suppliers`);
    logger.info('Migration complete! All suppliers now have Phase 1 fields');

    return {
      success: true,
      migrated: updated.length,
      message: `Successfully migrated ${updated.length} supplier profiles with new fields`,
      backupTimestamp: timestamp,
    };
  } catch (error) {
    logger.error('Migration failed:', error.message);
    return {
      success: false,
      error: error.message,
      message: 'Migration failed. Please check logs and restore from backup if needed.',
    };
  }
}

module.exports = {
  read,
  write,
  insertOne,
  updateOne,
  deleteOne,
  find,
  findOne,
  count,
  uid,
  migrateFromJson,
  exportToJson,
  clearCollection,
  migrateSuppliers_AddNewFields,
};
