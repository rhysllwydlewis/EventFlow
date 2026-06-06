/**
 * Customer Dashboard API
 * Aggregated endpoints for the customer dashboard — replaces scattered
 * per-feature fetches with focused, permission-checked calls.
 */

'use strict';

const express = require('express');
const { authRequired } = require('../middleware/auth');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/v1/customer/dashboard-summary
 * Returns plans, budget, saved-supplier count, upcoming events, and ticket stats
 * in a single authenticated call for the customer dashboard.
 */
router.get('/dashboard-summary', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Only customers can access this endpoint' });
    }
    const userId = req.user.id;

    const [plans, savedItems, tickets, calendarEntries] = await Promise.all([
      dbUnified.find('plans', { userId }).catch(() => []),
      dbUnified.find('savedItems', { userId }).catch(() => []),
      dbUnified.find('tickets', { senderId: userId, senderType: 'customer' }).catch(() => []),
      dbUnified.find('customer_calendar_entries', { userId }).catch(() => []),
    ]);

    // Plans summary
    const plansSummary = {
      total: plans.length,
      recentPlan:
        [...plans].sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
        )[0] || null,
    };

    // Resolve package IDs across all plans to calculate spent budget
    // plan.packages stores string IDs — must look up full package docs for prices
    const allPackageIds = [
      ...new Set(
        plans.flatMap(p => (p.packages || []).filter(id => typeof id === 'string' && id.trim()))
      ),
    ];
    const packageDocs =
      allPackageIds.length > 0
        ? (
            await Promise.all(
              allPackageIds.map(id => dbUnified.findOne('packages', { id }).catch(() => null))
            )
          ).filter(Boolean)
        : [];

    // Build a price map for fast lookup
    const priceMap = {};
    packageDocs.forEach(pkg => {
      const raw = String(pkg.price || pkg.price_display || '0');
      const num = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
      priceMap[pkg.id] = num;
    });

    // Budget summary from most recent plan
    const activePlan = plansSummary.recentPlan;
    let budgetSummary = { total: 0, spent: 0, remaining: 0, percentUsed: 0 };
    if (activePlan) {
      const rawTotal = activePlan.budget || activePlan.totalBudget || 0;
      const total =
        typeof rawTotal === 'number'
          ? rawTotal
          : parseFloat(String(rawTotal).replace(/[^0-9.]/g, '')) || 0;
      const spent = (activePlan.packages || []).reduce((sum, pkgId) => {
        return sum + (priceMap[pkgId] || 0);
      }, 0);
      const remaining = Math.max(0, total - spent);
      budgetSummary = {
        total,
        spent,
        remaining,
        percentUsed: total > 0 ? Math.round((spent / total) * 100) : 0,
      };
    }

    // Upcoming events (next 90 days)
    const now = new Date();
    const soon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const upcomingEvents = calendarEntries
      .filter(e => {
        const d = new Date(e.start || e.date || e.createdAt);
        return d >= now && d <= soon;
      })
      .sort((a, b) => new Date(a.start || a.date) - new Date(b.start || b.date))
      .slice(0, 5);

    // Tickets summary
    const ticketsSummary = {
      total: tickets.length,
      open: tickets.filter(t => t.status === 'open').length,
      inProgress: tickets.filter(t => t.status === 'in_progress').length,
    };

    res.json({
      plans: plansSummary,
      budget: budgetSummary,
      savedSuppliers: { total: savedItems.length },
      upcomingEvents,
      tickets: ticketsSummary,
    });
  } catch (error) {
    logger.error('customer dashboard-summary error:', error.message);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

/**
 * GET /api/v1/customer/event-countdown
 * Returns days until the nearest upcoming event date across all plans.
 */
router.get('/event-countdown', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const plans = await dbUnified.find('plans', { userId: req.user.id }).catch(() => []);
    const now = new Date();

    const upcoming = plans
      .map(p => ({
        id: p.id,
        name: p.name || p.eventName || p.eventType || 'My Event',
        date: p.eventDate || p.date || null,
        daysUntil:
          p.eventDate || p.date
            ? Math.ceil((new Date(p.eventDate || p.date) - now) / (1000 * 60 * 60 * 24))
            : null,
      }))
      .filter(p => p.daysUntil !== null && p.daysUntil >= 0)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    res.json({ events: upcoming, nearest: upcoming[0] || null });
  } catch (error) {
    logger.error('event-countdown error:', error.message);
    res.status(500).json({ error: 'Failed to load event countdown' });
  }
});

/**
 * GET /api/v1/customer/milestones
 * Returns a personalised milestone checklist based on plan state.
 */
router.get('/milestones', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = req.user.id;
    const [plans, savedItems] = await Promise.all([
      dbUnified.find('plans', { userId }).catch(() => []),
      dbUnified.find('savedItems', { userId }).catch(() => []),
    ]);

    const hasPlan = plans.length > 0;
    const hasDate = plans.some(p => p.eventDate || p.date);
    const hasLocation = plans.some(p => p.location);
    const hasGuestCount = plans.some(p => p.guestCount || p.guests);
    const hasBudget = plans.some(p => p.budget || p.totalBudget);
    const hasSavedSuppliers = savedItems.length > 0;
    // hasVenue: check savedItems category only (plan.packages stores IDs — resolving
    // them here would add extra DB queries; savedItems is the reliable signal)
    const hasVenue = savedItems.some(s =>
      (s.category || s.itemType || '').toLowerCase().includes('venue')
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
        label: 'Enquire about a venue',
        done: hasVenue,
        href: '/suppliers?category=Venues',
        priority: 7,
      },
    ];

    const completed = milestones.filter(m => m.done).length;
    const total = milestones.length;
    const percent = Math.round((completed / total) * 100);

    res.json({ milestones, completed, total, percent });
  } catch (error) {
    logger.error('milestones error:', error.message);
    res.status(500).json({ error: 'Failed to load milestones' });
  }
});

module.exports = router;
