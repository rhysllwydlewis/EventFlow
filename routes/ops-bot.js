'use strict';

const express = require('express');
const { verifyOpsBotHmac } = require('../middleware/opsBotHmac');
const { apiLimiter } = require('../middleware/rateLimits');
const reviewTasks = require('../services/contentReviewTask.service');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { getAuditLogs } = require('../middleware/audit');
const seoInsights = require('../services/seoInsights.service');
const seoDataStore = require('../services/seoDataStore');
const emailLog = require('../services/emailLog.service');
const { getFlaggedReviews } = require('../reviews');
const {
  VERIFICATION_STATES,
  normaliseState,
} = require('../utils/supplierVerificationStateMachine');

const router = express.Router();
router.use(apiLimiter, verifyOpsBotHmac);

const OPS_BOT_ACTOR = { id: 'ops-bot' };

function limitValue(value, fallback = 100, max = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

function handleReadError(res, area, error) {
  logger.error(`[OPS-BOT] Failed to read ${area}`, { error: error.message });
  return res.status(500).json({ ok: false, error: 'Internal server error' });
}

// --- Content review queue (existing) ---------------------------------

router.get('/content-review-tasks', async (_req, res) => {
  const tasks = await reviewTasks.listTasks();
  res.json({ ok: true, tasks });
});

router.patch('/content-review-tasks/:id', async (req, res) => {
  try {
    const task = await reviewTasks.updateTask(req.params.id, req.body || {}, OPS_BOT_ACTOR);
    if (!task) {
      return res.status(404).json({ ok: false, error: 'Review task not found' });
    }
    return res.json({ ok: true, task });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

// --- Read-only reporting/triage endpoints -----------------------------
// Everything below this line is GET-only: the worker can read and flag,
// never mutate. Enforcement/financial/config actions stay admin-only.

router.get('/audit-log', async (req, res) => {
  try {
    const logs = await getAuditLogs({
      adminId: req.query.adminId,
      adminEmail: req.query.adminEmail,
      action: req.query.action,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: limitValue(req.query.limit),
    });
    res.json({ ok: true, logs, count: logs.length });
  } catch (error) {
    handleReadError(res, 'audit log', error);
  }
});

router.get('/seo-insights/:report', async (req, res) => {
  const property = req.query.property || undefined;
  try {
    switch (req.params.report) {
      case 'status':
        return res.json({ ok: true, data: await seoDataStore.getAllIngestionStatus() });
      case 'overview':
        return res.json({ ok: true, data: await seoInsights.getOverview({ property }) });
      case 'striking-distance':
        return res.json({
          ok: true,
          data: await seoInsights.getStrikingDistanceReport({
            property,
            positionMin: req.query.positionMin,
            positionMax: req.query.positionMax,
            minImpressions: req.query.minImpressions,
          }),
        });
      case 'low-ctr':
        return res.json({
          ok: true,
          data: await seoInsights.getLowCtrReport({
            property,
            positionMax: req.query.positionMax,
            minImpressions: req.query.minImpressions,
          }),
        });
      case 'content-gaps':
        return res.json({
          ok: true,
          data: await seoInsights.getContentGapReport({ property, minVolume: req.query.minVolume }),
        });
      case 'financial-estimate':
        return res.json({
          ok: true,
          data: await seoInsights.getFinancialEstimate({ property }),
        });
      default:
        return res.status(404).json({ ok: false, error: 'Unknown SEO report' });
    }
  } catch (error) {
    handleReadError(res, 'SEO insights', error);
  }
});

router.get('/email-summary', async (_req, res) => {
  try {
    res.json({ ok: true, summary: await emailLog.getSummary() });
  } catch (error) {
    handleReadError(res, 'email summary', error);
  }
});

router.get('/email-logs', async (req, res) => {
  try {
    const result = await emailLog.listLogs({
      page: req.query.page,
      limit: limitValue(req.query.limit, 50, 200),
      recipient: req.query.recipient,
      status: req.query.status,
      template: req.query.template,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    handleReadError(res, 'email logs', error);
  }
});

router.get('/reviews/flagged', async (_req, res) => {
  try {
    res.json({ ok: true, reviews: await getFlaggedReviews() });
  } catch (error) {
    handleReadError(res, 'flagged reviews', error);
  }
});

router.get('/content-reports', async (req, res) => {
  try {
    let reports = (await dbUnified.read('reports')) || [];
    const status = req.query.status || 'pending';
    if (status !== 'all') {
      reports = reports.filter(r => r.status === status);
    }
    if (req.query.type) {
      reports = reports.filter(r => r.type === req.query.type);
    }
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const limit = limitValue(req.query.limit, 100, 500);
    res.json({ ok: true, reports: reports.slice(0, limit), total: reports.length });
  } catch (error) {
    handleReadError(res, 'content reports', error);
  }
});

router.get('/suppliers/pending-verification', async (_req, res) => {
  try {
    const suppliers = (await dbUnified.read('suppliers')) || [];
    const pending = suppliers.filter(
      s =>
        !s.verified &&
        (!s.verificationStatus ||
          s.verificationStatus === 'pending' ||
          s.verificationStatus === VERIFICATION_STATES.UNVERIFIED ||
          s.verificationStatus === VERIFICATION_STATES.PENDING_REVIEW)
    );
    res.json({
      ok: true,
      suppliers: pending.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        location: s.location,
        ownerUserId: s.ownerUserId,
        createdAt: s.createdAt,
        verificationStatus: normaliseState(s.verificationStatus, s.verified),
        submittedAt: s.verificationSubmittedAt || null,
      })),
      count: pending.length,
    });
  } catch (error) {
    handleReadError(res, 'pending supplier verifications', error);
  }
});

router.get('/suppliers/duplicates', async (_req, res) => {
  try {
    const suppliers = (await dbUnified.read('suppliers')) || [];
    const byOwner = new Map();
    for (const supplier of suppliers) {
      if (!supplier.ownerUserId) {
        continue;
      }
      const group = byOwner.get(supplier.ownerUserId) || [];
      group.push(supplier);
      byOwner.set(supplier.ownerUserId, group);
    }
    const duplicateGroups = [...byOwner.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([ownerUserId, group]) => ({
        ownerUserId,
        suppliers: group.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          location: s.location,
          createdAt: s.createdAt,
        })),
      }));
    res.json({ ok: true, duplicateGroups, count: duplicateGroups.length });
  } catch (error) {
    handleReadError(res, 'supplier duplicates', error);
  }
});

router.get('/partner-abuse/events', async (req, res) => {
  try {
    const limit = limitValue(req.query.limit);
    let events = (await dbUnified.read('partner_abuse_events')) || [];
    if (req.query.outcome) {
      events = events.filter(e => e.outcome === req.query.outcome);
    }
    if (req.query.riskLevel) {
      events = events.filter(e => e.riskLevel === req.query.riskLevel);
    }
    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, items: events.slice(0, limit), total: events.length });
  } catch (error) {
    handleReadError(res, 'partner abuse events', error);
  }
});

router.get('/partner-abuse/appeals', async (req, res) => {
  try {
    const limit = limitValue(req.query.limit);
    let appeals = (await dbUnified.read('partner_abuse_appeals')) || [];
    if (req.query.status) {
      appeals = appeals.filter(a => a.status === req.query.status);
    }
    appeals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, items: appeals.slice(0, limit), total: appeals.length });
  } catch (error) {
    handleReadError(res, 'partner abuse appeals', error);
  }
});

module.exports = router;
