'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const strictStore = require('./partnerCashoutStrictStore');
const locks = require('./partnerCashoutOperationLockService');

let installed = false;
const CASHOUT_LOCK_TTL_MS = 180000;

function bindRelease(res, lock) {
  let released = false;
  let renewing = false;
  const leaseMs = Math.max(5000, Number(lock?.leaseMs) || CASHOUT_LOCK_TTL_MS);
  const renewalIntervalMs = Math.max(1000, Math.min(Math.floor(leaseMs / 3), 30000));

  const renewalTimer = setInterval(async () => {
    if (released || renewing) return;
    renewing = true;
    try {
      const renewed = await locks.renew(lock, leaseMs);
      if (!renewed && !released) {
        logger.error('[PARTNER-CASHOUT-OPS] Distributed cashout lock lease could not be renewed', {
          lockId: lock?.id,
        });
      }
    } catch (error) {
      if (!released) {
        logger.error('[PARTNER-CASHOUT-OPS] Distributed cashout lock renewal failed', {
          lockId: lock?.id,
          error: error.message,
        });
      }
    } finally {
      renewing = false;
    }
  }, renewalIntervalMs);
  renewalTimer.unref?.();

  const release = () => {
    if (released) return;
    released = true;
    clearInterval(renewalTimer);
    locks.release(lock).catch(error => {
      logger.error('[PARTNER-CASHOUT-OPS] Failed to release distributed cashout lock', {
        lockId: lock?.id,
        error: error.message,
      });
    });
  };
  res.once('finish', release);
  res.once('close', release);
  return release;
}

function busyResponse(res) {
  return res.status(409).json({
    error: 'Another cashout operation is already in progress. Please try again in a moment.',
    code: 'PARTNER_CASHOUT_OPERATION_BUSY',
  });
}

function buildPartnerLockGuard() {
  const router = express.Router();
  router.post(
    '/cashout-requests',
    authRequired,
    roleRequired('partner'),
    csrfProtection,
    async (req, res, next) => {
      try {
        const partner = await strictStore.findOne('partners', { userId: req.user.id });
        if (!partner) {
          return res.status(403).json({
            error: 'Partner account not found.',
            code: 'PARTNER_NOT_FOUND',
          });
        }
        const lock = await locks.acquire(`partner:${partner.id}`, CASHOUT_LOCK_TTL_MS);
        if (!lock) return busyResponse(res);
        req.partnerCashoutOperationLock = lock;
        bindRelease(res, lock);
        return next();
      } catch (error) {
        logger.error('[PARTNER-CASHOUT-OPS] Could not acquire submission lock', {
          userId: req.user?.id,
          error: error.message,
          code: error.code,
        });
        return res.status(503).json({
          error: 'Cashout concurrency protection is temporarily unavailable. Please try again later.',
          code: error.code || 'PARTNER_CASHOUT_LOCK_UNAVAILABLE',
        });
      }
    }
  );
  return router.stack;
}

function buildAdminLockGuard() {
  const router = express.Router();
  router.patch('/:id', csrfProtection, async (req, res, next) => {
    try {
      const request = await strictStore.findOne('partner_cashout_requests', { id: req.params.id });
      if (!request) return next();
      const lock = await locks.acquire(`request:${request.id}`, CASHOUT_LOCK_TTL_MS);
      if (!lock) return busyResponse(res);
      req.partnerCashoutOperationLock = lock;
      bindRelease(res, lock);
      return next();
    } catch (error) {
      logger.error('[PARTNER-CASHOUT-OPS] Could not acquire admin transition lock', {
        requestId: req.params.id,
        error: error.message,
        code: error.code,
      });
      return res.status(503).json({
        error: 'Cashout concurrency protection is temporarily unavailable. No transition was applied.',
        code: error.code || 'PARTNER_CASHOUT_LOCK_UNAVAILABLE',
      });
    }
  });
  return router.stack;
}

function buildAuditRetentionGuard() {
  const router = express.Router();
  router.delete('/:id', csrfProtection, (_req, res) =>
    res.status(409).json({
      error:
        'Cashout records are retained as financial and anti-abuse evidence and cannot be permanently deleted.',
      code: 'PARTNER_CASHOUT_AUDIT_RETENTION_REQUIRED',
    })
  );
  return router.stack;
}

function insertBeforeRoute(router, layers, predicate) {
  const index = router.stack.findIndex(predicate);
  if (index < 0) throw new Error('Target cashout route was not found during lock installation');
  router.stack.splice(index, 0, ...layers);
}

function install() {
  if (installed) return;
  const partnerRouter = require('../routes/partner');
  const adminRouter = require('../routes/admin-cashout-requests');
  insertBeforeRoute(
    partnerRouter,
    buildPartnerLockGuard(),
    layer => layer.route?.path === '/cashout-requests' && layer.route.methods?.post
  );
  insertBeforeRoute(
    adminRouter,
    buildAdminLockGuard(),
    layer => layer.route?.path === '/:id' && layer.route.methods?.patch
  );
  insertBeforeRoute(
    adminRouter,
    buildAuditRetentionGuard(),
    layer => layer.route?.path === '/:id' && layer.route.methods?.delete
  );
  installed = true;
  logger.info('[PARTNER-CASHOUT-OPS] Distributed locks and financial audit retention guards installed');
}

module.exports = {
  install,
  _test: {
    CASHOUT_LOCK_TTL_MS,
    bindRelease,
    busyResponse,
    buildPartnerLockGuard,
    buildAdminLockGuard,
    buildAuditRetentionGuard,
    insertBeforeRoute,
  },
};
