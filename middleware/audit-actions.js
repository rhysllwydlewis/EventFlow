/**
 * Audit action type constants.
 *
 * Kept in a separate file with no side-effect imports so that tests and other
 * modules can import these constants without pulling in the full DB / logger
 * dependency chain from middleware/audit.js.
 */

'use strict';

const AUDIT_ACTIONS = {
  // User management
  USER_CREATED: 'user_created',
  USER_SUSPENDED: 'user_suspended',
  USER_UNSUSPENDED: 'user_unsuspended',
  USER_BANNED: 'user_banned',
  USER_UNBANNED: 'user_unbanned',
  USER_VERIFIED: 'user_verified',
  USER_PASSWORD_RESET: 'user_password_reset',
  USER_ROLE_CHANGED: 'user_role_changed',
  USER_DELETED: 'user_deleted',
  USER_EDITED: 'user_edited',
  RESEND_VERIFICATION: 'resend_verification',

  // Bulk user operations
  BULK_USERS_VERIFIED: 'bulk_users_verified',
  BULK_USERS_SUSPENDED: 'bulk_users_suspended',
  BULK_USERS_UNSUSPENDED: 'bulk_users_unsuspended',

  // Supplier management
  SUPPLIER_APPROVED: 'supplier_approved',
  SUPPLIER_REJECTED: 'supplier_rejected',
  SUPPLIER_VERIFIED: 'supplier_verified',
  SUPPLIER_NEEDS_CHANGES: 'supplier_needs_changes',
  SUPPLIER_SUSPENDED: 'supplier_suspended',
  SUPPLIER_REINSTATED: 'supplier_reinstated',
  SUPPLIER_VERIFICATION_SUBMITTED: 'supplier_verification_submitted',
  SUPPLIER_PRO_GRANTED: 'supplier_pro_granted',
  SUPPLIER_PRO_REVOKED: 'supplier_pro_revoked',
  SUPPLIER_DELETED: 'supplier_deleted',
  SUPPLIER_EDITED: 'supplier_edited',
  SUPPLIER_UPDATED: 'supplier_updated',

  // Package management
  PACKAGE_CREATED: 'package_created',
  PACKAGE_APPROVED: 'package_approved',
  PACKAGE_REJECTED: 'package_rejected',
  PACKAGE_DELETED: 'package_deleted',
  PACKAGE_EDITED: 'package_edited',

  // Bulk package operations
  BULK_PACKAGES_APPROVED: 'bulk_packages_approved',
  BULK_PACKAGES_REJECTED: 'bulk_packages_rejected',
  BULK_PACKAGES_FEATURED: 'bulk_packages_featured',
  BULK_PACKAGES_UNFEATURED: 'bulk_packages_unfeatured',
  BULK_PACKAGES_DELETED: 'bulk_packages_deleted',

  // Content moderation
  REVIEW_APPROVED: 'review_approved',
  REVIEW_REJECTED: 'review_rejected',
  REVIEW_DELETED: 'review_deleted',
  PHOTO_APPROVED: 'photo_approved',
  PHOTO_REJECTED: 'photo_rejected',
  CONTENT_APPROVED: 'content_approved',
  CONTENT_REJECTED: 'content_rejected',

  // Report handling
  REPORT_RESOLVED: 'report_resolved',
  REPORT_DISMISSED: 'report_dismissed',

  // System actions
  DATA_EXPORT: 'data_export',
  SETTINGS_CHANGED: 'settings_changed',
};

module.exports = { AUDIT_ACTIONS };
