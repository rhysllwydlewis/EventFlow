'use strict';

const express = require('express');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const adminUserSummary = require('../services/adminUserSummary.service');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Access denied' });
  }
  return next();
}

router.get('/users/summary', requireAdmin, async (_req, res) => {
  try {
    const summary = await adminUserSummary.buildUserSummary();
    res.json({ ok: true, ...summary });
  } catch (err) {
    logger.error('[admin users/summary] Failed to build user summary', err && err.message);
    res.status(500).json({ ok: false, error: 'Failed to build user summary' });
  }
});

router.get('/users/list', requireAdmin, async (req, res) => {
  try {
    const result = await adminUserSummary.listUsers(req.query || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('[admin users/list] Failed to list users', err && err.message);
    res.status(500).json({ ok: false, error: 'Failed to list users', items: [] });
  }
});

router.get('/users/:id/detail', requireAdmin, async (req, res) => {
  try {
    const user = await adminUserSummary.getUserDetail(req.params.id);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    res.json({ ok: true, user });
  } catch (err) {
    logger.error('[admin users/:id/detail] Failed to load user detail', err && err.message);
    res.status(500).json({ ok: false, error: 'Failed to load user detail' });
  }
});

router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const allUsers = await dbUnified.read('users').catch(() => []);
    const users = (allUsers || []).map(user => adminUserSummary.projectUser(user, null));
    users.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    res.json({ items: users });
  } catch (err) {
    logger.error('[admin users] Failed to fetch users', err && err.message);
    res.status(500).json({ error: 'Failed to fetch users', items: [] });
  }
});

module.exports = router;
