(() => {
  'use strict';

  const express = require('express');
  const logger = require('../utils/logger');
  const strictStore = require('./partnerCashoutStrictStore');
  const ops = require('./partnerCashoutOperationsService');

  let installed = false;

  function normalise(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function identitySummary(partner, user, config = ops.getConfig(), now = Date.now()) {
    if (!partner) {
      return {
        status: 'missing',
        eligibleSnapshot: false,
        reason: 'PARTNER_CASHOUT_IDENTITY_MISSING',
      };
    }
    const status = partner.cashoutIdentityStatus || 'pending';
    const emailMatches =
      !partner.cashoutIdentityEmailSnapshot ||
      normalise(partner.cashoutIdentityEmailSnapshot) === normalise(user?.email);
    const companyMatches =
      !partner.cashoutIdentityCompanySnapshot ||
      normalise(partner.cashoutIdentityCompanySnapshot) === normalise(user?.company);
    const emailVerified = user?.verified === true;
    const verifiedAtMs = Date.parse(partner.cashoutIdentityVerifiedAt);
    const maxAgeDays = Number(config?.identityReviewMaxAgeDays || 365);
    const expired =
      status === 'verified' &&
      (!Number.isFinite(verifiedAtMs) || verifiedAtMs < now - maxAgeDays * 86400000);
    const eligibleSnapshot =
      partner.status === 'active' &&
      status === 'verified' &&
      emailVerified &&
      emailMatches &&
      companyMatches &&
      !expired;

    let reason = null;
    if (partner.status !== 'active') reason = 'PARTNER_CASHOUT_PARTNER_NOT_ACTIVE';
    else if (!emailVerified) reason = 'PARTNER_CASHOUT_EMAIL_UNVERIFIED';
    else if (status === 'rejected') reason = 'PARTNER_CASHOUT_IDENTITY_REJECTED';
    else if (status !== 'verified') reason = 'PARTNER_CASHOUT_IDENTITY_REVIEW_REQUIRED';
    else if (expired) reason = 'PARTNER_CASHOUT_IDENTITY_REVIEW_EXPIRED';
    else if (!emailMatches || !companyMatches) reason = 'PARTNER_CASHOUT_IDENTITY_CHANGED';

    return {
      status,
      eligibleSnapshot,
      reason,
      reviewedAt: partner.cashoutIdentityReviewedAt || null,
      verifiedAt: partner.cashoutIdentityVerifiedAt || null,
      reviewedBy: partner.cashoutIdentityReviewedBy || null,
      emailVerified,
      emailMatches,
      companyMatches,
      expired,
    };
  }

  function reconciliationSummary(request) {
    const issues = Array.isArray(request?.reconciliationIssues) ? request.reconciliationIssues : [];
    return {
      status: request?.reconciliationStatus || 'not_run',
      reconciledAt: request?.reconciledAt || null,
      reconciledBy: request?.reconciledBy || null,
      recoveryState: request?.reconciliationRecoveryState || 'none',
      issueCodes: issues.map(item => item?.code).filter(Boolean),
    };
  }

  function enrichCashout(item, partnersById, usersById, config) {
    if (!item || typeof item !== 'object') return item;
    const partner = partnersById.get(item.partnerId) || null;
    const user = usersById.get(item.partnerUserId || partner?.userId) || null;
    return {
      ...item,
      cashoutIdentitySummary: identitySummary(partner, user, config),
      reconciliationSummary: reconciliationSummary(item),
    };
  }

  async function loadIdentityMaps() {
    const [partners, users] = await Promise.all([
      strictStore.read('partners'),
      strictStore.read('users'),
    ]);
    return {
      partnersById: new Map((partners || []).map(partner => [partner.id, partner])),
      usersById: new Map((users || []).map(user => [user.id, user])),
      config: ops.getConfig(),
    };
  }

  function wrapJsonWithEnrichment(res, maps) {
    const originalJson = res.json.bind(res);
    res.json = function partnerCashoutEnrichedJson(body) {
      if (res.statusCode < 200 || res.statusCode >= 300 || !body || typeof body !== 'object') {
        return originalJson(body);
      }
      if (Array.isArray(body.items)) {
        return originalJson({
          ...body,
          items: body.items.map(item =>
            enrichCashout(item, maps.partnersById, maps.usersById, maps.config)
          ),
        });
      }
      if (body.request && typeof body.request === 'object') {
        return originalJson({
          ...body,
          request: enrichCashout(body.request, maps.partnersById, maps.usersById, maps.config),
        });
      }
      return originalJson(body);
    };
  }

  function buildReadEnrichmentGuard() {
    const router = express.Router();
    const guard = async (req, res, next) => {
      try {
        const maps = await loadIdentityMaps();
        wrapJsonWithEnrichment(res, maps);
        return next();
      } catch (error) {
        logger.error('[PARTNER-CASHOUT-OPS] Admin safety-state enrichment failed closed', {
          path: req.path,
          error: error.message,
          code: error.code,
        });
        return res.status(503).json({
          error: 'Cashout safety review data is temporarily unavailable.',
          code: error.code || 'PARTNER_CASHOUT_REVIEW_DATA_UNAVAILABLE',
        });
      }
    };
    router.get('/', guard);
    router.get('/:id', guard);
    return router.stack;
  }

  function insertBeforeFirstCashoutRead(router, layers) {
    const index = router.stack.findIndex(
      layer =>
        layer.route &&
        layer.route.methods?.get &&
        (layer.route.path === '/' || layer.route.path === '/:id')
    );
    if (index < 0)
      throw new Error('Admin cashout read routes were not found during enrichment installation');
    router.stack.splice(index, 0, ...layers);
  }

  function install() {
    if (installed) return;
    const adminRouter = require('../routes/admin-cashout-requests');
    insertBeforeFirstCashoutRead(adminRouter, buildReadEnrichmentGuard());
    installed = true;
    logger.info('[PARTNER-CASHOUT-OPS] Admin cashout safety-state enrichment installed');
  }

  module.exports = {
    install,
    _test: {
      normalise,
      identitySummary,
      reconciliationSummary,
      enrichCashout,
      wrapJsonWithEnrichment,
      buildReadEnrichmentGuard,
      insertBeforeFirstCashoutRead,
    },
  };
})();
