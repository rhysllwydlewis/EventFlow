'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  extractSlugToken,
  getSupplierIndexEligibility,
  isPublicSupplier,
  renderSupplierHtml,
  resolvePublicSupplierBySlug,
} = require('../services/publicSupplierSeo.service');
const { isSupplierBotPilotProfile } = require('../services/supplierBotPilotVisibility.util');

const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'supplier.html');
const INDEXABLE_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';
const NON_INDEXABLE_CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=30';
const DEFAULT_SUPPLIER_CACHE_TTL_MS = 60 * 1000;

function addPilotBanner(html) {
  const banner = `
    <aside id="supplier-bot-unclaimed-banner" role="status" style="margin:0;padding:10px 16px;text-align:center;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;font:600 14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      Unclaimed profile · This business has not claimed or verified this EventFlow profile yet.
    </aside>`;
  return /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b[^>]*>/i, match => `${match}${banner}`)
    : html;
}

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

  async function loadDirectlyAddressableSuppliers() {
    const [suppliers, users, supplierAnalytics] = await Promise.all([
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
      dbUnified.read('supplierAnalytics'),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
    const reviewSummaryBySupplierId = new Map(
      (supplierAnalytics || [])
        .filter(summary => summary && summary.supplierId)
        .map(summary => [String(summary.supplierId), summary])
    );

    return (suppliers || [])
      .filter(
        supplier => isPublicSupplier(supplier, validOwnerIds) || isSupplierBotPilotProfile(supplier)
      )
      .map(supplier => {
        const summary = reviewSummaryBySupplierId.get(String(supplier.id));
        return {
          ...supplier,
          approvedReviewSummary: summary
            ? {
                averageRating: summary.averageRating,
                reviewCount: summary.totalReviews,
              }
            : null,
        };
      });
  }

  function readDirectlyAddressableSuppliers() {
    if (process.env.E2E_MODE === 'full') {
      return loadDirectlyAddressableSuppliers();
    }

    const now = Date.now();
    if (supplierCache && now < supplierCacheExpiresAt) {
      return Promise.resolve(supplierCache);
    }
    if (supplierLoadPromise) {
      return supplierLoadPromise;
    }

    supplierLoadPromise = loadDirectlyAddressableSuppliers()
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

  function resolvePilotPlainSlugAlias(suppliers, slug) {
    return (
      (suppliers || []).find(supplier => {
        if (!isSupplierBotPilotProfile(supplier)) {
          return false;
        }
        const canonicalSlug = buildPublicSupplierSlug(supplier);
        const separatorIndex = canonicalSlug.lastIndexOf('--');
        const plainSlug = separatorIndex === -1 ? '' : canonicalSlug.slice(0, separatorIndex);
        return plainSlug === String(slug || '').toLowerCase();
      }) || null
    );
  }

  // This is an HTML profile route, not an API operation. Ordinary public suppliers
  // retain the normal SEO policy. The explicit one-profile Supplier Bot pilot is
  // directly addressable only so the owner can inspect the complete production
  // render; it remains excluded from normal public discovery and forced noindex.
  router.get('/supplier/:slug', async (req, res, next) => {
    try {
      const suppliers = await readDirectlyAddressableSuppliers();

      // During the deliberately narrow one-profile pilot, keep the original human-
      // readable tester URL usable. Only the explicit Supplier Bot pilot may resolve
      // without a token; ordinary drafts still fail closed. Redirect to the canonical
      // tokenised route so production rendering and canonical metadata remain unified.
      if (!extractSlugToken(req.params.slug)) {
        const pilotAlias = resolvePilotPlainSlugAlias(suppliers, req.params.slug);
        if (!pilotAlias) {
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          return next();
        }

        const canonicalSlug = buildPublicSupplierSlug(pilotAlias);
        const campaignQuery = buildCampaignQuery(req.query);
        const canonicalSearch = campaignQuery ? `?${campaignQuery}` : '';
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        return res.redirect(302, `/supplier/${canonicalSlug}${canonicalSearch}`);
      }

      const supplier = resolvePublicSupplierBySlug(suppliers, req.params.slug);
      if (!supplier) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        return next();
      }

      const canonicalSlug = buildPublicSupplierSlug(supplier);
      const campaignQuery = buildCampaignQuery(req.query);
      const canonicalSearch = campaignQuery ? `?${campaignQuery}` : '';
      const queryStart = req.originalUrl.indexOf('?');
      const incomingSearch = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);

      if (req.params.slug !== canonicalSlug || incomingSearch !== canonicalSearch) {
        return res.redirect(301, `/supplier/${canonicalSlug}${canonicalSearch}`);
      }

      const pilot = isSupplierBotPilotProfile(supplier);
      const ownerIdsForIndexCheck = supplier.ownerUserId
        ? new Set([String(supplier.ownerUserId)])
        : undefined;
      const indexable =
        !pilot && getSupplierIndexEligibility(supplier, ownerIdsForIndexCheck).eligible;
      const template = await readTemplate();
      const rendered = renderSupplierHtml(template, supplier, { baseUrl }, indexable);
      const html = pilot ? addPilotBanner(rendered) : rendered;

      res.setHeader(
        'Cache-Control',
        indexable ? INDEXABLE_CACHE_CONTROL : NON_INDEXABLE_CACHE_CONTROL
      );
      res.setHeader(
        'X-Robots-Tag',
        pilot
          ? 'noindex, nofollow, noarchive'
          : indexable
            ? 'index, follow, max-image-preview:large'
            : 'noindex, follow'
      );
      return res.status(200).type('html').send(html);
    } catch (error) {
      logger.error('Failed to render public supplier SEO profile', {
        slug: req.params.slug,
        error: error.message,
      });
      return next(error);
    }
  });

  router.invalidateSupplierCache = () => {
    supplierCache = null;
    supplierCacheExpiresAt = 0;
  };

  return router;
}

module.exports = createPublicSupplierSeoRouter;
