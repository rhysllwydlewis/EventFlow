/**
 * Customer Dashboard API
 * Read-only endpoints for the customer dashboard.
 */

'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const router = express.Router();

/** True when a supplier's category names a venue ("Venues", "Wedding venue"). */
const isVenueCategory = category => /venue/iu.test(String(category || ''));

/** A saved or requested supplier's category, whichever name the record uses. */
const categoryOf = item => item?.category || item?.itemType || '';

/**
 * GET /api/v1/customer/milestones[?planId=<id>]
 * Returns a personalised milestone checklist based on plan state.
 *
 * With `planId` the plan-level steps (date, budget, guests, location) describe that one plan,
 * which is how the dashboard asks: its summary row talks about a single "focus plan", and a
 * checklist that ticked "Set your event date" because a different plan has one would contradict
 * the countdown beside it. Without `planId`, or with one that is not the caller's, a step is done
 * when any of the customer's plans has it. Saved suppliers and venue enquiries belong to the
 * customer, not to a plan, so they are the same either way. The reply says which it used in `scope`.
 */
router.get('/milestones', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = req.user.id;
    // "Saved suppliers" on the dashboard is the shortlist, so the checklist reads the same record.
    const [plans, shortlist, quoteRequests] = await Promise.all([
      dbUnified.find('plans', { userId }).catch(() => []),
      dbUnified.findOne('shortlists', { userId }).catch(() => null),
      dbUnified.find('quoteRequests', { userId }).catch(() => []),
    ]);

    const hasPlan = plans.length > 0;
    const requestedPlanId = typeof req.query.planId === 'string' ? req.query.planId : '';
    const focusPlan = requestedPlanId ? plans.find(p => p.id === requestedPlanId) : null;
    const scope = focusPlan ? 'plan' : 'account';
    const planLevel = focusPlan ? [focusPlan] : plans;
    const hasDate = planLevel.some(p => p.eventDate || p.date);
    const hasLocation = planLevel.some(p => p.location);
    // `guests` is a head count on newer plans and the guest list itself on older ones, which keep
    // new guests in `guestList`; an empty list is still an array, so it is measured, not truthy.
    const listLength = value => (Array.isArray(value) ? value.length : 0);
    const hasGuestCount = planLevel.some(
      p =>
        Number(p.guestCount) > 0 ||
        listLength(p.guests) > 0 ||
        listLength(p.guestList) > 0 ||
        (!Array.isArray(p.guests) && Number(p.guests) > 0)
    );
    // The budget form saves a number. The plan wizard saves a range as text ("£3,000–£5,000"),
    // which is a starting point, not a total to plan against, so only a figure counts here: the
    // budget card on the dashboard shows "Not set" for the same plan.
    const hasBudget = planLevel.some(
      p => parseFloat(p.budget) > 0 || parseFloat(p.totalBudget) > 0
    );

    const savedSuppliers = (Array.isArray(shortlist?.items) ? shortlist.items : []).filter(
      item => (item.type || item.itemType || 'supplier') === 'supplier'
    );
    const hasSavedSuppliers = savedSuppliers.length > 0;
    // A venue counts once it is shortlisted or has been sent a quote request.
    const hasVenue =
      savedSuppliers.some(item => isVenueCategory(categoryOf(item))) ||
      quoteRequests.some(request =>
        (Array.isArray(request.suppliers) ? request.suppliers : []).some(supplier =>
          isVenueCategory(categoryOf(supplier))
        )
      );

    const milestones = [
      {
        id: 'create-plan',
        label: 'Create your event plan',
        done: hasPlan,
        href: '/start',
        priority: 1,
      },
      { id: 'set-date', label: 'Set your event date', done: hasDate, href: '/start', priority: 2 },
      {
        id: 'set-budget',
        label: 'Set your budget',
        done: hasBudget,
        href: '#budget-settings-form',
        priority: 3,
      },
      {
        id: 'set-guests',
        label: 'Add guest count',
        done: hasGuestCount,
        href: '/start',
        priority: 4,
      },
      {
        id: 'set-location',
        label: 'Choose a location',
        done: hasLocation,
        href: '/start',
        priority: 5,
      },
      {
        id: 'save-supplier',
        label: 'Save your first supplier',
        done: hasSavedSuppliers,
        href: '/suppliers',
        priority: 6,
      },
      {
        id: 'book-venue',
        label: 'Shortlist or enquire about a venue',
        done: hasVenue,
        href: '/suppliers?category=Venues',
        priority: 7,
      },
    ];

    const completed = milestones.filter(m => m.done).length;
    const total = milestones.length;
    const percent = Math.round((completed / total) * 100);

    res.json({ milestones, completed, total, percent, scope });
  } catch (error) {
    logger.error('milestones error:', error.message);
    res.status(500).json({ error: 'Failed to load milestones' });
  }
});

module.exports = router;
