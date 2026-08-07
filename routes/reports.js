/**
 * Content Reporting Routes
 * Handles user reports of inappropriate content, spam, and violations
 */

'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const { uid } = require('../store');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired } = require('../middleware/auth');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const { csrfProtection } = require('../middleware/csrf');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for report submissions (prevent spam)
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 reports per 15 minutes
  message: 'Too many reports submitted. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/reports
 * Create a new report
 * Body: { type, targetId, reason, details }
 */
router.post('/', authRequired, csrfProtection, reportLimiter, async (req, res) => {
  const { type, targetId, reason, details } = req.body;

  // Validate input
  if (!type || !targetId || !reason) {
    return res.status(400).json({
      error: 'Missing required fields: type, targetId, reason',
    });
  }

  const validTypes = ['supplier', 'review', 'message', 'user', 'photo'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      error: `Invalid report type. Must be one of: ${validTypes.join(', ')}`,
    });
  }

  const validReasons = [
    'spam',
    'inappropriate_content',
    'harassment',
    'false_information',
    'copyright_violation',
    'other',
  ];
  if (!validReasons.includes(reason)) {
    return res.status(400).json({
      error: `Invalid reason. Must be one of: ${validReasons.join(', ')}`,
    });
  }

  // Check if target exists
  let targetExists = false;
  let targetData = null;

  switch (type) {
    case 'supplier':
      targetData = await dbUnified.findOne('suppliers', { id: targetId });
      targetExists = !!targetData;
      break;
    case 'review':
      targetData = await dbUnified.findOne('reviews', { id: targetId });
      targetExists = !!targetData;
      break;
    case 'message':
      targetData = await dbUnified.findOne('messages', { id: targetId });
      targetExists = !!targetData;
      // Legacy messages are keyed by a string `id`; messenger v4 messages
      // live in a separate collection keyed by a Mongo ObjectId. Fall back
      // to that lookup so v4 chat messages can be reported too.
      if (!targetExists && /^[0-9a-f]{24}$/i.test(targetId)) {
        targetData = await dbUnified.findOne('chat_messages_v4', { _id: new ObjectId(targetId) });
        targetExists = !!targetData;
      }
      break;
    case 'user':
      targetData = await dbUnified.findOne('users', { id: targetId });
      targetExists = !!targetData;
      break;
    case 'photo': {
      // Photos are embedded in suppliers' photosGallery
      const suppliers = await dbUnified.read('suppliers');
      for (const supplier of suppliers) {
        if (
          supplier.photosGallery &&
          supplier.photosGallery.some(p => p.id === targetId || p.url === targetId)
        ) {
          targetExists = true;
          targetData = { supplierId: supplier.id };
          break;
        }
      }
      break;
    }
  }

  if (!targetExists) {
    return res.status(404).json({
      error: `${type} with ID ${targetId} not found`,
    });
  }

  // Check for duplicate reports (same user reporting same target)
  const existingReports = await dbUnified.read('reports');
  const duplicateReport = existingReports.find(
    r => r.reportedBy === req.user.id && r.targetId === targetId && r.status === 'pending'
  );

  if (duplicateReport) {
    return res.status(400).json({
      error: 'You have already reported this content',
    });
  }

  // Create report
  const now = new Date().toISOString();
  const report = {
    id: uid('report'),
    type,
    targetId,
    targetData, // Store snapshot of target for reference
    reason,
    details: details || '',
    reportedBy: req.user.id,
    reporterEmail: req.user.email,
    status: 'pending', // pending, reviewing, resolved, dismissed
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNotes: null,
    createdAt: now,
    updatedAt: now,
  };

  existingReports.push(report);
  const reportInserted = await dbUnified.insertOne('reports', report);
  if (!reportInserted) {
    logger.error('[REPORTS] insertOne failed', { reportId: report.id });
    return res.status(500).json({ error: 'Failed to submit report. Please try again.' });
  }

  logger.info(`New report created: ${type} ${targetId} by ${req.user.email}`);

  res.status(201).json({
    message: 'Report submitted successfully',
    report: {
      id: report.id,
      type: report.type,
      reason: report.reason,
      status: report.status,
      createdAt: report.createdAt,
    },
  });
});

/**
 * GET /api/admin/reports
 * List all reports (admin only)
 * Query params: status, type, page, perPage
 */
router.get('/admin/reports', authRequired, roleRequired('admin'), async (req, res) => {
  const { status, type, page = 1, perPage = 20 } = req.query;

  let reports = await dbUnified.read('reports');

  // Filter by status
  if (status) {
    reports = reports.filter(r => r.status === status);
  }

  // Filter by type
  if (type) {
    reports = reports.filter(r => r.type === type);
  }

  // Sort by createdAt descending (newest first)
  reports.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  // Pagination
  const pageNum = parseInt(page, 10);
  const perPageNum = parseInt(perPage, 10);
  const startIndex = (pageNum - 1) * perPageNum;
  const endIndex = startIndex + perPageNum;
  const paginatedReports = reports.slice(startIndex, endIndex);

  res.json({
    items: paginatedReports, // alias expected by admin-reports-init.js
    reports: paginatedReports,
    pagination: {
      page: pageNum,
      perPage: perPageNum,
      total: reports.length,
      totalPages: Math.ceil(reports.length / perPageNum),
    },
  });
});

/**
 * GET /api/admin/reports/pending
 * Get count of pending reports (admin only)
 */
router.get('/admin/reports/pending', authRequired, roleRequired('admin'), async (req, res) => {
  const reports = await dbUnified.read('reports');
  const pendingCount = reports.filter(r => r.status === 'pending').length;

  res.json({ count: pendingCount });
});

/**
 * GET /api/admin/reports/:id
 * Get a specific report (admin only)
 */
router.get('/admin/reports/:id', authRequired, roleRequired('admin'), async (req, res) => {
  const { id } = req.params;
  const report = await dbUnified.findOne('reports', { id });

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.json({ report });
});

/**
 * POST /api/admin/reports/:id/resolve
 * Resolve a report (admin only)
 * Body: { resolution, action, notes }
 * resolution: 'valid', 'invalid', 'duplicate'
 * action: 'content_removed', 'user_warned', 'user_suspended', 'no_action'
 */
router.post(
  '/admin/reports/:id/resolve',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const { resolution, action, notes } = req.body;

    if (!resolution) {
      return res.status(400).json({ error: 'Resolution is required' });
    }

    const validResolutions = ['valid', 'invalid', 'duplicate'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({
        error: `Invalid resolution. Must be one of: ${validResolutions.join(', ')}`,
      });
    }

    const report = await dbUnified.findOne('reports', { id });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (report.status === 'resolved' || report.status === 'dismissed') {
      return res.status(400).json({ error: 'Report has already been resolved' });
    }

    // Update report
    const now = new Date().toISOString();
    const setFields = {
      status: 'resolved',
      resolution,
      action: action || 'no_action',
      resolutionNotes: notes || '',
      resolvedBy: req.user.id,
      resolvedByEmail: req.user.email,
      resolvedAt: now,
      updatedAt: now,
    };

    await dbUnified.updateOne('reports', { id }, { $set: setFields });

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.REPORT_RESOLVED,
      targetType: 'report',
      targetId: id,
      details: {
        reportType: report.type,
        targetId: report.targetId,
        resolution,
        action,
        notes,
      },
    });

    logger.info(`Report ${id} resolved by ${req.user.email}: ${resolution}`);

    res.json({
      message: 'Report resolved successfully',
      report,
    });
  }
);

/**
 * POST /api/admin/reports/:id/dismiss
 * Dismiss a report without action (admin only)
 */
router.post(
  '/admin/reports/:id/dismiss',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;

    const report = await dbUnified.findOne('reports', { id });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Update report
    const now = new Date().toISOString();
    await dbUnified.updateOne(
      'reports',
      { id },
      {
        $set: {
          status: 'dismissed',
          resolution: 'invalid',
          action: 'no_action',
          resolutionNotes: notes || 'Dismissed by admin',
          resolvedBy: req.user.id,
          resolvedByEmail: req.user.email,
          resolvedAt: now,
          updatedAt: now,
        },
      }
    );

    // Create audit log
    auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: AUDIT_ACTIONS.REPORT_DISMISSED,
      targetType: 'report',
      targetId: id,
      details: {
        reportType: report.type,
        targetId: report.targetId,
        notes,
      },
    });

    logger.info(`Report ${id} dismissed by ${req.user.email}`);

    res.json({
      message: 'Report dismissed successfully',
      report,
    });
  }
);

module.exports = router;
