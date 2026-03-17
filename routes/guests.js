/**
 * Guests Routes
 * Handles guest list management for user plans
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');

const router = express.Router();

// Field length limits
const MAX_GUEST_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 200;
const MAX_DIETARY_LENGTH = 500;
const MAX_NOTES_LENGTH = 1000;

/**
 * Middleware to verify plan ownership
 */
async function verifyPlanOwnership(req, res, next) {
  try {
    const { planId } = req.params;
    const userId = req.user.id;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === planId && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found or access denied' });
    }

    req.plan = plan;
    next();
  } catch (error) {
    logger.error('Error verifying plan ownership:', error);
    res.status(500).json({ error: 'Failed to verify plan access' });
  }
}

/**
 * GET /api/me/plans/:planId/guests
 * Get all guests for a plan
 */
router.get('/:planId/guests', authRequired, verifyPlanOwnership, async (req, res) => {
  try {
    const plan = req.plan;
    const guests = plan.guests || [];

    res.json({
      success: true,
      guests,
      count: guests.length,
    });
  } catch (error) {
    logger.error('Error fetching guests:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch guests',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * POST /api/me/plans/:planId/guests
 * Add a guest to a plan
 * Body: { name, email, plusOne, dietary, rsvpStatus, notes }
 */
router.post(
  '/:planId/guests',
  writeLimiter,
  authRequired,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    try {
      const { planId } = req.params;
      const { name, email, plusOne, dietary, rsvpStatus, notes } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Guest name is required' });
      }

      const now = new Date().toISOString();
      const newGuest = {
        id: uid('guest'),
        name: String(name).trim().slice(0, MAX_GUEST_NAME_LENGTH),
        email: email ? String(email).trim().slice(0, MAX_EMAIL_LENGTH) : null,
        plusOne: plusOne ? parseInt(plusOne, 10) || 0 : 0,
        dietary: dietary ? String(dietary).trim().slice(0, MAX_DIETARY_LENGTH) : null,
        rsvpStatus: rsvpStatus || 'pending',
        notes: notes ? String(notes).trim().slice(0, MAX_NOTES_LENGTH) : null,
        createdAt: now,
        updatedAt: now,
      };

      const plans = await dbUnified.read('plans');
      const plan = plans.find(p => p.id === planId);

      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      const guests = plan.guests || [];
      guests.push(newGuest);
      await dbUnified.updateOne(
        'plans',
        { id: planId },
        {
          $set: { guests, updatedAt: now },
        }
      );

      res.status(201).json({
        success: true,
        guest: newGuest,
      });
    } catch (error) {
      logger.error('Error adding guest:', error);
      res
        .status(500)
        .json({
          error: 'Failed to add guest',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * PATCH /api/me/plans/:planId/guests/:id
 * Update a guest
 * Body: { name?, email?, plusOne?, dietary?, rsvpStatus?, notes? }
 */
router.patch(
  '/:planId/guests/:id',
  writeLimiter,
  authRequired,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    try {
      const { planId, id } = req.params;
      const { name, email, plusOne, dietary, rsvpStatus, notes } = req.body;

      const plans = await dbUnified.read('plans');
      const plan = plans.find(p => p.id === planId);

      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      if (!plan.guests || !Array.isArray(plan.guests)) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      const guestIndex = plan.guests.findIndex(g => g.id === id);
      if (guestIndex === -1) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      const guest = { ...plan.guests[guestIndex] };
      const now = new Date().toISOString();

      if (name !== undefined) {
        guest.name = String(name).trim().slice(0, MAX_GUEST_NAME_LENGTH);
      }
      if (email !== undefined) {
        guest.email = email ? String(email).trim().slice(0, MAX_EMAIL_LENGTH) : null;
      }
      if (plusOne !== undefined) {
        guest.plusOne = plusOne ? parseInt(plusOne, 10) || 0 : 0;
      }
      if (dietary !== undefined) {
        guest.dietary = dietary ? String(dietary).trim().slice(0, MAX_DIETARY_LENGTH) : null;
      }
      if (rsvpStatus !== undefined) {
        guest.rsvpStatus = rsvpStatus;
      }
      if (notes !== undefined) {
        guest.notes = notes ? String(notes).trim().slice(0, MAX_NOTES_LENGTH) : null;
      }

      guest.updatedAt = now;
      const updatedGuests = [...plan.guests];
      updatedGuests[guestIndex] = guest;
      await dbUnified.updateOne(
        'plans',
        { id: planId },
        {
          $set: { guests: updatedGuests, updatedAt: now },
        }
      );

      res.json({
        success: true,
        guest,
      });
    } catch (error) {
      logger.error('Error updating guest:', error);
      res
        .status(500)
        .json({
          error: 'Failed to update guest',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * DELETE /api/me/plans/:planId/guests/:id
 * Remove a guest from a plan
 */
router.delete(
  '/:planId/guests/:id',
  writeLimiter,
  authRequired,
  csrfProtection,
  verifyPlanOwnership,
  async (req, res) => {
    try {
      const { planId, id } = req.params;

      const plans = await dbUnified.read('plans');
      const plan = plans.find(p => p.id === planId);

      if (!plan) {
        return res.status(404).json({ error: 'Plan not found' });
      }

      if (!plan.guests || !Array.isArray(plan.guests)) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      const guestIndex = plan.guests.findIndex(g => g.id === id);
      if (guestIndex === -1) {
        return res.status(404).json({ error: 'Guest not found' });
      }

      const updatedGuests = plan.guests.filter(g => g.id !== id);
      await dbUnified.updateOne(
        'plans',
        { id: planId },
        {
          $set: { guests: updatedGuests, updatedAt: new Date().toISOString() },
        }
      );

      res.json({
        success: true,
        message: 'Guest removed successfully',
      });
    } catch (error) {
      logger.error('Error deleting guest:', error);
      res
        .status(500)
        .json({
          error: 'Failed to delete guest',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

module.exports = router;
