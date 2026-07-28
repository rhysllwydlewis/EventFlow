'use strict';

const express = require('express');
const validator = require('validator');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const logger = require('../utils/logger');
const riskService = require('../services/partnerRegistrationRiskService');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));

function limitValue(value, fallback = 100, max = 500) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, parsed)) : fallback;
}

router.get('/events', async (req, res) => {
  try {
    const limit = limitValue(req.query.limit);
    const outcome = String(req.query.outcome || '').trim();
    const riskLevel = String(req.query.riskLevel || '').trim();
    let events = (await dbUnified.read('partner_abuse_events')) || [];
    if (outcome) events = events.filter(event => event.outcome === outcome);
    if (riskLevel) events = events.filter(event => event.riskLevel === riskLevel);
    events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ items: events.slice(0, limit), total: events.length });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to list events', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/appeals', async (req, res) => {
  try {
    const limit = limitValue(req.query.limit);
    const status = String(req.query.status || '').trim();
    let appeals = (await dbUnified.read('partner_abuse_appeals')) || [];
    if (status) appeals = appeals.filter(appeal => appeal.status === status);
    appeals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ items: appeals.slice(0, limit), total: appeals.length });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to list appeals', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/appeals/:id', csrfProtection, async (req, res) => {
  try {
    const allowed = new Set(['open', 'accepted', 'rejected', 'resolved']);
    const status = String(req.body?.status || '').trim();
    const note = String(req.body?.internalNote || '').trim();
    if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid appeal status.' });
    if (status !== 'open' && note.length < 20) {
      return res.status(400).json({ error: 'A resolution note of at least 20 characters is required.' });
    }
    const now = new Date().toISOString();
    const updated = await dbUnified.updateOne(
      'partner_abuse_appeals',
      { id: req.params.id },
      {
        $set: {
          status,
          internalNote: note || null,
          reviewedBy: req.user.id,
          reviewedAt: status === 'open' ? null : now,
          updatedAt: now,
        },
      }
    );
    if (!updated) return res.status(404).json({ error: 'Appeal not found.' });
    return res.json({ ok: true });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to update appeal', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/overrides', async (_req, res) => {
  try {
    const overrides = (await dbUnified.read('partner_abuse_overrides')) || [];
    overrides.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ items: overrides.slice(0, 200), total: overrides.length });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to list overrides', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/overrides', csrfProtection, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Valid email required.' });
    if (reason.length < 20) {
      return res.status(400).json({ error: 'Override reason must be at least 20 characters.' });
    }
    const override = await riskService.createRegistrationOverride({
      email,
      reason,
      adminUserId: req.user.id,
      expiresInDays: req.body?.expiresInDays,
    });
    return res.status(201).json({ ok: true, override });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to create override', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/overrides/:id/revoke', csrfProtection, async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 20) {
      return res.status(400).json({ error: 'Revocation reason must be at least 20 characters.' });
    }
    const updated = await dbUnified.updateOne(
      'partner_abuse_overrides',
      { id: req.params.id },
      {
        $set: {
          revokedAt: new Date().toISOString(),
          revokedBy: req.user.id,
          revokeReason: reason.slice(0, 1000),
        },
      }
    );
    if (!updated) return res.status(404).json({ error: 'Override not found.' });
    return res.json({ ok: true });
  } catch (error) {
    logger.error('[ADMIN-PARTNER-ABUSE] Failed to revoke override', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/config', (_req, res) => {
  const config = riskService.getConfig();
  return res.json({
    mode: config.mode,
    retentionDays: config.retentionDays,
    appealRetentionDays: config.appealRetentionDays,
    reviewScore: config.reviewScore,
    blockScore: config.blockScore,
    ipWindowHours: config.ipWindowHours,
    ipRegistrationMax: config.ipRegistrationMax,
    subnetRegistrationMax: config.subnetRegistrationMax,
    browserRegistrationMax: config.browserRegistrationMax,
    deviceNetworkRegistrationMax: config.deviceNetworkRegistrationMax,
    referralRegistrationMax: config.referralRegistrationMax,
    domainRegistrationMax: config.domainRegistrationMax,
    reputationProviderConfigured: Boolean(process.env.PARTNER_ABUSE_IP_REPUTATION_URL),
  });
});

module.exports = router;
