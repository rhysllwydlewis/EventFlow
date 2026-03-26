/**
 * User Service
 * Handles user management operations
 */

'use strict';

const bcrypt = require('bcryptjs');
const { NotFoundError, ValidationError, AuthorizationError } = require('../errors');
const { passwordOk } = require('../middleware/validation');
const logger = require('../utils/logger');
const { paginationHelper } = require('../utils/database');
const partnerService = require('./partnerService');

class UserService {
  constructor(dbUnified, uid) {
    this.db = dbUnified;
    this.uid = uid;
  }

  /**
   * Get user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object>} - User data (sanitized)
   */
  async getUserById(id) {
    const users = await this.db.read('users');
    const user = users.find(u => u.id === id);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this._sanitizeUser(user);
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object>} - User data (sanitized)
   */
  async getUserByEmail(email) {
    const users = await this.db.read('users');
    const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return this._sanitizeUser(user);
  }

  /**
   * Update user profile
   * @param {string} id - User ID
   * @param {Object} updates - Profile updates
   * @param {string} requestUserId - ID of user making the request
   * @param {string} requestUserRole - Role of user making the request
   * @returns {Promise<Object>} - Updated user
   */
  async updateUser(id, updates, requestUserId, requestUserRole) {
    const user = await this.db.findOne('users', { id });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Authorization check
    if (requestUserRole !== 'admin' && requestUserId !== id) {
      throw new AuthorizationError('You do not have permission to update this user');
    }

    // Allowed fields for regular users
    const allowedFields = [
      'firstName',
      'lastName',
      'name',
      'location',
      'postcode',
      'company',
      'jobTitle',
      'website',
      'socials',
      'avatarUrl',
      'notify_account',
      'notify_marketing',
    ];

    // Admins can update role
    if (requestUserRole === 'admin') {
      allowedFields.push('role', 'verified', 'isPro');
    }

    // Build the $set payload from allowed fields
    const setFields = {};
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        setFields[field] = updates[field];
      }
    });

    // Update full name if firstName/lastName changed
    if (updates.firstName || updates.lastName) {
      setFields.name =
        `${updates.firstName || user.firstName || ''} ${updates.lastName || user.lastName || ''}`.trim();
    }

    setFields.updatedAt = new Date().toISOString();
    await this.db.updateOne('users', { id }, { $set: setFields });

    logger.info(`User updated: ${id} by ${requestUserId}`);

    return this._sanitizeUser({ ...user, ...setFields });
  }

  /**
   * Change user password
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<void>}
   */
  async changePassword(userId, currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
      throw new ValidationError('Current and new passwords are required');
    }

    if (!passwordOk(newPassword)) {
      throw new ValidationError('Weak password');
    }

    const user = await this.db.findOne('users', { id: userId });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new ValidationError('Current password is incorrect');
    }

    // Update password
    const newHash = await bcrypt.hash(newPassword, 10);
    await this.db.updateOne(
      'users',
      { id: userId },
      { $set: { passwordHash: newHash, updatedAt: new Date().toISOString() } }
    );

    logger.info(`Password changed for user ${userId}`);
  }

  /**
   * Delete user account
   * @param {string} id - User ID
   * @param {string} requestUserId - ID of user making the request
   * @param {string} requestUserRole - Role of user making the request
   * @returns {Promise<void>}
   */
  async deleteUser(id, requestUserId, requestUserRole) {
    // Only admins or the user themselves can delete
    if (requestUserRole !== 'admin' && requestUserId !== id) {
      throw new AuthorizationError('You do not have permission to delete this user');
    }

    const user = await this.db.findOne('users', { id });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Remove user
    await this.db.deleteOne('users', id);

    // Soft-delete any associated partner record to preserve audit trail
    try {
      await partnerService.softDeletePartnerByUserId(id);
    } catch (partnerErr) {
      logger.warn(`Could not soft-delete partner record for user ${id}:`, partnerErr);
    }

    logger.info(`User deleted: ${id} by ${requestUserId}`);
  }

  /**
   * List users with filters and pagination
   * @param {Object} filters - Search filters
   * @param {string} requestUserRole - Role of user making the request
   * @returns {Promise<Object>} - User list and pagination
   */
  async listUsers(filters = {}, requestUserRole) {
    // Only admins can list all users
    if (requestUserRole !== 'admin') {
      throw new AuthorizationError('Admin access required');
    }

    let users = await this.db.read('users');

    // Apply filters
    if (filters.role) {
      users = users.filter(u => u.role === filters.role);
    }

    if (filters.verified !== undefined) {
      users = users.filter(u => u.verified === filters.verified);
    }

    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      users = users.filter(
        u =>
          u.email.toLowerCase().includes(searchTerm) ||
          (u.name && u.name.toLowerCase().includes(searchTerm)) ||
          (u.company && u.company.toLowerCase().includes(searchTerm))
      );
    }

    // Sort
    users.sort((a, b) => {
      const aDate = new Date(a.createdAt);
      const bDate = new Date(b.createdAt);
      return bDate - aDate;
    });

    // Pagination
    const { skip, limit, page } = paginationHelper(filters.page, filters.limit);
    const total = users.length;
    const paginatedUsers = users.slice(skip, skip + limit).map(u => this._sanitizeUser(u));

    return {
      users: paginatedUsers,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    };
  }

  /**
   * Update user preferences
   * @param {string} userId - User ID
   * @param {Object} preferences - Preferences to update
   * @returns {Promise<Object>} - Updated user
   */
  async updatePreferences(userId, preferences) {
    const user = await this.db.findOne('users', { id: userId });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Build preference update set
    const setFields = {};
    if (preferences.notify_account !== undefined) {
      setFields.notify_account = !!preferences.notify_account;
    }
    if (preferences.notify_marketing !== undefined) {
      setFields.notify_marketing = !!preferences.notify_marketing;
      setFields.marketingOptIn = !!preferences.notify_marketing; // Keep legacy field in sync
    }

    setFields.updatedAt = new Date().toISOString();
    await this.db.updateOne('users', { id: userId }, { $set: setFields });

    logger.info(`Preferences updated for user ${userId}`);

    return this._sanitizeUser({ ...user, ...setFields });
  }

  /**
   * Remove sensitive fields from user object
   * @private
   */
  _sanitizeUser(user) {
    const sanitized = { ...user };
    delete sanitized.passwordHash;
    delete sanitized.resetToken;
    delete sanitized.resetTokenExpiresAt;
    delete sanitized.verificationToken;
    delete sanitized.verificationTokenExpiresAt;
    return sanitized;
  }
}

module.exports = UserService;
