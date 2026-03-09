/**
 * Admin User Management Routes
 * Handles user-related admin operations: user listing, search, export, management, and impersonation
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { uid } = require('../store');
const { authRequired, roleRequired } = require('../middleware/auth');
const { auditLog, auditMiddleware, AUDIT_ACTIONS } = require('../middleware/audit');
const { csrfProtection } = require('../middleware/csrf');
const postmark = require('../utils/postmark');
const dbUnified = require('../db-unified');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { passwordOk } = require('../utils/validators');
const domainAdmin = require('../middleware/domain-admin');

const router = express.Router();

// Constants for user management
const VALID_USER_ROLES = ['customer', 'supplier', 'admin'];
const MAX_NAME_LENGTH = 80;

// Helper function to parse duration strings like "7d", "1h", "30m"
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) {
    return 0;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60 * 1000; // days
    case 'h':
      return value * 60 * 60 * 1000; // hours
    case 'm':
      return value * 60 * 1000; // minutes
    default:
      return 0;
  }
}

// Helper function to generate URL-friendly slugs from titles
function generateSlug(title) {
  if (!title) {
    return '';
  }
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check if JWT secret is valid for impersonation
 * @returns {Object|null} Error object if invalid, null if valid
 */
function validateJWTSecret() {
  const JWT_SECRET = process.env.JWT_SECRET;
  const weakSecrets = ['change_me', 'your-secret-key', 'secret', 'password'];

  if (!JWT_SECRET) {
    return {
      error: 'JWT secret not configured',
      message: 'A secure JWT_SECRET environment variable is required',
    };
  }

  if (JWT_SECRET.length < 32) {
    return {
      error: 'JWT secret too short',
      message: 'JWT_SECRET must be at least 32 characters long for security',
    };
  }

  if (weakSecrets.some(weak => JWT_SECRET.toLowerCase().includes(weak))) {
    return {
      error: 'JWT secret contains weak or placeholder values',
      message:
        'JWT_SECRET must not contain common weak values. Generate a secure secret using: openssl rand -base64 32',
    };
  }

  return null;
}

/**
 * GET /api/admin/users
 * List all users (without password hashes)
 */
router.get('/users', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const allUsers = await dbUnified.read('users');
    const users = (allUsers || []).map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      verified: !!u.verified,
      marketingOptIn: !!u.marketingOptIn,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,
      subscription: u.subscription || { tier: 'free', status: 'active' },
    }));
    // Sort newest first by createdAt
    users.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) {
        return 0;
      }
      if (!a.createdAt) {
        return 1;
      }
      if (!b.createdAt) {
        return -1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    res.json({ items: users });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users', items: [] });
  }
});

/**
 * POST /api/admin/users
 * Create a new user (admin only)
 */
router.post('/users', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const { name, email, password, role = 'customer' } = req.body || {};

    // Validate required fields
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: 'Missing required fields: name, email, and password are required' });
    }

    // Validate email format
    if (!validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (!passwordOk(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with uppercase, lowercase, and number',
      });
    }

    // Validate role
    const roleFinal = VALID_USER_ROLES.includes(role) ? role : 'customer';

    // Check if user already exists
    const users = await dbUnified.read('users');
    if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    // Create new user
    const user = {
      id: uid('usr'),
      name: String(name).trim().slice(0, MAX_NAME_LENGTH),
      email: String(email).toLowerCase(),
      role: roleFinal,
      passwordHash: await bcrypt.hash(password, 10),
      notify: true,
      marketingOptIn: false,
      verified: true, // Admin-created users are pre-verified
      createdAt: new Date().toISOString(),
      createdBy: req.user.id, // Track who created the user
    };

    await dbUnified.insertOne('users', user);

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_CREATED,
      targetType: 'user',
      targetId: user.id,
      details: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });

    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        verified: user.verified,
      },
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users/search
 * Advanced user search with filtering
 * Query params: q (search term), role, verified, suspended, startDate, endDate, limit, offset
 */
router.get('/users/search', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const {
      q, // search term
      role,
      verified,
      suspended,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = req.query;

    const dbType = dbUnified.getDatabaseType();

    // For MongoDB, build a filter and use findWithOptions for efficient query
    if (dbType === 'mongodb') {
      // Build MongoDB filter
      const filter = {};

      if (role) {
        filter.role = role;
      }
      if (verified !== undefined) {
        filter.verified = verified === 'true';
      }
      if (suspended !== undefined) {
        filter.suspended = suspended === 'true';
      }
      if (q && q.trim()) {
        // Use MongoDB $or for text search
        const searchTerm = q.trim();
        filter.$or = [
          { email: { $regex: searchTerm, $options: 'i' } },
          { name: { $regex: searchTerm, $options: 'i' } },
        ];
      }

      // Date range filters
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate).toISOString();
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate).toISOString();
        }
      }

      // Get total count with filters
      const total = await dbUnified.count('users', filter);

      // Use findWithOptions with pagination and sorting
      const users = await dbUnified.findWithOptions('users', filter, {
        limit: parseInt(limit, 10),
        skip: parseInt(offset, 10),
        sort: { createdAt: -1 },
      });

      // Remove sensitive data
      const sanitizedUsers = users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        verified: !!u.verified,
        suspended: !!u.suspended,
        marketingOptIn: !!u.marketingOptIn,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
        subscription: u.subscription || { tier: 'free', status: 'active' },
      }));

      res.json({
        items: sanitizedUsers,
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        hasMore: parseInt(offset, 10) + sanitizedUsers.length < total,
      });
    } else {
      // Fallback for local storage - load and filter in memory
      const allUsers = await dbUnified.read('users');

      // Apply filters
      let filteredUsers = allUsers;

      // Search term (email or name)
      if (q && q.trim()) {
        const searchTerm = q.trim().toLowerCase();
        filteredUsers = filteredUsers.filter(
          u =>
            (u.email && u.email.toLowerCase().includes(searchTerm)) ||
            (u.name && u.name.toLowerCase().includes(searchTerm))
        );
      }

      // Role filter
      if (role) {
        filteredUsers = filteredUsers.filter(u => u.role === role);
      }

      // Verified filter
      if (verified !== undefined) {
        const isVerified = verified === 'true' || verified === true;
        filteredUsers = filteredUsers.filter(u => !!u.verified === isVerified);
      }

      // Suspended filter
      if (suspended !== undefined) {
        const isSuspended = suspended === 'true' || suspended === true;
        filteredUsers = filteredUsers.filter(u => !!u.suspended === isSuspended);
      }

      // Date range filter
      if (startDate) {
        const start = new Date(startDate);
        filteredUsers = filteredUsers.filter(u => {
          const createdAt = new Date(u.createdAt);
          return createdAt >= start;
        });
      }

      if (endDate) {
        const end = new Date(endDate);
        filteredUsers = filteredUsers.filter(u => {
          const createdAt = new Date(u.createdAt);
          return createdAt <= end;
        });
      }

      // Sort by createdAt descending
      filteredUsers.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

      // Apply pagination
      const total = filteredUsers.length;
      const startIndex = parseInt(offset, 10) || 0;
      const endIndex = startIndex + (parseInt(limit, 10) || 50);
      const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

      // Remove sensitive data
      const sanitizedUsers = paginatedUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        verified: !!u.verified,
        suspended: !!u.suspended,
        marketingOptIn: !!u.marketingOptIn,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
        subscription: u.subscription || { tier: 'free', status: 'active' },
      }));

      res.json({
        items: sanitizedUsers,
        total,
        limit: parseInt(limit, 10) || 50,
        offset: parseInt(offset, 10) || 0,
        hasMore: endIndex < total,
      });
    }
  } catch (error) {
    logger.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * GET /api/admin/marketing-export
 * Export marketing opt-in users as CSV
 */
router.get('/marketing-export', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const users = (await dbUnified.read('users')).filter(u => u.marketingOptIn);
    const header = 'name,email,role\n';
    const rows = users
      .map(u => {
        const name = (u.name || '').replace(/"/g, '""');
        const email = (u.email || '').replace(/"/g, '""');
        const role = (u.role || '').replace(/"/g, '""');
        return `"${name}","${email}","${role}"`;
      })
      .join('\n');
    const csv = header + rows + (rows ? '\n' : '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eventflow-marketing.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting marketing users:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/users-export
 * Export all users as CSV
 */
router.get('/users-export', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const users = await dbUnified.read('users');
    const header = 'id,name,email,role,verified,marketingOptIn,createdAt,lastLoginAt\n';
    const rows = users
      .map(u => {
        const esc = v => String(v ?? '').replace(/"/g, '""');
        const verified = u.verified ? 'yes' : 'no';
        const marketing = u.marketingOptIn ? 'yes' : 'no';
        return `"${esc(u.id)}","${esc(u.name)}","${esc(u.email)}","${esc(u.role)}","${verified}","${marketing}","${esc(u.createdAt)}","${esc(u.lastLoginAt || '')}"`;
      })
      .join('\n');
    const csv = header + rows + (rows ? '\n' : '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eventflow-users.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting users:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- User Management ----------

/**
 * POST /api/admin/users/:id/suspend
 * Suspend or unsuspend a user account
 * Body: { suspended: boolean, reason: string, duration: string }
 */
router.post(
  '/users/:id/suspend',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { suspended, reason, duration } = req.body;
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    // Prevent admins from suspending themselves
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot suspend your own account' });
    }

    // ⚠️ SECURITY: Prevent suspension of the owner account
    const isOwner = domainAdmin.isOwnerEmail(user.email) || user.isOwner;
    if (isOwner) {
      return res.status(403).json({
        error: 'Cannot suspend owner account',
        message: 'The owner account is protected and cannot be suspended.',
        code: 'OWNER_ACCOUNT_PROTECTED',
      });
    }

    const setFields = {
      suspended: !!suspended,
      suspendedAt: suspended ? now : null,
      suspendedBy: suspended ? req.user.id : null,
      suspensionReason: suspended ? reason || 'No reason provided' : null,
      suspensionDuration: suspended ? duration : null,
      suspensionExpiresAt: null,
      updatedAt: now,
    };

    // Calculate expiry if duration is provided
    if (suspended && duration) {
      const durationMs = parseDuration(duration);
      if (durationMs > 0) {
        setFields.suspensionExpiresAt = new Date(Date.now() + durationMs).toISOString();
      }
    }

    await dbUnified.updateOne('users', { id: user.id }, { $set: setFields });

    // Create audit log (requiring audit.js)
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: suspended ? AUDIT_ACTIONS.USER_SUSPENDED : AUDIT_ACTIONS.USER_UNSUSPENDED,
      targetType: 'user',
      targetId: user.id,
      details: { reason, duration, email: user.email },
    });

    res.json({
      message: suspended ? 'User suspended successfully' : 'User unsuspended successfully',
      user: {
        id: user.id,
        email: user.email,
        suspended: setFields.suspended,
        suspensionReason: setFields.suspensionReason,
      },
    });
  }
);

/**
 * POST /api/admin/users/:id/ban
 * Ban or unban a user permanently
 * Body: { banned: boolean, reason: string }
 */
router.post(
  '/users/:id/ban',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { banned, reason } = req.body;
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    // Prevent admins from banning themselves
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot ban your own account' });
    }

    // ⚠️ SECURITY: Prevent banning of the owner account
    const isOwner = domainAdmin.isOwnerEmail(user.email) || user.isOwner;
    if (isOwner) {
      return res.status(403).json({
        error: 'Cannot ban owner account',
        message: 'The owner account is protected and cannot be banned.',
        code: 'OWNER_ACCOUNT_PROTECTED',
      });
    }

    const setFields = {
      banned: !!banned,
      bannedAt: banned ? now : null,
      bannedBy: banned ? req.user.id : null,
      banReason: banned ? reason || 'No reason provided' : null,
      updatedAt: now,
    };

    await dbUnified.updateOne('users', { id: user.id }, { $set: setFields });

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: banned ? AUDIT_ACTIONS.USER_BANNED : AUDIT_ACTIONS.USER_UNBANNED,
      targetType: 'user',
      targetId: user.id,
      details: { reason, email: user.email },
    });

    res.json({
      message: banned ? 'User banned successfully' : 'User unbanned successfully',
      user: {
        id: user.id,
        email: user.email,
        banned: setFields.banned,
        banReason: setFields.banReason,
      },
    });
  }
);

/**
 * POST /api/admin/users/:id/verify
 * Manually verify a user's email
 */
router.post(
  '/users/:id/verify',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    if (user.verified) {
      return res.status(400).json({ error: 'User is already verified' });
    }

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          verified: true,
          verifiedAt: now,
          verifiedBy: req.user.id,
          verificationToken: null,
          updatedAt: now,
        },
      }
    );

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_VERIFIED,
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email },
    });

    res.json({
      message: 'User verified successfully',
      user: {
        id: user.id,
        email: user.email,
        verified: true,
      },
    });
  }
);

/**
 * POST /api/admin/users/:id/force-reset
 * Force a password reset for a user
 */
router.post(
  '/users/:id/force-reset',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    // Generate reset token
    const crypto = require('crypto');
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    // Send password reset email via Postmark BEFORE saving changes
    try {
      logger.info(`📧 Admin ${req.user.email} initiating password reset for ${user.email}`);
      await postmark.sendPasswordResetEmail(user, resetToken);
      logger.info(`✅ Password reset email sent to ${user.email}`);
    } catch (emailError) {
      logger.error('❌ Failed to send password reset email:', emailError.message);

      // If email fails, don't update user record
      return res.status(500).json({
        error: 'Failed to send password reset email',
        details: process.env.NODE_ENV === 'development' ? emailError.message : undefined,
      });
    }

    // Only save changes after email is successfully sent
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          resetToken,
          resetTokenExpiresAt,
          passwordResetRequired: true,
          updatedAt: now,
        },
      }
    );

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email, forced: true, emailSent: true },
    });

    res.json({
      message: 'Password reset email sent successfully',
      user: {
        id: user.id,
        email: user.email,
      },
    });
  }
);

/**
 * POST /api/admin/users/bulk-verify
 * Bulk verify user emails
 * Body: { userIds: string[] }
 */
router.post(
  '/users/bulk-verify',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }

      const users = await dbUnified.read('users');
      const now = new Date().toISOString();
      let verifiedCount = 0;
      let alreadyVerifiedCount = 0;

      const updatePromises = [];
      userIds.forEach(userId => {
        const user = users.find(u => u.id === userId);
        if (user && !user.verified) {
          updatePromises.push(
            dbUnified.updateOne(
              'users',
              { id: userId },
              {
                $set: {
                  verified: true,
                  verifiedAt: now,
                  verifiedBy: req.user.id,
                  verificationToken: null,
                  updatedAt: now,
                },
              }
            )
          );
          verifiedCount++;
        } else if (user && user.verified) {
          alreadyVerifiedCount++;
        }
      });

      await Promise.all(updatePromises);

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_USERS_VERIFIED',
        targetType: 'users',
        targetId: 'bulk',
        details: { userIds, verifiedCount, alreadyVerifiedCount },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully verified ${verifiedCount} user(s)`,
        verifiedCount,
        alreadyVerifiedCount,
        totalRequested: userIds.length,
      });
    } catch (error) {
      logger.error('Error bulk verifying users:', error);
      res.status(500).json({ error: 'Failed to bulk verify users' });
    }
  }
);

/**
 * POST /api/admin/users/bulk-suspend
 * Bulk suspend users
 * Body: { userIds: string[], suspended: boolean, reason: string, duration: string }
 */
router.post(
  '/users/bulk-suspend',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds, suspended = true, reason, duration } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }

      const users = await dbUnified.read('users');
      const now = new Date().toISOString();
      let updatedCount = 0;

      const suspendPromises = [];
      userIds.forEach(userId => {
        const user = users.find(u => u.id === userId);
        if (user && user.id !== req.user.id) {
          // Don't allow admins to suspend themselves
          const suspendUpdates = {
            suspended: !!suspended,
            suspendedAt: suspended ? now : null,
            suspendedBy: suspended ? req.user.id : null,
            suspensionReason: suspended ? reason || 'Bulk suspension' : null,
            suspensionDuration: suspended ? duration : null,
            suspensionExpiresAt: null,
            updatedAt: now,
          };

          // Calculate expiry if duration is provided
          if (suspended && duration) {
            const durationMs = parseDuration(duration);
            if (durationMs > 0) {
              suspendUpdates.suspensionExpiresAt = new Date(Date.now() + durationMs).toISOString();
            }
          }

          suspendPromises.push(
            dbUnified.updateOne('users', { id: userId }, { $set: suspendUpdates })
          );
          updatedCount++;
        }
      });

      await Promise.all(suspendPromises);

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: suspended ? 'BULK_USERS_SUSPENDED' : 'BULK_USERS_UNSUSPENDED',
        targetType: 'users',
        targetId: 'bulk',
        details: { userIds, count: updatedCount, reason, duration },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully ${suspended ? 'suspended' : 'unsuspended'} ${updatedCount} user(s)`,
        updatedCount,
        totalRequested: userIds.length,
      });
    } catch (error) {
      logger.error('Error bulk suspending users:', error);
      res.status(500).json({ error: 'Failed to bulk suspend users' });
    }
  }
);

/**
 * POST /api/admin/users/bulk-delete
 * Bulk delete users
 * Body: { userIds: string[] }
 */
router.post(
  '/users/bulk-delete',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }

      const users = await dbUnified.read('users');
      let deletedCount = 0;
      const deletedUsers = [];

      // Filter out users that cannot be deleted
      const deletePromises = [];
      userIds.forEach(userId => {
        const user = users.find(u => u.id === userId);
        if (user) {
          // Prevent admins from deleting themselves
          if (user.id === req.user.id) {
            return;
          }

          // ⚠️ SECURITY: Prevent deletion of the owner account
          const isOwner = domainAdmin.isOwnerEmail(user.email) || user.isOwner;
          if (isOwner) {
            return;
          }

          deletedUsers.push({ id: user.id, email: user.email, name: user.name });
          deletePromises.push(dbUnified.deleteOne('users', userId));
          deletedCount++;
        }
      });

      await Promise.all(deletePromises);

      // Create audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_USERS_DELETED',
        targetType: 'users',
        targetId: 'bulk',
        details: { userIds, deletedCount, deletedUsers },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        message: `Successfully deleted ${deletedCount} user(s)`,
        deletedCount,
        totalRequested: userIds.length,
      });
    } catch (error) {
      logger.error('Error bulk deleting users:', error);
      res.status(500).json({ error: 'Failed to bulk delete users' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/verify
 * Verify a supplier account
 * Body: { verified: boolean, verificationNotes: string }
 */
router.post(
  '/suppliers/:id/verify',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { verified, verificationNotes } = req.body;
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === req.params.id);

      if (supplierIndex < 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const supplier = suppliers[supplierIndex];
      const now = new Date().toISOString();

      supplier.verified = !!verified;
      supplier.verifiedAt = verified ? now : null;
      supplier.verifiedBy = verified ? req.user.id : null;
      supplier.verificationNotes = verificationNotes || '';
      supplier.verificationStatus = verified ? 'verified' : 'rejected';
      supplier.updatedAt = now;

      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: {
            verified: supplier.verified,
            verifiedAt: supplier.verifiedAt,
            verifiedBy: supplier.verifiedBy,
            verificationNotes: supplier.verificationNotes,
            verificationStatus: supplier.verificationStatus,
            updatedAt: supplier.updatedAt,
          },
        }
      );

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: verified ? AUDIT_ACTIONS.SUPPLIER_VERIFIED : AUDIT_ACTIONS.SUPPLIER_REJECTED,
        targetType: 'supplier',
        targetId: supplier.id,
        details: { name: supplier.name, notes: verificationNotes },
      });

      res.json({
        message: verified ? 'Supplier verified successfully' : 'Supplier verification rejected',
        supplier: {
          id: supplier.id,
          name: supplier.name,
          verified: supplier.verified,
          verificationStatus: supplier.verificationStatus,
        },
      });
    } catch (error) {
      logger.error('Error verifying supplier:', error);
      res.status(500).json({ error: 'Failed to verify supplier' });
    }
  }
);

/**
 * POST /api/admin/suppliers/:id/subscription
 * Grant or update a supplier's subscription
 * Body: { tier: 'pro' | 'pro_plus', days: number }
 */
router.post(
  '/suppliers/:id/subscription',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { tier, days } = req.body;
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === req.params.id);

      if (supplierIndex < 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      if (!tier || !['pro', 'pro_plus'].includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "pro_plus"' });
      }

      if (!days || days <= 0) {
        return res.status(400).json({ error: 'Invalid duration. Must be positive number of days' });
      }

      const supplier = suppliers[supplierIndex];
      const now = new Date().toISOString();
      const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      // Update subscription
      supplier.subscription = {
        tier: tier,
        status: 'active',
        startDate: now,
        endDate: expiryDate,
        grantedBy: req.user.id,
        grantedAt: now,
        autoRenew: false,
      };
      supplier.updatedAt = now;

      // Backward compatibility
      supplier.isPro = true;
      supplier.proPlan = tier === 'pro_plus' ? 'Pro+' : 'Pro';
      supplier.proPlanExpiry = expiryDate;

      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: {
            subscription: supplier.subscription,
            updatedAt: supplier.updatedAt,
            isPro: supplier.isPro,
            proPlan: supplier.proPlan,
            proPlanExpiry: supplier.proPlanExpiry,
          },
        }
      );

      // Create audit log with specific action
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'subscription_granted',
        targetType: 'supplier',
        targetId: supplier.id,
        details: {
          name: supplier.name,
          tier: tier,
          days: days,
          expiryDate: expiryDate,
        },
      });

      res.json({
        message: `${tier === 'pro_plus' ? 'Pro+' : 'Pro'} subscription granted successfully`,
        supplier: {
          id: supplier.id,
          name: supplier.name,
          subscription: supplier.subscription,
        },
      });
    } catch (error) {
      logger.error('Error granting subscription:', error);
      res.status(500).json({ error: 'Failed to grant subscription' });
    }
  }
);

/**
 * DELETE /api/admin/suppliers/:id/subscription
 * Remove a supplier's subscription
 */
router.delete(
  '/suppliers/:id/subscription',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === req.params.id);

      if (supplierIndex < 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const supplier = suppliers[supplierIndex];
      const now = new Date().toISOString();

      // Remove subscription
      supplier.subscription = {
        tier: 'free',
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: req.user.id,
      };
      supplier.updatedAt = now;

      // Backward compatibility
      supplier.isPro = false;
      supplier.proPlan = null;
      supplier.proPlanExpiry = null;

      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: {
            subscription: supplier.subscription,
            updatedAt: supplier.updatedAt,
            isPro: supplier.isPro,
            proPlan: supplier.proPlan,
            proPlanExpiry: supplier.proPlanExpiry,
          },
        }
      );

      // Create audit log with specific action
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'subscription_removed',
        targetType: 'supplier',
        targetId: supplier.id,
        details: {
          name: supplier.name,
        },
      });

      res.json({
        message: 'Subscription removed successfully',
        supplier: {
          id: supplier.id,
          name: supplier.name,
          subscription: supplier.subscription,
        },
      });
    } catch (error) {
      logger.error('Error removing subscription:', error);
      res.status(500).json({ error: 'Failed to remove subscription' });
    }
  }
);

/**
 * GET /api/admin/suppliers/pending-verification
 * Get suppliers awaiting verification
 */
router.get(
  '/suppliers/pending-verification',
  authRequired,
  roleRequired('admin'),
  async (req, res) => {
    try {
      const suppliers = await dbUnified.read('suppliers');
      const pending = suppliers.filter(
        s => !s.verified && (!s.verificationStatus || s.verificationStatus === 'pending')
      );

      res.json({
        suppliers: pending.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          location: s.location,
          ownerUserId: s.ownerUserId,
          createdAt: s.createdAt,
        })),
        count: pending.length,
      });
    } catch (error) {
      logger.error('Error fetching pending suppliers:', error);
      res.status(500).json({ error: 'Failed to fetch pending suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/bulk-approve
 * Bulk approve suppliers
 * Body: { supplierIds: string[] }
 */
router.post(
  '/suppliers/bulk-approve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { supplierIds } = req.body;

      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (supplierIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
        });
      }

      const suppliers = await dbUnified.read('suppliers');
      let updatedCount = 0;

      for (const supplierId of supplierIds) {
        const index = suppliers.findIndex(s => s.id === supplierId);
        if (index >= 0) {
          await dbUnified.updateOne(
            'suppliers',
            { id: supplierId },
            {
              $set: {
                approved: true,
                updatedAt: new Date().toISOString(),
                approvedBy: req.user.id,
              },
            }
          );
          updatedCount++;
        }
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_SUPPLIERS_APPROVED',
        targetType: 'suppliers',
        targetId: 'bulk',
        details: { supplierIds, count: updatedCount },
      });

      res.json({
        success: true,
        message: `Successfully approved ${updatedCount} supplier(s)`,
        updatedCount,
      });
    } catch (error) {
      logger.error('Error bulk approving suppliers:', error);
      res.status(500).json({ error: 'Failed to bulk approve suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/bulk-reject
 * Bulk reject suppliers
 * Body: { supplierIds: string[] }
 */
router.post(
  '/suppliers/bulk-reject',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { supplierIds } = req.body;

      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (supplierIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
        });
      }

      const suppliers = await dbUnified.read('suppliers');
      let updatedCount = 0;

      for (const supplierId of supplierIds) {
        const index = suppliers.findIndex(s => s.id === supplierId);
        if (index >= 0) {
          await dbUnified.updateOne(
            'suppliers',
            { id: supplierId },
            {
              $set: {
                approved: false,
                rejected: true,
                updatedAt: new Date().toISOString(),
                rejectedBy: req.user.id,
              },
            }
          );
          updatedCount++;
        }
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_SUPPLIERS_REJECTED',
        targetType: 'suppliers',
        targetId: 'bulk',
        details: { supplierIds, count: updatedCount },
      });

      res.json({
        success: true,
        message: `Successfully rejected ${updatedCount} supplier(s)`,
        updatedCount,
      });
    } catch (error) {
      logger.error('Error bulk rejecting suppliers:', error);
      res.status(500).json({ error: 'Failed to bulk reject suppliers' });
    }
  }
);

/**
 * POST /api/admin/suppliers/bulk-delete
 * Bulk delete suppliers
 * Body: { supplierIds: string[] }
 */
router.post(
  '/suppliers/bulk-delete',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { supplierIds } = req.body;

      if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
        return res.status(400).json({ error: 'supplierIds must be a non-empty array' });
      }

      // Limit batch size to prevent overload
      const MAX_BATCH_SIZE = 100;
      if (supplierIds.length > MAX_BATCH_SIZE) {
        return res.status(400).json({
          error: `Batch size cannot exceed ${MAX_BATCH_SIZE} items`,
        });
      }

      const suppliers = await dbUnified.read('suppliers');

      // Filter out suppliers to delete
      const toDelete = suppliers.filter(s => supplierIds.includes(s.id));
      const deletedCount = toDelete.length;

      if (deletedCount > 0) {
        for (const supplierId of supplierIds.filter(id => suppliers.some(s => s.id === id))) {
          await dbUnified.deleteOne('suppliers', supplierId);
        }

        // Also delete associated packages
        const packages = await dbUnified.read('packages');
        for (const pkg of packages) {
          if (supplierIds.includes(pkg.supplierId)) {
            await dbUnified.deleteOne('packages', pkg.id);
          }
        }
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_SUPPLIERS_DELETED',
        targetType: 'suppliers',
        targetId: 'bulk',
        details: { supplierIds, count: deletedCount },
      });

      res.json({
        success: true,
        message: `Successfully deleted ${deletedCount} supplier(s) and their associated packages`,
        deletedCount,
      });
    } catch (error) {
      logger.error('Error bulk deleting suppliers:', error);
      res.status(500).json({ error: 'Failed to bulk delete suppliers' });
    }
  }
);

/**
 * PUT /api/admin/packages/:id
 * Edit package details (admin only)
 */
router.put(
  '/packages/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const {
      title,
      description,
      price,
      price_display,
      image,
      approved,
      featured,
      features,
      availability,
      status,
      scheduledPublishAt,
    } = req.body;

    const pkg = await dbUnified.findOne('packages', { id });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Build version history entry
    const versionHistory = [
      ...(pkg.versionHistory || []),
      {
        timestamp: new Date().toISOString(),
        editedBy: req.user.id,
        previousState: { ...pkg },
      },
    ];

    const setFields = {
      updatedAt: new Date().toISOString(),
      lastEditedBy: req.user.id,
      versionHistory,
    };

    // Update fields if provided
    if (title !== undefined) {
      setFields.title = title;
      // Regenerate slug if title changes
      const newSlug = generateSlug(title);
      if (newSlug && newSlug !== pkg.slug) {
        // Check if new slug is already taken
        const allPkgs = await dbUnified.read('packages');
        const existingPackage = allPkgs.find(p => p.id !== id && p.slug === newSlug);
        if (existingPackage) {
          return res.status(400).json({
            error: 'A package with this title already exists. Please use a different title.',
          });
        }
        setFields.slug = newSlug;
      }
    }
    if (description !== undefined) {
      setFields.description = description;
    }
    if (price !== undefined) {
      setFields.price = price;
    }
    if (price_display !== undefined) {
      setFields.price_display = price_display;
    }
    if (image !== undefined) {
      setFields.image = image;
    }
    if (approved !== undefined) {
      setFields.approved = approved;
    }
    if (featured !== undefined) {
      setFields.featured = featured;
    }
    if (features !== undefined) {
      setFields.features = features;
    }
    if (availability !== undefined) {
      setFields.availability = availability;
    }
    if (status !== undefined) {
      setFields.status = status;
    }
    if (scheduledPublishAt !== undefined) {
      setFields.scheduledPublishAt = scheduledPublishAt;
    }

    await dbUnified.updateOne('packages', { id }, { $set: setFields });

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.PACKAGE_EDITED,
      targetType: 'package',
      targetId: id,
      details: { packageTitle: setFields.title || pkg.title, changes: req.body },
    });

    res.json({ success: true, package: { ...pkg, ...setFields } });
  }
);

/**
 * PUT /api/admin/suppliers/:id
 * Edit supplier profile (admin only)
 */
router.put(
  '/suppliers/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, contact, categories, amenities, location, serviceAreas } =
        req.body;

      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === id);

      if (supplierIndex === -1) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const supplier = suppliers[supplierIndex];

      // Store previous version for history
      if (!supplier.versionHistory) {
        supplier.versionHistory = [];
      }
      supplier.versionHistory.push({
        timestamp: new Date().toISOString(),
        editedBy: req.user.id,
        previousState: { ...supplier },
      });

      // Update fields if provided
      if (name !== undefined) {
        supplier.name = name;
      }
      if (description !== undefined) {
        supplier.description = description;
      }
      if (contact !== undefined) {
        supplier.contact = contact;
      }
      if (categories !== undefined) {
        supplier.categories = categories;
      }
      if (amenities !== undefined) {
        supplier.amenities = amenities;
      }
      if (location !== undefined) {
        supplier.location = location;
      }
      if (serviceAreas !== undefined) {
        supplier.serviceAreas = serviceAreas;
      }

      supplier.updatedAt = new Date().toISOString();
      supplier.lastEditedBy = req.user.id;

      await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        {
          $set: {
            name: supplier.name,
            description: supplier.description,
            contact: supplier.contact,
            categories: supplier.categories,
            amenities: supplier.amenities,
            location: supplier.location,
            serviceAreas: supplier.serviceAreas,
            updatedAt: supplier.updatedAt,
            lastEditedBy: supplier.lastEditedBy,
            versionHistory: supplier.versionHistory,
          },
        }
      );

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.SUPPLIER_EDITED,
        targetType: 'supplier',
        targetId: id,
        details: { supplierName: supplier.name, changes: req.body },
      });

      res.json({ success: true, supplier });
    } catch (error) {
      logger.error('Error updating supplier:', error);
      res.status(500).json({ error: 'Failed to update supplier' });
    }
  }
);

/**
 * PUT /api/admin/users/:id
 * Edit user profile (admin only)
 */
router.put('/users/:id', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, verified, marketingOptIn } = req.body;

  const user = await dbUnified.findOne('users', { id });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // ⚠️ SECURITY: Protect owner account from modifications
  const isOwner = domainAdmin.isOwnerEmail(user.email) || user.isOwner;
  if (isOwner) {
    // Owner account cannot be modified through this endpoint
    // Only specific fields can be updated by owner themselves in profile settings
    return res.status(403).json({
      error: 'Cannot modify owner account',
      message:
        'The owner account is protected from administrative changes. Owner can update their own profile through account settings.',
      code: 'OWNER_ACCOUNT_PROTECTED',
    });
  }

  // Store previous version for history (excluding sensitive data)
  const {
    // eslint-disable-next-line no-unused-vars
    password: _password,
    // eslint-disable-next-line no-unused-vars
    passwordHash: _passwordHash,
    // eslint-disable-next-line no-unused-vars
    resetToken: _resetToken,
    // eslint-disable-next-line no-unused-vars
    twoFactorSecret: _twoFactorSecret,
    ...safeState
  } = user;
  const versionHistory = [
    ...(user.versionHistory || []),
    {
      timestamp: new Date().toISOString(),
      editedBy: req.user.id,
      previousState: safeState,
    },
  ];

  const setFields = {
    updatedAt: new Date().toISOString(),
    lastEditedBy: req.user.id,
    versionHistory,
  };
  if (name !== undefined) {
    setFields.name = name;
  }
  if (email !== undefined) {
    setFields.email = email;
  }
  if (role !== undefined) {
    setFields.role = role;
  }
  if (verified !== undefined) {
    setFields.verified = verified;
  }
  if (marketingOptIn !== undefined) {
    setFields.marketingOptIn = marketingOptIn;
  }

  await dbUnified.updateOne('users', { id }, { $set: setFields });

  // Create audit log
  auditLog({
    adminId: req.user.id,
    adminEmail: req.user.email,
    action: 'user_edited',
    targetType: 'user',
    targetId: user.id,
    details: { email: user.email, changes: req.body },
  });

  res.json({ success: true, user: { ...user, ...setFields } });
});

/**
 * DELETE /api/admin/users/:id
 * Delete a user account (admin only)
 */
router.delete(
  '/users/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const user = await dbUnified.findOne('users', { id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent admins from deleting themselves
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // ⚠️ SECURITY: Prevent deletion of the owner account
    const isOwner = domainAdmin.isOwnerEmail(user.email) || user.isOwner;
    if (isOwner) {
      return res.status(403).json({
        error: 'Cannot delete owner account',
        message: 'The owner account is protected and cannot be deleted.',
        code: 'OWNER_ACCOUNT_PROTECTED',
      });
    }

    // Remove the user
    await dbUnified.deleteOne('users', id);

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_DELETED,
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email, name: user.name },
    });

    res.json({ success: true, message: 'User deleted successfully' });
  }
);

/**
 * DELETE /api/admin/suppliers/:id
 * Delete a supplier (admin only)
 */
router.delete(
  '/suppliers/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === id);

      if (supplierIndex === -1) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const supplier = suppliers[supplierIndex];

      // Remove the supplier
      await dbUnified.deleteOne('suppliers', id);

      // Also delete associated packages
      const packages = await dbUnified.read('packages');
      for (const pkg of packages) {
        if (pkg.supplierId === id) {
          await dbUnified.deleteOne('packages', pkg.id);
        }
      }

      // Create audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'supplier_deleted',
        targetType: 'supplier',
        targetId: supplier.id,
        details: { name: supplier.name },
      });

      res.json({ success: true, message: 'Supplier and associated packages deleted successfully' });
    } catch (error) {
      logger.error('Error deleting supplier:', error);
      res.status(500).json({ error: 'Failed to delete supplier' });
    }
  }
);

/**
 * DELETE /api/admin/packages/:id
 * Delete a package (admin only)
 */
router.delete(
  '/packages/:id',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const pkg = await dbUnified.findOne('packages', { id });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Remove the package
    await dbUnified.deleteOne('packages', id);

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'package_deleted',
      targetType: 'package',
      targetId: pkg.id,
      details: { title: pkg.title },
    });

    res.json({ success: true, message: 'Package deleted successfully' });
  }
);

/**
 * PATCH /api/admin/packages/:id/tags (P3-28: Seasonal Tagging)
 * Add or update seasonal tags for a package
 */
router.patch(
  '/packages/:id/tags',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { seasonalTags } = req.body;

      if (!Array.isArray(seasonalTags)) {
        return res.status(400).json({ error: 'seasonalTags must be an array' });
      }

      // Validate seasonal tags
      const validSeasons = [
        'spring',
        'summer',
        'autumn',
        'winter',
        'christmas',
        'valentine',
        'easter',
        'halloween',
        'new-year',
      ];
      const invalidTags = seasonalTags.filter(tag => !validSeasons.includes(tag.toLowerCase()));

      if (invalidTags.length > 0) {
        return res.status(400).json({
          error: 'Invalid seasonal tags',
          invalidTags,
          validSeasons,
        });
      }

      const packages = await dbUnified.read('packages');
      const pkgIndex = packages.findIndex(p => p.id === id);

      if (pkgIndex === -1) {
        return res.status(404).json({ error: 'Package not found' });
      }

      // Update seasonal tags
      const updatedSeasonalTags = seasonalTags.map(t => t.toLowerCase());
      const updatedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'packages',
        { id: id },
        { $set: { seasonalTags: updatedSeasonalTags, updatedAt: updatedAt } }
      );

      // Log the action
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'package_updated',
        targetType: 'package',
        targetId: id,
        details: { field: 'seasonalTags', value: seasonalTags },
      });

      res.json({
        success: true,
        package: { ...packages[pkgIndex], seasonalTags: updatedSeasonalTags, updatedAt: updatedAt },
      });
    } catch (error) {
      logger.error('Error updating seasonal tags:', error);
      res.status(500).json({ error: 'Failed to update seasonal tags', details: error.message });
    }
  }
);

/**
 * POST /api/admin/users/:id/grant-admin
 * Grant admin privileges to a user
 */
router.post(
  '/users/:id/grant-admin',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const user = await dbUnified.findOne('users', { id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    // Check if user already has admin role
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'User already has admin privileges' });
    }

    await dbUnified.updateOne(
      'users',
      { id },
      {
        $set: {
          previousRole: user.role,
          role: 'admin',
          adminGrantedAt: now,
          adminGrantedBy: req.user.id,
          updatedAt: now,
        },
      }
    );

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: user.id,
      details: {
        email: user.email,
        previousRole: user.previousRole,
        newRole: 'admin',
      },
    });

    res.json({
      success: true,
      message: 'Admin privileges granted successfully',
      user: {
        id: user.id,
        email: user.email,
        role: 'admin',
      },
    });
  }
);

/**
 * POST /api/admin/users/:id/revoke-admin
 * Revoke admin privileges from a user
 */
router.post(
  '/users/:id/revoke-admin',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const { newRole = 'customer' } = req.body;
    const user = await dbUnified.findOne('users', { id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();

    // Check if user has admin role
    if (user.role !== 'admin') {
      return res.status(400).json({ error: 'User does not have admin privileges' });
    }

    // Prevent revoking own admin privileges
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot revoke your own admin privileges' });
    }

    // Prevent revoking owner's admin privileges
    if (user.email === 'admin@event-flow.co.uk' || user.isOwner) {
      return res
        .status(403)
        .json({ error: 'Cannot revoke admin privileges from the owner account' });
    }

    // Validate newRole
    if (!['customer', 'supplier'].includes(newRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be customer or supplier' });
    }

    await dbUnified.updateOne(
      'users',
      { id },
      {
        $set: {
          previousRole: user.role,
          role: newRole,
          adminRevokedAt: now,
          adminRevokedBy: req.user.id,
          updatedAt: now,
        },
      }
    );

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      targetType: 'user',
      targetId: user.id,
      details: {
        email: user.email,
        previousRole: 'admin',
        newRole: newRole,
      },
    });

    res.json({
      success: true,
      message: 'Admin privileges revoked successfully',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  }
);

router.get('/users/segments', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const users = await dbUnified.read('users');
    const suppliers = await dbUnified.read('suppliers');
    const plans = await dbUnified.read('plans');
    const messages = await dbUnified.read('messages');

    // Segment 1: Active Customers (have created plans)
    const activeCustomers = users.filter(u => {
      const userPlans = plans.filter(p => p.userId === u.id);
      return u.role === 'customer' && userPlans.length > 0;
    });

    // Segment 2: Inactive Customers (registered but no plans)
    const inactiveCustomers = users.filter(u => {
      const userPlans = plans.filter(p => p.userId === u.id);
      return u.role === 'customer' && userPlans.length === 0;
    });

    // Segment 3: Premium Suppliers (have subscription)
    const premiumSuppliers = suppliers.filter(s => s.subscription && s.subscription !== 'free');

    // Segment 4: Free Suppliers (no subscription or free tier)
    const freeSuppliers = suppliers.filter(s => !s.subscription || s.subscription === 'free');

    // Segment 5: Active Suppliers (sent messages in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeSuppliers = suppliers.filter(s => {
      const recentMessages = messages.filter(
        m => m.senderId === s.userId && new Date(m.createdAt) > thirtyDaysAgo
      );
      return recentMessages.length > 0;
    });

    // Segment 6: At-Risk Suppliers (inactive for 60+ days)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const atRiskSuppliers = suppliers.filter(s => {
      const recentMessages = messages.filter(
        m => m.senderId === s.userId && new Date(m.createdAt) > sixtyDaysAgo
      );
      return recentMessages.length === 0;
    });

    // Segment 7: High-Value Customers (multiple events planned)
    const highValueCustomers = users.filter(u => {
      const userPlans = plans.filter(p => p.userId === u.id);
      return u.role === 'customer' && userPlans.length >= 2;
    });

    // Segment 8: New Users (registered in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsers = users.filter(u => new Date(u.createdAt || 0) > sevenDaysAgo);

    const segments = {
      activeCustomers: {
        count: activeCustomers.length,
        users: activeCustomers.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
        })),
      },
      inactiveCustomers: {
        count: inactiveCustomers.length,
        users: inactiveCustomers.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
        })),
      },
      premiumSuppliers: {
        count: premiumSuppliers.length,
        suppliers: premiumSuppliers.map(s => ({
          id: s.id,
          name: s.name,
          subscription: s.subscription,
        })),
      },
      freeSuppliers: {
        count: freeSuppliers.length,
        suppliers: freeSuppliers.map(s => ({
          id: s.id,
          name: s.name,
        })),
      },
      activeSuppliers: {
        count: activeSuppliers.length,
        suppliers: activeSuppliers.map(s => ({
          id: s.id,
          name: s.name,
        })),
      },
      atRiskSuppliers: {
        count: atRiskSuppliers.length,
        suppliers: atRiskSuppliers.map(s => ({
          id: s.id,
          name: s.name,
        })),
      },
      highValueCustomers: {
        count: highValueCustomers.length,
        users: highValueCustomers.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
        })),
      },
      newUsers: {
        count: newUsers.length,
        users: newUsers.map(u => ({
          id: u.id,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
        })),
      },
    };

    res.json({
      success: true,
      segments,
      totalUsers: users.length,
      totalSuppliers: suppliers.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error generating user segments:', error);
    res.status(500).json({ error: 'Failed to generate user segments', details: error.message });
  }
});

// ---------- User Detail Operations ----------

/**
 * GET /api/admin/users/:id
 * Get detailed information about a specific user
 */
router.get('/users/:id', authRequired, roleRequired('admin'), async (req, res) => {
  const user = await dbUnified.findOne('users', { id: req.params.id });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Return user without password
  // eslint-disable-next-line no-unused-vars
  const { password, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

/**
 * POST /api/admin/users/:id/reset-password
 * Send password reset email to user
 */
router.post(
  '/users/:id/reset-password',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate reset token
    const token = uid('reset');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    // Send password reset email via Postmark BEFORE saving token
    try {
      logger.info(`📧 Admin ${req.user.email} sending password reset to ${user.email}`);
      await postmark.sendPasswordResetEmail(user, token);
      logger.info(`✅ Password reset email sent to ${user.email}`);
    } catch (emailError) {
      logger.error('❌ Failed to send password reset email:', emailError.message);

      // Log the failure in audit log
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
        targetType: 'user',
        targetId: user.id,
        details: { userEmail: user.email, emailSent: false, error: emailError.message },
      });

      return res.status(500).json({
        error: 'Failed to send password reset email',
        details: process.env.NODE_ENV === 'development' ? emailError.message : undefined,
      });
    }

    // Only save reset token after email is successfully sent
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { resetToken: token, resetTokenExpiresAt: expires },
      }
    );

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: user.id,
      details: { userEmail: user.email, emailSent: true },
    });

    res.json({
      success: true,
      message: 'Password reset email sent successfully',
    });
  }
);

/**
 * POST /api/admin/users/:id/unsuspend
 * Unsuspend a user
 */
router.post(
  '/users/:id/unsuspend',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const user = await dbUnified.findOne('users', { id: req.params.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await dbUnified.updateOne(
      'users',
      { id: req.params.id },
      {
        $set: {
          suspended: false,
          suspendedAt: null,
          suspendedBy: null,
          suspendedReason: null,
          updatedAt: new Date().toISOString(),
        },
      }
    );

    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'USER_UNSUSPENDED',
      targetType: 'user',
      targetId: req.params.id,
      details: { userEmail: user.email },
    });

    res.json({ success: true, message: 'User unsuspended', user: { ...user, suspended: false } });
  }
);

/**
 * POST /api/admin/users/:userId/resend-verification
 * Admin: Resend verification email to a specific user
 */
router.post(
  '/users/:userId/resend-verification',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  auditMiddleware(AUDIT_ACTIONS.RESEND_VERIFICATION, req => ({
    targetType: 'user',
    targetId: req.params.userId,
  })),
  async (req, res) => {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing user ID' });
    }

    const user = await dbUnified.findOne('users', { id: userId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is already verified
    if (user.verified === true) {
      return res.status(400).json({ error: 'User is already verified' });
    }

    // Generate new verification token with 24-hour expiration
    const verificationToken = uid('verify');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Send verification email via Postmark BEFORE saving token
    try {
      logger.info(`📧 Admin ${req.user.email} resending verification email to ${user.email}`);
      await postmark.sendVerificationEmail(user, verificationToken);
      logger.info(`✅ Verification email resent successfully to ${user.email}`);
    } catch (emailError) {
      logger.error('❌ Failed to resend verification email:', emailError.message);
      return res.status(500).json({
        error: 'Failed to send verification email. Please try again later.',
        details: process.env.NODE_ENV === 'development' ? emailError.message : undefined,
      });
    }

    // Only update token after email is successfully sent
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { verificationToken, verificationTokenExpiresAt: tokenExpiresAt },
      }
    );

    res.json({
      ok: true,
      message: `Verification email sent to ${user.email}`,
    });
  }
);

/**
 * POST /api/admin/users/:id/subscription
 * Grant or update subscription for a user
 * Body: { tier: 'pro' | 'pro_plus', duration: '7d' | '30d' | '90d' | '1y' | 'lifetime', reason: string }
 */
router.post(
  '/users/:id/subscription',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { tier, duration, reason } = req.body;

      // Validate tier
      const validTiers = ['pro', 'pro_plus'];
      if (!validTiers.includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "pro_plus"' });
      }

      // Validate duration
      const validDurations = ['7d', '30d', '90d', '1y', 'lifetime'];
      if (!validDurations.includes(duration)) {
        return res
          .status(400)
          .json({ error: 'Invalid duration. Must be 7d, 30d, 90d, 1y, or lifetime' });
      }

      const user = await dbUnified.findOne('users', { id });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const now = new Date();
      const startDate = now.toISOString();
      let endDate = null;

      // Calculate end date based on duration
      if (duration !== 'lifetime') {
        const durationMap = {
          '7d': 7,
          '30d': 30,
          '90d': 90,
          '1y': 365,
        };
        const days = durationMap[duration];
        const end = new Date(now);
        end.setDate(end.getDate() + days);
        endDate = end.toISOString();
      }

      // Store previous subscription info for history
      const previousTier = user.subscription?.tier || 'free';
      const action =
        !user.subscription || user.subscription.tier === 'free'
          ? 'granted'
          : tier !== previousTier
            ? 'upgraded'
            : 'renewed';

      // Update user subscription
      user.subscription = {
        tier,
        status: 'active',
        startDate,
        endDate,
        grantedBy: req.user.id,
        grantedAt: startDate,
        reason: reason || 'Manual admin grant',
        autoRenew: false,
      };

      // Initialize subscription history if it doesn't exist
      const subscriptionHistory = [
        ...(user.subscriptionHistory || []),
        {
          tier,
          action,
          date: startDate,
          adminId: req.user.id,
          adminEmail: req.user.email,
          reason: reason || 'Manual admin grant',
          previousTier,
          duration,
          endDate,
        },
      ];

      // Save updated user
      await dbUnified.updateOne(
        'users',
        { id },
        {
          $set: {
            subscription: user.subscription,
            subscriptionHistory,
            updatedAt: new Date().toISOString(),
          },
        }
      );

      // Log to audit
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'USER_SUBSCRIPTION_GRANTED',
        targetType: 'user',
        targetId: id,
        details: { tier, duration, reason, endDate },
      });

      res.json({
        success: true,
        message: 'Subscription granted successfully',
        subscription: user.subscription,
      });
    } catch (error) {
      logger.error('Error granting subscription:', error);
      res.status(500).json({ error: 'Failed to grant subscription' });
    }
  }
);

/**
 * DELETE /api/admin/users/:id/subscription
 * Remove subscription from a user
 * Body: { reason: string }
 */
router.delete(
  '/users/:id/subscription',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const user = await dbUnified.findOne('users', { id });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.subscription || user.subscription.tier === 'free') {
        return res.status(400).json({ error: 'User has no active subscription to remove' });
      }

      const previousTier = user.subscription.tier;
      const now = new Date().toISOString();

      // Update subscription to cancelled/free
      const newSubscription = {
        tier: 'free',
        status: 'cancelled',
        startDate: now,
        endDate: null,
        grantedBy: req.user.id,
        grantedAt: now,
        reason: reason || 'Manual admin removal',
        autoRenew: false,
      };

      const subscriptionHistory = [
        ...(user.subscriptionHistory || []),
        {
          tier: 'free',
          action: 'cancelled',
          date: now,
          adminId: req.user.id,
          adminEmail: req.user.email,
          reason: reason || 'Manual admin removal',
          previousTier,
          duration: null,
          endDate: null,
        },
      ];

      // Save updated user
      await dbUnified.updateOne(
        'users',
        { id },
        {
          $set: { subscription: newSubscription, subscriptionHistory, updatedAt: now },
        }
      );

      // Log to audit
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'USER_SUBSCRIPTION_REMOVED',
        targetType: 'user',
        targetId: id,
        details: { previousTier, reason },
      });

      res.json({
        success: true,
        message: 'Subscription removed successfully',
      });
    } catch (error) {
      logger.error('Error removing subscription:', error);
      res.status(500).json({ error: 'Failed to remove subscription' });
    }
  }
);

/**
 * GET /api/admin/users/:id/subscription-history
 * Get subscription history for a user
 */
router.get(
  '/users/:id/subscription-history',
  authRequired,
  roleRequired('admin'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await dbUnified.findOne('users', { id });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const history = user.subscriptionHistory || [];

      res.json({
        success: true,
        history,
        currentSubscription: user.subscription || null,
      });
    } catch (error) {
      logger.error('Error fetching subscription history:', error);
      res.status(500).json({ error: 'Failed to fetch subscription history' });
    }
  }
);

/**
 * POST /api/admin/bulk/subscriptions
 * Bulk grant subscriptions to multiple users
 * Body: { userIds: string[], tier: string, duration: string, reason: string }
 */
router.post(
  '/bulk/subscriptions',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      const { userIds, tier, duration, reason } = req.body;

      // Validate input
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds must be a non-empty array' });
      }

      const validTiers = ['pro', 'pro_plus'];
      if (!validTiers.includes(tier)) {
        return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "pro_plus"' });
      }

      const validDurations = ['7d', '30d', '90d', '1y', 'lifetime'];
      if (!validDurations.includes(duration)) {
        return res
          .status(400)
          .json({ error: 'Invalid duration. Must be 7d, 30d, 90d, 1y, or lifetime' });
      }

      const users = await dbUnified.read('users');
      const now = new Date();
      const startDate = now.toISOString();
      let endDate = null;

      // Calculate end date based on duration
      if (duration !== 'lifetime') {
        const durationMap = {
          '7d': 7,
          '30d': 30,
          '90d': 90,
          '1y': 365,
        };
        const days = durationMap[duration];
        const end = new Date(now);
        end.setDate(end.getDate() + days);
        endDate = end.toISOString();
      }

      const successfulUserIds = [];
      const failedUserIds = [];
      const updateOps = [];

      userIds.forEach(userId => {
        const user = users.find(u => u.id === userId);

        if (!user) {
          failedUserIds.push(userId);
          return;
        }

        const previousTier = user.subscription?.tier || 'free';
        const action =
          !user.subscription || user.subscription.tier === 'free'
            ? 'granted'
            : tier !== previousTier
              ? 'upgraded'
              : 'renewed';

        const newSubscription = {
          tier,
          status: 'active',
          startDate,
          endDate,
          grantedBy: req.user.id,
          grantedAt: startDate,
          reason: reason || 'Bulk admin grant',
          autoRenew: false,
        };

        const subscriptionHistory = [
          ...(user.subscriptionHistory || []),
          {
            tier,
            action,
            date: startDate,
            adminId: req.user.id,
            adminEmail: req.user.email,
            reason: reason || 'Bulk admin grant',
            previousTier,
            duration,
            endDate,
          },
        ];

        updateOps.push(
          dbUnified.updateOne(
            'users',
            { id: userId },
            {
              $set: { subscription: newSubscription, subscriptionHistory, updatedAt: startDate },
            }
          )
        );
        successfulUserIds.push(userId);
      });

      // Save all updated users atomically
      await Promise.all(updateOps);

      // Log to audit
      auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'BULK_SUBSCRIPTIONS_GRANTED',
        targetType: 'users',
        targetId: 'bulk',
        details: {
          tier,
          duration,
          reason,
          successCount: successfulUserIds.length,
          failedCount: failedUserIds.length,
          userIds: successfulUserIds,
        },
      });

      res.json({
        success: true,
        message: `Successfully granted subscriptions to ${successfulUserIds.length} user(s)`,
        successCount: successfulUserIds.length,
        failedCount: failedUserIds.length,
        successfulUserIds,
        failedUserIds,
      });
    } catch (error) {
      logger.error('Error granting bulk subscriptions:', error);
      res.status(500).json({ error: 'Failed to grant bulk subscriptions' });
    }
  }
);

/**
 * POST /api/admin/users/:id/impersonate
 * Start impersonating a user
 */
router.post(
  '/users/:id/impersonate',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    try {
      // Validate JWT secret is properly configured
      const jwtError = validateJWTSecret();
      if (jwtError) {
        return res.status(500).json({
          error: `Impersonation disabled: ${jwtError.error}`,
          message: jwtError.message,
        });
      }

      const { id } = req.params;

      // Prevent impersonating if already impersonating
      if (req.session.originalUser) {
        return res
          .status(400)
          .json({ error: 'Already impersonating a user. Stop current session first.' });
      }

      const users = await dbUnified.read('users');
      const targetUser = users.find(u => u.id === id);

      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Don't allow impersonating other admins
      if (targetUser.role === 'admin') {
        return res.status(403).json({ error: 'Cannot impersonate admin users' });
      }

      // Store original user in session
      req.session.originalUser = {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
      };

      // Audit log
      await auditLog({
        adminId: req.user.id,
        adminEmail: req.user.email,
        action: 'USER_IMPERSONATION_START',
        targetType: 'user',
        targetId: id,
        details: { targetEmail: targetUser.email, targetRole: targetUser.role },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      // Update user in JWT token
      const jwt = require('jsonwebtoken');
      const { setAuthCookie } = require('../middleware/auth');
      const JWT_SECRET = process.env.JWT_SECRET;

      const token = jwt.sign(
        { id: targetUser.id, email: targetUser.email, role: targetUser.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Set new auth cookie
      setAuthCookie(res, token);

      res.json({
        success: true,
        message: `Now impersonating ${targetUser.email}`,
        user: {
          id: targetUser.id,
          email: targetUser.email,
          role: targetUser.role,
        },
        originalUser: req.session.originalUser,
      });
    } catch (error) {
      logger.error('Error starting impersonation:', error);
      res.status(500).json({ error: 'Failed to start impersonation', details: error.message });
    }
  }
);

/**
 * POST /api/admin/users/stop-impersonate
 * Stop impersonating and return to original admin user
 */
router.post('/users/stop-impersonate', authRequired, csrfProtection, async (req, res) => {
  try {
    // Validate JWT secret is properly configured
    const jwtError = validateJWTSecret();
    if (jwtError) {
      return res.status(500).json({
        error: `Stop impersonation disabled: ${jwtError.error}`,
        message: jwtError.message,
      });
    }

    if (!req.session.originalUser) {
      return res.status(400).json({ error: 'Not currently impersonating' });
    }

    const originalUser = req.session.originalUser;

    // Audit log
    await auditLog({
      adminId: originalUser.id,
      adminEmail: originalUser.email,
      action: 'USER_IMPERSONATION_STOP',
      targetType: 'user',
      targetId: req.user.id,
      details: { impersonatedEmail: req.user.email },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Clear impersonation from session
    delete req.session.originalUser;

    // Restore original admin JWT
    const jwt = require('jsonwebtoken');
    const { setAuthCookie } = require('../middleware/auth');
    const JWT_SECRET = process.env.JWT_SECRET;

    const token = jwt.sign(
      { id: originalUser.id, email: originalUser.email, role: originalUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    setAuthCookie(res, token);

    res.json({
      success: true,
      message: 'Stopped impersonation',
      user: originalUser,
    });
  } catch (error) {
    logger.error('Error stopping impersonation:', error);
    res.status(500).json({ error: 'Failed to stop impersonation', details: error.message });
  }
});

/**
 * POST /api/admin/users/:id/disable
 * Backward-compatibility alias for suspend.
 * Sets suspended=true with reason "Disabled by admin".
 */
router.post(
  '/users/:id/disable',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const user = await dbUnified.findOne('users', { id: req.params.id });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const now = new Date().toISOString();
    await dbUnified.updateOne(
      'users',
      { id: req.params.id },
      {
        $set: {
          suspended: true,
          suspendedAt: now,
          suspendedBy: req.user.id,
          suspendedReason: req.body.reason || 'Disabled by admin',
          updatedAt: now,
        },
      }
    );
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'USER_SUSPENDED',
      targetType: 'user',
      targetId: req.params.id,
      details: { userEmail: user.email, reason: 'Disabled by admin' },
    });
    res.json({ success: true, message: 'User disabled', user: { ...user, suspended: true } });
  }
);

module.exports = router;
