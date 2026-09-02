/**
 * SEO Insights Dashboard — admin API
 * Keyword/query performance from Google Search Console, keyword demand
 * from the Google Ads API (or a CSV fallback), and the gap/opportunity
 * scoring that combines them.
 */

'use strict';

const express = require('express');
const multer = require('multer');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { apiLimiter, writeLimiter } = require('../middleware/rateLimits');
const { PERMISSIONS, requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const googleAdsClient = require('../services/googleAdsClient');
const googleSearchConsole = require('../services/googleSearchConsole.service');
const gscIngestion = require('../services/gscIngestion.service');
const keywordPlannerIngestion = require('../services/keywordPlannerIngestion.service');
const keywordCsvImport = require('../services/keywordCsvImport.service');
const seoInsights = require('../services/seoInsights.service');
const seoDataStore = require('../services/seoDataStore');

const router = express.Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okType = file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv');
    cb(okType ? null : new Error('Only .csv files are accepted'), okType);
  },
});

function getProperty() {
  return process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY || null;
}

function handleError(res, error, fallbackStatus = 500) {
  logger.error('SEO admin route error:', error.message);
  const status =
    error.code === 'GOOGLE_ADS_NOT_CONFIGURED' || error.code === 'GSC_NOT_CONFIGURED'
      ? 409
      : fallbackStatus;
  res.status(status).json({
    success: false,
    error: error.message,
    code: error.code || 'SEO_ERROR',
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

router.get(
  '/status',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const ingestionStatus = await seoDataStore.getAllIngestionStatus();
      res.json({
        success: true,
        data: {
          property: getProperty(),
          gscConfigured: googleSearchConsole.isConfigured(),
          googleAdsConfigured: googleAdsClient.isConfigured(),
          ingestionStatus,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/overview',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoInsights.getOverview({ property: getProperty() });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/queries',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const includeNoise = req.query.includeNoise === 'true';
      const includeBranded = req.query.includeBranded !== 'false';
      const data = await seoInsights.getQueryTable({
        property: getProperty(),
        includeNoise,
        includeBranded,
      });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/striking-distance',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoInsights.getStrikingDistanceReport({
        property: getProperty(),
        positionMin: req.query.positionMin ? Number(req.query.positionMin) : undefined,
        positionMax: req.query.positionMax ? Number(req.query.positionMax) : undefined,
        minImpressions: req.query.minImpressions ? Number(req.query.minImpressions) : undefined,
      });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/low-ctr',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoInsights.getLowCtrReport({
        property: getProperty(),
        positionMax: req.query.positionMax ? Number(req.query.positionMax) : undefined,
        minImpressions: req.query.minImpressions ? Number(req.query.minImpressions) : undefined,
      });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/content-gaps',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoInsights.getContentGapReport({
        property: getProperty(),
        minVolume: req.query.minVolume ? Number(req.query.minVolume) : undefined,
      });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/financial-estimate',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoInsights.getFinancialEstimate({ property: getProperty() });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.get(
  '/settings',
  authRequired,
  apiLimiter,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_VIEW),
  async (req, res) => {
    try {
      const data = await seoDataStore.getSettings();
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// ---------------------------------------------------------------------------
// Write / ingestion endpoints
// ---------------------------------------------------------------------------

router.put(
  '/settings',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { valuePerClick } = req.body;
      if (valuePerClick !== null && (typeof valuePerClick !== 'number' || valuePerClick < 0)) {
        return res.status(400).json({
          success: false,
          error: 'valuePerClick must be a non-negative number or null',
          code: 'INVALID_VALUE_PER_CLICK',
          timestamp: new Date().toISOString(),
        });
      }
      const data = await seoDataStore.setSettings({ valuePerClick });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.post(
  '/noise',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { query, reason } = req.body;
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'query is required',
          code: 'MISSING_QUERY',
          timestamp: new Date().toISOString(),
        });
      }
      const normalised = await seoDataStore.markNoiseKeyword(query, {
        markedBy: req.user.email,
        reason,
      });
      res.json({ success: true, data: { query: normalised }, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.delete(
  '/noise/:query',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      await seoDataStore.unmarkNoiseKeyword(req.params.query);
      res.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.post(
  '/ingest/gsc',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const data = await gscIngestion.runIngestion({ triggeredBy: req.user.email });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.post(
  '/ingest/keyword-planner',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const data = await keywordPlannerIngestion.runIngestion({ triggeredBy: req.user.email });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error);
    }
  }
);

router.post(
  '/ingest/keyword-csv',
  authRequired,
  requirePermission(PERMISSIONS.SEO_DASHBOARD_MANAGE),
  csrfProtection,
  writeLimiter,
  csvUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded (expected multipart field "file")',
          code: 'MISSING_FILE',
          timestamp: new Date().toISOString(),
        });
      }
      const data = await keywordCsvImport.importCsv({
        csvText: req.file.buffer.toString('utf8'),
        importedBy: req.user.email,
      });
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      handleError(res, error, 400);
    }
  }
);

module.exports = router;
