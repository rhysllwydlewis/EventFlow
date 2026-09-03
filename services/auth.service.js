/**
 * Authentication Service
 * Handles user authentication, registration, and password management
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const { ValidationError, AuthenticationError, ConflictError } = require('../errors');
const { uid } = require('../store');
const dbUnified = require('../db-unified');
const { passwordOk } = require('../middleware/validation');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');
const logger = require('../utils/logger');
const userProvenance = require('./userProvenance.service');

const JWT_SECRET = String(process.env.JWT_SECRET || 'change_me');

class AuthService {
  /**
   * Register a new user
   * @param {Object} data - Registration data
   * @returns {Promise<Object>} - User and token
   */
  async register(data) {
    const {
      firstName,
      lastName,
      name,
      email,
      password,
      role,
      location,
      postcode,
      company,
      jobTitle,
      website,
      socials,
      marketingOptIn,
    } = data;

    // Support both new (firstName/lastName) and legacy (name) formats
    const userFirstName = firstName || '';
    const userLastName = lastName || '';
    const userFullName =
      firstName && lastName ? `${firstName.trim()} ${lastName.trim()}`.trim() : (name || '').trim();

    // Validation
    if (!userFullName || !email || !password) {
      throw new ValidationError(
        'Missing required fields (name or firstName/lastName, email, and password required)'
      );
    }
    if (!firstName || !lastName) {
      throw new ValidationError('First name and last name are required');
    }
    if (!validator.isEmail(String(email))) {
      throw new ValidationError('Invalid email');
    }
    if (!passwordOk(password)) {
      throw new ValidationError('Weak password');
    }
    if (!location) {
      throw new ValidationError('Location is required');
    }

    const roleFinal = role === 'supplier' || role === 'customer' ? role : 'customer';

    if (roleFinal === 'supplier' && !company) {
      throw new ValidationError('Company name is required for suppliers');
    }

    // Check for existing user — uses email index
    const emailLower = String(email).toLowerCase();
    if (await dbUnified.findOne('users', { email: emailLower })) {
      throw new ConflictError('Email already registered');
    }

    // Sanitize URLs
    const sanitizeUrl = url => {
      if (!url) {
        return undefined;
      }
      const trimmed = String(url).trim();
      if (!trimmed) {
        return undefined;
      }
      if (!validator.isURL(trimmed, { require_protocol: false })) {
        return undefined;
      }
      return trimmed;
    };

    // Parse socials object
    const socialsParsed = socials
      ? {
          instagram: sanitizeUrl(socials.instagram),
          facebook: sanitizeUrl(socials.facebook),
          twitter: sanitizeUrl(socials.twitter),
          linkedin: sanitizeUrl(socials.linkedin),
        }
      : {};

    // Determine founder badge eligibility
    const badges = this._checkFounderBadge(email);

    // Create user object
    const user = {
      id: uid('usr'),
      name: String(userFullName).slice(0, 80),
      firstName: String(userFirstName).trim().slice(0, 40),
      lastName: String(userLastName).trim().slice(0, 40),
      email: String(email).toLowerCase(),
      role: roleFinal,
      passwordHash: await bcrypt.hash(password, 10),
      location: String(location).trim().slice(0, 100),
      postcode: postcode ? String(postcode).trim().slice(0, 10) : undefined,
      company: company ? String(company).trim().slice(0, 100) : undefined,
      jobTitle: jobTitle ? String(jobTitle).trim().slice(0, 100) : undefined,
      website: sanitizeUrl(website),
      socials: socialsParsed,
      badges,
      notify: true,
      notify_account: true,
      notify_marketing: !!marketingOptIn,
      marketingOptIn: !!marketingOptIn,
      verified: false,
      createdAt: new Date().toISOString(),
      ...userProvenance.emailPasswordPendingProvenance(),
    };

    // Generate verification token
    const verificationToken = tokenUtils.generateVerificationToken(user, {
      expiresInHours: 24,
    });

    user.verificationToken = verificationToken;
    user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Send verification email BEFORE saving user
    try {
      logger.debug(`Sending verification email to ${user.email}`);
      const sendResult = await postmark.sendVerificationEmail(user, verificationToken);
      Object.assign(user, userProvenance.metadataFromSendResult(sendResult));
    } catch (emailError) {
      logger.error('Failed to send verification email:', emailError);
      throw new Error('Failed to send verification email. Please try again later.');
    }

    // Save user
    const authUserInserted = await dbUnified.insertOne('users', user);
    if (!authUserInserted) {
      logger.error('[AUTH-SVC] insertOne failed', { email: user.email });
      throw new Error('Failed to create user account');
    }

    // Update last login timestamp
    this._updateLastLogin(user.id);

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      user: this._sanitizeUser(user),
      token,
    };
  }

  /**
   * Login a user
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} - User and token
   */
  async login(email, password) {
    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    // Look up by email — uses email index
    const user = await dbUnified.findOne('users', { email: String(email).toLowerCase() });

    if (!user) {
      throw new AuthenticationError('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Invalid credentials');
    }

    // Update last login timestamp
    this._updateLastLogin(user.id);

    const token = this.generateToken(user);

    return {
      user: this._sanitizeUser(user),
      token,
    };
  }

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Promise<void>}
   */
  async requestPasswordReset(email) {
    if (!email || !validator.isEmail(String(email))) {
      throw new ValidationError('Invalid email');
    }

    // Look up by email — uses email index
    const user = await dbUnified.findOne('users', { email: String(email).toLowerCase() });

    if (!user) {
      // Don't reveal whether email exists
      logger.debug(`Password reset requested for non-existent email: ${email}`);
      return;
    }

    // Generate reset token
    const resetToken = tokenUtils.generatePasswordResetToken(user.email, {
      expiresInHours: 1,
    });

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          resetToken,
          resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      }
    );

    // Send password reset email
    try {
      await postmark.sendPasswordResetEmail(user, resetToken);
    } catch (emailError) {
      logger.error('Failed to send password reset email:', emailError);
      throw new Error('Failed to send password reset email');
    }
  }

  /**
   * Reset password with token
   * @param {string} token - Reset token
   * @param {string} newPassword - New password
   * @returns {Promise<void>}
   */
  async resetPassword(token, newPassword) {
    if (!token || !newPassword) {
      throw new ValidationError('Token and new password are required');
    }

    if (!passwordOk(newPassword)) {
      throw new ValidationError('Weak password');
    }

    const validation = tokenUtils.validatePasswordResetToken(token, { allowGracePeriod: false });
    if (!validation.valid) {
      throw new AuthenticationError('Invalid or expired token');
    }

    const user = await dbUnified.findOne('users', {
      email: String(validation.email).toLowerCase(),
    });

    if (!user) {
      throw new AuthenticationError('Invalid token');
    }

    // Check if token matches and hasn't expired
    if (user.resetToken !== token) {
      throw new AuthenticationError('Invalid token');
    }

    if (user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) < new Date()) {
      throw new AuthenticationError('Token has expired');
    }

    // Update password
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          passwordHash: await bcrypt.hash(newPassword, 10),
          resetToken: null,
          resetTokenExpiresAt: null,
        },
      }
    );

    logger.info(`Password reset successful for user ${user.id}`);
  }

  /**
   * Verify email with token
   * @param {string} token - Verification token
   * @returns {Promise<Object>} - User and new token
   */
  async verifyEmail(token) {
    if (!token) {
      throw new ValidationError('Token is required');
    }

    const validation = tokenUtils.validateVerificationToken(token, {
      allowGracePeriod: true,
      expectedType: tokenUtils.TOKEN_TYPES.EMAIL_VERIFICATION,
    });
    if (!validation.valid) {
      throw new AuthenticationError('Invalid or expired token');
    }

    const user = await dbUnified.findOne('users', {
      email: String(validation.email).toLowerCase(),
    });

    if (!user) {
      throw new AuthenticationError('Invalid token');
    }

    if (user.verificationToken && user.verificationToken !== token) {
      throw new AuthenticationError('Invalid token');
    }

    if (user.verificationTokenExpiresAt && new Date(user.verificationTokenExpiresAt) < new Date()) {
      throw new AuthenticationError('Token has expired');
    }

    if (user.verified) {
      // Already verified, return success
      return {
        user: this._sanitizeUser(user),
        token: this.generateToken(user),
      };
    }

    // Mark as verified
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          ...userProvenance.eventflowEmailVerifiedProvenance(new Date().toISOString()),
          verificationToken: null,
          verificationTokenExpiresAt: null,
        },
      }
    );

    logger.info(`Email verified for user ${user.id}`);

    return {
      user: this._sanitizeUser(user),
      token: this.generateToken(user),
    };
  }

  /**
   * Generate JWT token for user
   * @param {Object} user - User object
   * @returns {string} - JWT token
   */
  generateToken(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });
  }

  /**
   * Validate JWT token
   * @param {string} token - JWT token
   * @returns {Object} - Decoded token
   */
  validateToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new AuthenticationError('Invalid token');
    }
  }

  /**
   * Check founder badge eligibility
   * @private
   */
  _checkFounderBadge(email) {
    const founderLaunchTs = process.env.FOUNDER_LAUNCH_TS || '2026-01-01T00:00:00Z';
    const founderLaunchDate = new Date(founderLaunchTs);
    const founderEndDate = new Date(founderLaunchDate);
    founderEndDate.setUTCMonth(founderEndDate.getUTCMonth() + 6);

    const now = new Date();
    const badges = [];
    if (now <= founderEndDate) {
      badges.push('founding');
      logger.info(`Founding badge awarded to ${email}`);
    }
    return badges;
  }

  /**
   * Update last login timestamp
   * @private
   */
  _updateLastLogin(userId) {
    dbUnified
      .updateOne('users', { id: userId }, { $set: { lastLoginAt: new Date().toISOString() } })
      .catch(e => logger.error('Failed to update lastLoginAt', e));
  }

  /**
   * Remove sensitive fields from user object
   * @private
   */
  _sanitizeUser(user) {
    // eslint-disable-next-line no-unused-vars
    const {
      passwordHash,
      resetToken,
      resetTokenExpiresAt,
      verificationToken,
      verificationTokenExpiresAt,
      ...sanitized
    } = user;
    return sanitized;
  }
}

module.exports = new AuthService();
