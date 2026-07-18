'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  extractSlugToken,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
} = require('../services/publicSupplierSeo.service');

const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'supplier.html');
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';
const DEFAULT_SUPPLIER_CACHE_TTL_MS = 60 * 1000;

function createPublicSupplierSeoRouter(options = {}) {
  const dbUnified = options.dbUnified;
  const logger = options.logger || require('../utils/logger');
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'https://event-flow.co.uk';
  const configuredCacheTtl = Number(options.supplierCacheTtlMs);
  const supplierCacheTtlMs = Number.isFinite(configuredCacheTtl)
    ? Math.max(0, configuredCacheTtl)
    : DEFAULT_SUPPLIER_CACHE_TTL_MS;
  const router = express.Router();
  let templatePromise = null;
  let supplierCache = null;
  let supplierCacheExpiresAt = 0;
  let supplierLoadPromise = null;

  if (!dbUnified || typeof dbUnified.read !== 'function') {
    throw new Error('Public supplier SEO routes require dbUnified.read');
  }

  function readTemplate() {
    if (!templatePromise) {
      templatePromise = fs.readFile(TEMPLATE_PATH, 'utf8').catch(error => {
        templatePromise = null;
        throw error;
      });
    }
    return templatePromise;
  }

  async function loadPublicSuppliers() {
    const [suppliers, users] = await Promise.all([
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
    return (suppliers || []).filter(supplier => isPublicSupplier(supplier, validOwnerIds));
  }

  function readPublicSuppliers() {
    const now = Date.now();
    if (supplierCache && now < supplierCacheExpiresAt) {
      return Promise.resolve(supplierCache);
    }
    if (supplierLoadPromise) {
      return supplierLoadPromise;
    }

    supplierLoadPromise = loadPublicSuppliers()
      .then(suppliers => {
        supplierCache = suppliers;
        supplierCacheExpiresAt = Date.now() + supplierCacheTtlMs;
        return suppliers;
      })
      .finally(() => {
        supplierLoadPromise = null;
      });

    return supplierLoadPromise;
  }

  // This is an indexable HTML page, not an API operation. It deliberately does not
  // share apiLimiter's 100-request bucket, which could interrupt a sitemap crawl.
  router.get('/supplier/:slug', async (req, res, next) => {
    try {
      if (!extractSlugToken(req.params.slug)) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        return next();
      }

      const suppliers = await readPublicSuppliers();
      const supplier = resolvePublicSupplierBySlug(suppliers, req.params.slug);
      if (!supplier) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        return next();
      }

      const canonicalSlug = buildPublicSupplierSlug(supplier);
      if (req.params.slug !== canonicalSlug) {
        const campaignQuery = buildCampaignQuery(req.query);
        return res.redirect(
          301,
          `/supplier/${canonicalSlug}${campaignQuery ? `?${campaignQuery}` : ''}`
        );
      }

      const template = await readTemplate();
      const html = renderSupplierHtml(template, supplier, { baseUrl });
      res.setHeader('Cache-Control', CACHE_CONTROL);
      res.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large');
      return res.status(200).type('html').send(html);
    } catch (error) {
      logger.error('Failed to render public supplier SEO profile', {
        slug: req.params.slug,
        error: error.message,
      });
      return next(error);
    }
  });

  return router;
}

module.exports = createPublicSupplierSeoRouter;
