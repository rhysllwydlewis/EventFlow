'use strict';

/**
 * Read-only data audits for the Ops Assistant (issue #1680).
 *
 * The three audit scripts (`scripts/audit-orphaned-supplier-data.js`,
 * `scripts/audit-marketplace-listing-locations.js` and
 * `scripts/audit-supplier-locations.js`) need a MongoDB connection. The Ops
 * Assistant's sandbox only reaches the internet over HTTPS, so running them
 * there fell back to local file storage and reported "0 findings" without
 * having checked anything. These wrappers run the same audits inside the
 * production server, where the database is connected, and return a trimmed,
 * read-only report over the existing HMAC-protected ops-bot API.
 *
 * Guarantees:
 * - `apply` is always `false`. No record is written, updated or deleted, and
 *   nothing here accepts a flag that could change that.
 * - Only counts, record ids, statuses and short audit reasons are returned. No
 *   user, owner, contact or free-text location fields.
 * - A report that was not read from a healthy MongoDB connection is flagged
 *   `inconclusive: true` so "0 findings" is never mistaken for a clean result.
 */

const dbUnified = require('../db-unified');
const { AUDIT_STATUSES } = require('../models/LocationContent');

const DEFAULT_ROW_LIMIT = 100;
const MAX_ROW_LIMIT = 500;
const MAX_REPORTED_ROWS = 100;

function clampLimit(value, fallback = DEFAULT_ROW_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, MAX_ROW_LIMIT);
}

/**
 * Describe the backend the audit reads from, without (re)initialising it: the
 * server has already connected, so this just reports the live state.
 * @returns {{type: string, connected: boolean, state: string}} Backend summary.
 */
function describeBackend() {
  try {
    const status = (dbUnified.getDatabaseStatus && dbUnified.getDatabaseStatus()) || {};
    return {
      type: status.type || (dbUnified.getDatabaseType ? dbUnified.getDatabaseType() : 'unknown'),
      connected: Boolean(status.connected),
      state: status.state || 'unknown',
    };
  } catch (_error) {
    return { type: 'unknown', connected: false, state: 'unknown' };
  }
}

/**
 * A report is only conclusive when it was read from a connected MongoDB and no
 * read fell back to local storage mid-run.
 * @param {{type: string, connected: boolean}} backend Backend summary.
 * @param {number} readFallbacksBefore Fallback reads counted before the audit.
 * @returns {boolean} True when the result must not be treated as a clean bill.
 */
function isInconclusive(backend, readFallbacksBefore = 0) {
  if (backend.type !== 'mongodb' || !backend.connected) {
    return true;
  }
  if (typeof dbUnified.getReadFallbackCount === 'function') {
    return dbUnified.getReadFallbackCount() > readFallbacksBefore;
  }
  return false;
}

function readFallbackCount() {
  return typeof dbUnified.getReadFallbackCount === 'function'
    ? dbUnified.getReadFallbackCount()
    : 0;
}

const ORPHAN_COUNT_FIELDS = [
  'checkedSuppliers',
  'legacyUnownedSuppliers',
  'orphanSuppliers',
  'orphanPackages',
  'publicOrphanPackages',
  'orphanPhotos',
  'orphanAnalytics',
  'orphanPublicCalendarEvents',
  'orphanMarketplaceListings',
];

/**
 * Orphaned supplier data, dry-run only.
 * @returns {Promise<Object>} Report with counts only.
 */
async function auditOrphanedSupplierData() {
  // Required lazily: the script is also a CLI and this keeps its module-level
  // setup out of server start-up.
  // eslint-disable-next-line global-require
  const script = require('../scripts/audit-orphaned-supplier-data');
  const backend = describeBackend();
  const before = readFallbackCount();

  const summary = await script.auditOrphanedSupplierData({ apply: false, backend });

  const counts = {};
  for (const field of ORPHAN_COUNT_FIELDS) {
    counts[field] = Number(summary[field]) || 0;
  }

  return {
    audit: 'orphaned-supplier-data',
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    backend,
    inconclusive: isInconclusive(backend, before),
    counts,
    errors: Array.isArray(summary.errors) ? summary.errors.slice(0, 5) : [],
  };
}

function reviewRows(rows, idField) {
  const pending = rows.filter(row => row.status && row.status !== AUDIT_STATUSES.alreadyMapped);
  return {
    needsReview: pending.slice(0, MAX_REPORTED_ROWS).map(row => ({
      id: row[idField] || null,
      status: row.status,
      confidence: row.confidence || null,
      reason: row.reason ? String(row.reason).slice(0, 200) : null,
    })),
    // The list is capped, so say how many there really are. Without this a
    // long list would look complete, which is the false all-clear this API
    // exists to prevent.
    needsReviewTotal: pending.length,
    needsReviewTruncated: pending.length > MAX_REPORTED_ROWS,
  };
}

/**
 * Marketplace listing location mapping, dry-run only.
 * @param {Object} [options] Options.
 * @param {number|string} [options.limit] Maximum listings to audit.
 * @returns {Promise<Object>} Report with counts and the items needing a decision.
 */
async function auditMarketplaceListingLocations({ limit } = {}) {
  // eslint-disable-next-line global-require
  const script = require('../scripts/audit-marketplace-listing-locations');
  const backend = describeBackend();
  const before = readFallbackCount();

  const report = await script.run(
    {
      apply: false,
      limit: clampLimit(limit),
      requireMongodb: false,
      confirmProduction: false,
    },
    backend
  );

  return {
    audit: 'marketplace-listing-locations',
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    backend,
    inconclusive: isInconclusive(backend, before),
    totalListings: report.totalListings,
    audited: report.audited,
    truncated: report.audited < report.totalListings,
    counts: report.counts,
    ...reviewRows(report.rows, 'listingId'),
  };
}

/**
 * Supplier base-location mapping, dry-run only.
 * @param {Object} [options] Options.
 * @param {number|string} [options.limit] Maximum suppliers to audit.
 * @returns {Promise<Object>} Report with counts and the items needing a decision.
 */
async function auditSupplierLocations({ limit } = {}) {
  // eslint-disable-next-line global-require
  const script = require('../scripts/audit-supplier-locations');
  const backend = describeBackend();
  const before = readFallbackCount();

  const report = await script.run(
    {
      apply: false,
      limit: clampLimit(limit),
      requireMongodb: false,
      confirmProduction: false,
    },
    backend
  );

  return {
    audit: 'supplier-locations',
    mode: 'dry-run',
    generatedAt: new Date().toISOString(),
    backend,
    inconclusive: isInconclusive(backend, before),
    totalSuppliers: report.totalSuppliers,
    audited: report.audited,
    truncated: report.audited < report.totalSuppliers,
    counts: report.counts,
    ...reviewRows(report.rows, 'supplierId'),
  };
}

module.exports = {
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  MAX_REPORTED_ROWS,
  auditMarketplaceListingLocations,
  auditOrphanedSupplierData,
  auditSupplierLocations,
  clampLimit,
  isInconclusive,
};
