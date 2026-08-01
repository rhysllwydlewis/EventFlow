'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerAntiAbuseRuntime = require('../services/partnerAntiAbuseRuntime');
const partnerCashoutLockRuntime = require('../services/partnerCashoutLockRuntime');
const partnerCashoutOperationsRuntime = require('../services/partnerCashoutOperationsRuntime');
const partnerCashoutAdminEnrichmentRuntime = require('../services/partnerCashoutAdminEnrichmentRuntime');
const partnerCashoutOperationsIndexes = require('../services/partnerCashoutOperationsIndexService');

// routes/index.js imports this middleware before loading the partner, package,
// review and cashout routes. Install the programme guards here so ordinary
// database utility imports remain side-effect free in workers and tests.
partnerAntiAbuseRuntime.install();
// Install the policy layer first. The lock runtime then inserts its guard before
// the first matching cashout route (which is now the policy guard), producing:
// distributed lock -> PR3 policy -> existing cashout handler.
partnerCashoutOperationsRuntime.install();
partnerCashoutLockRuntime.install();
partnerCashoutAdminEnrichmentRuntime.install();
partnerCashoutOperationsIndexes.ensureIndexes().catch(error => {
  logger.warn('[PARTNER-CASHOUT-OPS] Cashout operations indexes are not ready yet', {
    error: error.message,
  });
});

const CAMPAIGN_FIELDS = ['source', 'medium', 'campaign', 'content', 'term'];

const sanitizeCampaignValue = (value, maxLength = 80) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const clean = value
    .trim()
    .replace(/[^\w\s\-./:@]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

  return clean || undefined;
};

const readUrlParams = urlLike => {
  if (!urlLike || typeof urlLike !== 'string') {
    return new URLSearchParams();
  }

  try {
    return new URL(urlLike, 'https://event-flow.local').searchParams;
  } catch {
    return new URLSearchParams();
  }
};

const extractCampaignMetadata = req => {
  const body = req.body || {};
  const query = req.query || {};
  const refererParams = readUrlParams(req.get ? req.get('referer') : '');
  const metadata = {};

  CAMPAIGN_FIELDS.forEach(field => {
    const utmField = `utm_${field}`;
    const value =
      body[utmField] ||
      body[field] ||
      query[utmField] ||
      query[field] ||
      refererParams.get(utmField) ||
      refererParams.get(field);
    const clean = sanitizeCampaignValue(value);
    if (clean) {
      metadata[field] = clean;
    }
  });

  return metadata;
};

const hasCampaignMetadata = metadata =>
  Boolean(metadata) && CAMPAIGN_FIELDS.some(field => Boolean(metadata[field]));

const isRegistrationResponse = (req, res, body) => {
  if (!req || !res || !body || typeof body !== 'object') {
    return false;
  }

  const methodOk = String(req.method || '').toUpperCase() === 'POST';
  const pathOk = /\/(register|google)\/?$/.test(String(req.path || req.originalUrl || ''));
  const statusOk = res.statusCode >= 200 && res.statusCode < 300;
  const user = body.user || {};

  return (
    methodOk &&
    pathOk &&
    statusOk &&
    body.ok === true &&
    user.role === 'supplier' &&
    Boolean(user.id)
  );
};

const partnerReferralCampaignCapture = (req, res, next) => {
  const metadata = extractCampaignMetadata(req);
  const refCode = req.body && req.body.ref;

  if (!refCode || !hasCampaignMetadata(metadata)) {
    return next();
  }

  const originalJson = res.json.bind(res);

  res.json = function partnerReferralCampaignJson(body) {
    if (isRegistrationResponse(req, res, body)) {
      const supplierUserId = body.user.id;
      dbUnified
        .updateOne('partner_referrals', { supplierUserId }, { $set: metadata })
        .catch(err => {
          logger.warn('[PARTNER-CAMPAIGN] Failed to attach campaign metadata to referral', {
            supplierUserId,
            error: err.message,
          });
        });
    }

    return originalJson(body);
  };

  return next();
};

partnerReferralCampaignCapture.extractCampaignMetadata = extractCampaignMetadata;
partnerReferralCampaignCapture.sanitizeCampaignValue = sanitizeCampaignValue;
partnerReferralCampaignCapture.hasCampaignMetadata = hasCampaignMetadata;

module.exports = partnerReferralCampaignCapture;
