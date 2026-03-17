/**
 * Referrals Routes (P3-27: Referral Tracking)
 * Handles user referral system for growth tracking
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const crypto = require('crypto');

const router = express.Router();

/**
 * Generate a unique referral code for a user
 * Uses crypto random bytes for security
 */
function generateReferralCode(userId) {
  // Create a unique referral code with random salt for security
  const randomSalt = crypto.randomBytes(4).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(userId + randomSalt)
    .digest('hex');
  return hash.substring(0, 8).toUpperCase();
}

/**
 * GET /api/me/referrals
 * Get referral information for the current user
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get or create referral code for user
    const users = await dbUnified.read('users');
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[userIndex];

    // Generate referral code if user doesn't have one
    if (!user.referralCode) {
      user.referralCode = generateReferralCode(userId);
      await dbUnified.updateOne(
        'users',
        { id: userId },
        { $set: { referralCode: user.referralCode } }
      );
    }

    const referralCode = user.referralCode;

    // Get referrals made by this user
    const referrals = await dbUnified.read('referrals');
    const userReferrals = referrals.filter(r => r.referrerId === userId);

    // Count active referrals (users who completed registration)
    const activeReferrals = userReferrals.filter(
      r => r.status === 'active' || r.status === 'completed'
    );

    res.json({
      success: true,
      referralCode,
      referralLink: `${process.env.BASE_URL || 'https://event-flow.co.uk'}?ref=${referralCode}`,
      count: userReferrals.length,
      activeCount: activeReferrals.length,
      referrals: userReferrals.map(r => ({
        id: r.id,
        referredUserId: r.referredUserId,
        status: r.status,
        createdAt: r.createdAt,
        // Don't expose sensitive user data
      })),
    });
  } catch (error) {
    logger.error('Error fetching referrals:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch referrals',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * POST /api/referrals/track
 * Track a referral when a new user signs up
 * Body: { referralCode, newUserId }
 */
router.post('/track', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const { referralCode, newUserId } = req.body;

    if (!referralCode || !newUserId) {
      return res.status(400).json({ error: 'Referral code and new user ID are required' });
    }

    // Find the referrer by their referral code
    const users = await dbUnified.read('users');
    const referrer = users.find(u => u.referralCode === referralCode);

    if (!referrer) {
      // Silently fail - don't reveal whether code is valid
      return res.json({ success: true, message: 'Referral tracked' });
    }

    // Check if this referral already exists
    const referrals = await dbUnified.read('referrals');
    const existingReferral = referrals.find(r => r.referredUserId === newUserId);

    if (existingReferral) {
      // Already tracked
      return res.json({ success: true, message: 'Referral already tracked' });
    }

    // Create new referral record
    const newReferral = {
      id: uid('ref'),
      referrerId: referrer.id,
      referredUserId: newUserId,
      referralCode,
      status: 'pending', // pending -> active -> completed
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbUnified.insertOne('referrals', newReferral);

    res.json({ success: true, message: 'Referral tracked successfully' });
  } catch (error) {
    logger.error('Error tracking referral:', error);
    // Fail silently to prevent abuse
    res.json({ success: true, message: 'Referral processed' });
  }
});

/**
 * PATCH /api/referrals/:id/activate
 * Mark a referral as active when the referred user completes onboarding
 * Admin or system use
 */
router.patch('/:id/activate', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const referrals = await dbUnified.read('referrals');
    const referralIndex = referrals.findIndex(r => r.id === id);

    if (referralIndex === -1) {
      return res.status(404).json({ error: 'Referral not found' });
    }

    const activatedAt = new Date().toISOString();
    await dbUnified.updateOne(
      'referrals',
      { id },
      {
        $set: { status: 'active', activatedAt, updatedAt: activatedAt },
      }
    );

    res.json({ success: true, message: 'Referral activated' });
  } catch (error) {
    logger.error('Error activating referral:', error);
    res
      .status(500)
      .json({
        error: 'Failed to activate referral',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * GET /api/admin/referrals/stats
 * Get referral statistics (admin only)
 */
router.get('/stats', authRequired, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const referrals = await dbUnified.read('referrals');
    const users = await dbUnified.read('users');

    // Calculate stats
    const totalReferrals = referrals.length;
    const activeReferrals = referrals.filter(r => r.status === 'active').length;
    const completedReferrals = referrals.filter(r => r.status === 'completed').length;

    // Top referrers
    const referrerCounts = {};
    referrals.forEach(r => {
      referrerCounts[r.referrerId] = (referrerCounts[r.referrerId] || 0) + 1;
    });

    const topReferrers = Object.entries(referrerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => {
        const user = users.find(u => u.id === userId);
        return {
          userId,
          name: user ? user.name : 'Unknown',
          email: user ? user.email : 'Unknown',
          referralCount: count,
        };
      });

    res.json({
      success: true,
      stats: {
        total: totalReferrals,
        active: activeReferrals,
        completed: completedReferrals,
        pending: totalReferrals - activeReferrals - completedReferrals,
      },
      topReferrers,
    });
  } catch (error) {
    logger.error('Error fetching referral stats:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch referral stats',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

module.exports = router;
