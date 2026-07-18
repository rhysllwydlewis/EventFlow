'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { apiLimiter } = require('../middleware/rateLimits');
const {
  buildPublicSupplierSlug,
  buildSupplierSitemap,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
} = require('../services/publicSupplierSeo.service');

const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'supplier.html');
const CACHE_CONTROL = 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600';

function createPublicSupplierSeoRouter(options = {}) {
  const dbUnified = options.dbUnified;
  const logger = options.logger || require('../utils/logger');
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'https://event-flow.co.uk';
  const router = express.Router();
  let templatePromise = null;

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

  async function readPublicSuppliers() {
    const [suppliers, users] = await Promise.all([
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
    return (suppliers || []).filter(supplier => isPublicSupplier(supplier, validOwnerIds));
  }

  router.get('/supplier/:slug', apiLimiter, async (req, res, next) => {
    try {
      const suppliers = await readPublicSuppliers();
      const supplier = resolvePublicSupplierBySlug(suppliers, req.params.slug);
      if (!supplier) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        return next();
      }

      const canonicalSlug = buildPublicSupplierSlug(supplier);
      if (req.params.slug !== canonicalSlug) {
        const query = new URLSearchParams(req.query || {});
        query.delete('preview');
        const suffix = query.toString();
        return res.redirect(301, `/supplier/${canonicalSlug}${suffix ? `?${suffix}` : ''}`);
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

  router.get('/sitemap-suppliers.xml', apiLimiter, async (_req, res, next) => {
    try {
      const suppliers = await readPublicSuppliers();
      const sitemap = buildSupplierSitemap(suppliers, { baseUrl });
      res.setHeader('Cache-Control', CACHE_CONTROL);
      res.setHeader('X-Robots-Tag', 'noindex');
      return res.status(200).type('application/xml').send(sitemap);
    } catch (error) {
      logger.error('Failed to generate supplier sitemap', { error: error.message });
      return next(error);
    }
  });

  return router;
}

module.exports = createPublicSupplierSeoRouter;
