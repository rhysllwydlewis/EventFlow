/**
 * Plans Routes
 * Handles user wedding/event plans (timeline, budgets, checklists)
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { stripHtml } = require('../utils/helpers');

const router = express.Router();

/**
 * GET /api/me/plans
 * Get all plans for the current user
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const plans = await dbUnified.read('plans');
    const userPlans = plans.filter(p => p.userId === userId);

    res.json({
      ok: true,
      plans: userPlans,
      count: userPlans.length,
    });
  } catch (error) {
    logger.error('Error fetching plans:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch plans',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * GET /api/me/plans/:id
 * Get a specific plan by ID
 */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === id && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ plan });
  } catch (error) {
    logger.error('Error fetching plan:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch plan',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * POST /api/me/plans
 * Create a new plan
 * Body: { name, eventType, eventDate, location, guests, budget, notes, packages, timeline, checklist }
 */

// Maximum plans allowed per user (free tier)
const MAX_PLANS_PER_USER = 3;
// Maximum packages per plan
const MAX_PACKAGES_PER_PLAN = 20;
// Maximum guests per event (sanity cap)
const MAX_GUESTS_PER_PLAN = 10000;

router.post('/', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      name,
      eventName,
      eventType,
      eventDate,
      date,
      location,
      guests,
      budget,
      notes,
      packages,
      timeline,
      checklist,
    } = req.body;

    // Backward compatibility: older clients submit eventType without name,
    // while newer clients submit a human-friendly plan name.
    const resolvedName =
      (name && String(name).trim()) ||
      (eventName && String(eventName).trim()) ||
      (eventType && `${String(eventType).trim()} Plan`) ||
      '';

    if (!resolvedName) {
      return res.status(400).json({ error: 'Plan name or event type is required' });
    }

    // Plan creation limit per user (Bug 3.3 — free tier cap)
    const plans = await dbUnified.read('plans');
    const userPlanCount = plans.filter(p => p.userId === userId).length;
    if (userPlanCount >= MAX_PLANS_PER_USER) {
      return res.status(403).json({
        error: 'Plan limit reached',
        message: `You have reached the maximum of ${MAX_PLANS_PER_USER} plans. Please delete an existing plan to create a new one.`,
      });
    }

    // Input sanitization (Bug 3.2)
    const sanitizedGuests = guests
      ? Math.max(0, Math.min(MAX_GUESTS_PER_PLAN, parseInt(guests, 10) || 0))
      : null;
    const sanitizedBudget = budget ? stripHtml(String(budget).trim()).slice(0, 100) : null;
    const sanitizedNotes = notes ? stripHtml(String(notes).trim()).slice(0, 2000) : null;
    const sanitizedPackages = Array.isArray(packages)
      ? packages
          .slice(0, MAX_PACKAGES_PER_PLAN)
          .map(p => String(p).trim())
          .filter(Boolean)
      : [];

    // Validate date if provided (discard unparseable values; past dates are allowed for re-scheduling)
    let resolvedDate = eventDate || date || null;
    if (resolvedDate) {
      const dateObj = new Date(resolvedDate);
      if (isNaN(dateObj.getTime())) {
        resolvedDate = null; // Discard invalid dates
      }
    }

    const now = new Date().toISOString();
    const newPlan = {
      id: uid('plan'),
      userId,
      name: stripHtml(resolvedName).slice(0, 200),
      eventName: eventName ? stripHtml(String(eventName).trim()).slice(0, 200) : null,
      eventType: eventType ? String(eventType).trim().slice(0, 100) : null,
      eventDate: resolvedDate,
      date: resolvedDate, // legacy field support
      location: location ? stripHtml(String(location).trim()).slice(0, 200) : null,
      guests: sanitizedGuests,
      budget: sanitizedBudget,
      notes: sanitizedNotes,
      packages: sanitizedPackages,
      timeline: Array.isArray(timeline) ? timeline : [],
      checklist: Array.isArray(checklist) ? checklist : [],
      createdAt: now,
      updatedAt: now,
    };

    await dbUnified.insertOne('plans', newPlan);

    // Return both modern and legacy success flags for compatibility.
    res.status(200).json({
      ok: true,
      success: true,
      plan: newPlan,
    });
  } catch (error) {
    logger.error('Error creating plan:', error);
    res
      .status(500)
      .json({
        error: 'Failed to create plan',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * PATCH /api/me/plans/:id
 * Update an existing plan
 * Body: { name?, eventType?, eventDate?, location?, guests?, budget?, timeline?, checklist? }
 */
router.patch('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === id && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const { name, eventType, eventDate, location, guests, budget, notes, timeline, checklist } =
      req.body;
    const planUpdates = {};

    // Update fields if provided — mirror POST sanitization rules
    if (name !== undefined) {
      planUpdates.name = stripHtml(String(name).trim()).slice(0, 200);
    }
    if (eventType !== undefined) {
      planUpdates.eventType = eventType ? stripHtml(String(eventType).trim()).slice(0, 100) : null;
    }
    if (eventDate !== undefined) {
      if (eventDate) {
        const dateObj = new Date(eventDate);
        planUpdates.eventDate = isNaN(dateObj.getTime()) ? null : eventDate;
      } else {
        planUpdates.eventDate = null;
      }
    }
    if (location !== undefined) {
      planUpdates.location = location ? stripHtml(String(location).trim()).slice(0, 200) : null;
    }
    if (guests !== undefined) {
      planUpdates.guests = guests
        ? Math.max(0, Math.min(MAX_GUESTS_PER_PLAN, parseInt(guests, 10) || 0))
        : null;
    }
    if (budget !== undefined) {
      planUpdates.budget = budget ? stripHtml(String(budget).trim()).slice(0, 100) : null;
    }
    if (notes !== undefined) {
      planUpdates.notes = notes ? stripHtml(String(notes).trim()).slice(0, 2000) : null;
    }
    if (timeline !== undefined) {
      planUpdates.timeline = Array.isArray(timeline) ? timeline : [];
    }
    if (checklist !== undefined) {
      planUpdates.checklist = Array.isArray(checklist) ? checklist : [];
    }

    planUpdates.updatedAt = new Date().toISOString();
    await dbUnified.updateOne('plans', { id }, { $set: planUpdates });

    res.json({
      success: true,
      plan: { ...plan, ...planUpdates },
    });
  } catch (error) {
    logger.error('Error updating plan:', error);
    res
      .status(500)
      .json({
        error: 'Failed to update plan',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * DELETE /api/me/plans/:id
 * Delete a plan
 */
router.delete('/:id', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === id && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    await dbUnified.deleteOne('plans', id);

    res.json({
      success: true,
      message: 'Plan deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting plan:', error);
    res
      .status(500)
      .json({
        error: 'Failed to delete plan',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * GET /api/me/plans/:planId/budget
 * Get budget items for a plan
 */
router.get('/:planId/budget', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId } = req.params;

    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === planId && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const budgetItems = plan.budgetItems || [];

    res.json({
      success: true,
      budgetItems,
      count: budgetItems.length,
      totalEstimated: budgetItems.reduce((sum, item) => sum + (item.estimated || 0), 0),
      totalActual: budgetItems.reduce((sum, item) => sum + (item.actual || 0), 0),
      totalPaid: budgetItems.reduce((sum, item) => sum + (item.paid || 0), 0),
    });
  } catch (error) {
    logger.error('Error fetching budget:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch budget',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * GET /api/me/plans/:id/export
 * Export plan as PDF (P3-20: PDF Export for Plans)
 */
router.get('/:id/export', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === id && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Import PDFKit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="eventflow-plan-${plan.id}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('EventFlow Plan', { align: 'center' });
    doc.moveDown(0.5);

    // Plan Details
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text(plan.name || 'Untitled Event', 100, 120);
    doc.moveDown(0.5);

    doc.fontSize(12).font('Helvetica');
    if (plan.eventType) {
      doc.text(`Event Type: ${plan.eventType}`, 100, doc.y);
    }
    if (plan.eventDate) {
      doc.text(`Event Date: ${new Date(plan.eventDate).toLocaleDateString()}`, 100, doc.y + 20);
    }
    if (plan.location) {
      doc.text(`Location: ${plan.location}`, 100, doc.y + 20);
    }
    if (plan.guests) {
      doc.text(`Number of Guests: ${plan.guests}`, 100, doc.y + 20);
    }
    if (plan.budget) {
      // budget is stored as a display string (e.g. "£1,000–£3,000"); use it directly
      doc.text(`Budget: ${plan.budget}`, 100, doc.y + 20);
    }

    doc.moveDown(2);

    // Budget Items Section
    if (plan.budgetItems && plan.budgetItems.length > 0) {
      doc.fontSize(14).font('Helvetica-Bold').text('Budget Breakdown', 100, doc.y);
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica');
      plan.budgetItems.forEach((item, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }
        doc.text(
          `${index + 1}. ${item.category || 'Other'} - ${item.item || 'Unnamed'}`,
          100,
          doc.y
        );
        doc.text(
          `   Estimated: £${(item.estimated || 0).toFixed(2)} | Actual: £${(item.actual || 0).toFixed(2)} | Paid: £${(item.paid || 0).toFixed(2)}`,
          100,
          doc.y + 15
        );
        if (item.notes) {
          doc.text(`   Notes: ${item.notes}`, 100, doc.y + 15);
        }
        doc.moveDown(0.5);
      });

      // Total Budget Summary
      const totalEstimated = plan.budgetItems.reduce((sum, item) => sum + (item.estimated || 0), 0);
      const totalActual = plan.budgetItems.reduce((sum, item) => sum + (item.actual || 0), 0);
      const totalPaid = plan.budgetItems.reduce((sum, item) => sum + (item.paid || 0), 0);

      doc.moveDown(1);
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text(`Total Estimated: £${totalEstimated.toFixed(2)}`, 100, doc.y);
      doc.text(`Total Actual: £${totalActual.toFixed(2)}`, 100, doc.y + 20);
      doc.text(`Total Paid: £${totalPaid.toFixed(2)}`, 100, doc.y + 20);
    }

    // Checklist Section
    if (plan.checklist && plan.checklist.length > 0) {
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text('Event Checklist', 100, 100);
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica');
      plan.checklist.forEach((item, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }
        const status = item.completed ? '✓' : '☐';
        doc.text(`${status} ${item.task || item.name || `Item ${index + 1}`}`, 100, doc.y);
        if (item.dueDate) {
          doc.text(`   Due: ${new Date(item.dueDate).toLocaleDateString()}`, 100, doc.y + 15);
        }
        doc.moveDown(0.5);
      });
    }

    // Timeline Section
    if (plan.timeline && plan.timeline.length > 0) {
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text('Event Timeline', 100, 100);
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica');
      plan.timeline.forEach((item, index) => {
        if (doc.y > 700) {
          doc.addPage();
        }
        doc.text(
          `${item.time || ''} - ${item.activity || item.name || `Activity ${index + 1}`}`,
          100,
          doc.y
        );
        if (item.notes) {
          doc.text(`   ${item.notes}`, 100, doc.y + 15);
        }
        doc.moveDown(0.5);
      });
    }

    // Footer
    doc
      .fontSize(8)
      .font('Helvetica')
      .text(`Generated by EventFlow on ${new Date().toLocaleString()}`, 100, doc.page.height - 50, {
        align: 'center',
      });

    // Finalize PDF
    doc.end();
  } catch (error) {
    logger.error('Error exporting plan to PDF:', error);
    // If headers not sent yet, send error response
    if (!res.headersSent) {
      res
        .status(500)
        .json({
          error: 'Failed to export PDF',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
});

/**
 * POST /api/me/plans/:planId/budget
 * Save budget items for a plan
 * Body: { budgetItems: [{ category, item, estimated, actual, paid, notes }] }
 */
router.post('/:planId/budget', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { planId } = req.params;
    const { budgetItems } = req.body;

    if (!Array.isArray(budgetItems)) {
      return res.status(400).json({ error: 'budgetItems must be an array' });
    }

    const plans = await dbUnified.read('plans');
    const plan = plans.find(p => p.id === planId && p.userId === userId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const now = new Date().toISOString();

    // Validate and sanitize budget items
    const sanitizedItems = budgetItems.map(item => ({
      id: item.id || uid('budget'),
      category: item.category ? stripHtml(String(item.category).trim()).slice(0, 100) : '',
      item: item.item ? stripHtml(String(item.item).trim()).slice(0, 200) : '',
      estimated: item.estimated ? Math.max(0, parseFloat(item.estimated) || 0) : 0,
      actual: item.actual ? Math.max(0, parseFloat(item.actual) || 0) : 0,
      paid: item.paid ? Math.max(0, parseFloat(item.paid) || 0) : 0,
      notes: item.notes ? stripHtml(String(item.notes).trim()).slice(0, 500) : '',
      updatedAt: now,
    }));

    await dbUnified.updateOne(
      'plans',
      { id: planId },
      {
        $set: { budgetItems: sanitizedItems, updatedAt: now },
      }
    );

    res.json({
      success: true,
      budgetItems: sanitizedItems,
      count: sanitizedItems.length,
    });
  } catch (error) {
    logger.error('Error saving budget:', error);
    res
      .status(500)
      .json({
        error: 'Failed to save budget',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

module.exports = router;
