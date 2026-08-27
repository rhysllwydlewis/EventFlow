'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const {
  buildCampaignQuery,
  buildEventSeoModel,
  buildPackageSeoModel,
  buildPublicEventSlug,
  buildPublicPackageSlug,
  getPackageIndexEligibility,
  isIndexablePublicEvent,
  publicSupplierIds,
  renderSeoHtml,
  resolvePublicEvent,
  resolvePublicPackage,
} = require('../services/publicListingSeo.service');
const {
  isPublishedUnclaimedSupplierBotProfile,
} = require('../services/supplierBotPilotVisibility.util');

const PACKAGE_TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'package.html');
const EVENT_TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'event-detail.html');
const INDEXABLE_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';
const NON_INDEXABLE_CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=30';
const DEFAULT_CACHE_TTL_MS = 60 * 1000;

function addUnclaimedPackageBanner(html) {
  const banner = `
    <aside id="supplier-bot-unclaimed-package-banner" role="status" style="margin:0;padding:10px 16px;text-align:center;background:#f3f4f6;color:#374151;border-bottom:1px solid #e5e7eb;font:600 14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      Unclaimed package · This package belongs to a business that has not claimed or verified its EventFlow profile yet.
      <a href="/auth?tab=create&amp;role=supplier" style="color:#4338ca;text-decoration:underline;margin-left:6px">Is this your business? Claim it</a>
    </aside>`;
  return /<body\b[^>]*>/i.test(html)
    ? html.replace(/<body\b[^>]*>/i, match => `${match}${banner}`)
    : html;
}

function createPublicListingSeoRouter(options = {}) {
  const dbUnified = options.dbUnified;
  const logger = options.logger || require('../utils/logger');
  const baseUrl = options.baseUrl || process.env.BASE_URL || 'https://event-flow.co.uk';
  const configuredTtl = Number(options.cacheTtlMs);
  const cacheTtlMs = Number.isFinite(configuredTtl)
    ? Math.max(0, configuredTtl)
    : DEFAULT_CACHE_TTL_MS;
  const router = express.Router();
  const templatePromises = new Map();
  let listingCache = null;
  let listingCacheExpiresAt = 0;
  let listingLoadPromise = null;

  if (!dbUnified || typeof dbUnified.read !== 'function') {
    throw new Error('Public listing SEO routes require dbUnified.read');
  }

  function readTemplate(kind) {
    if (!templatePromises.has(kind)) {
      const templatePath = kind === 'package' ? PACKAGE_TEMPLATE_PATH : EVENT_TEMPLATE_PATH;
      templatePromises.set(
        kind,
        fs.readFile(templatePath, 'utf8').catch(error => {
          templatePromises.delete(kind);
          throw error;
        })
      );
    }
    return templatePromises.get(kind);
  }

  async function loadListings() {
    const [packages, suppliers, users, events] = await Promise.all([
      dbUnified.read('packages'),
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
      dbUnified.read('public_calendar_events'),
    ]);
    const supplierIds = publicSupplierIds(suppliers, users);
    const supplierById = new Map(
      (suppliers || [])
        .filter(supplier => supplierIds.has(supplier.id))
        .map(supplier => [supplier.id, supplier])
    );
    return {
      packages: packages || [],
      supplierIds,
      supplierById,
      events: events || [],
    };
  }

  function readListings() {
    const now = Date.now();
    if (listingCache && now < listingCacheExpiresAt) {
      return Promise.resolve(listingCache);
    }
    if (listingLoadPromise) {
      return listingLoadPromise;
    }
    listingLoadPromise = loadListings()
      .then(listings => {
        listingCache = listings;
        listingCacheExpiresAt = Date.now() + cacheTtlMs;
        return listings;
      })
      .finally(() => {
        listingLoadPromise = null;
      });
    return listingLoadPromise;
  }

  function noindex(res, value = 'noindex, nofollow') {
    res.setHeader('X-Robots-Tag', value);
    res.setHeader('Cache-Control', 'no-store');
  }

  router.get(['/package', '/package.html'], async (req, res, next) => {
    const lookup = String(req.query.slug || req.query.id || req.query.packageId || '').trim();
    if (!lookup) {
      return next();
    }
    if (req.query.preview === 'true') {
      noindex(res);
      return next();
    }

    try {
      const listings = await readListings();
      const pkg = resolvePublicPackage(listings.packages, lookup, listings.supplierIds);
      if (!pkg) {
        noindex(res);
        return res.status(404).send('Package not found');
      }
      const campaignQuery = buildCampaignQuery(req.query);
      const canonicalPath = `/package/${buildPublicPackageSlug(pkg)}`;
      return res.redirect(301, `${canonicalPath}${campaignQuery ? `?${campaignQuery}` : ''}`);
    } catch (error) {
      logger.error('Failed to resolve legacy package URL', { lookup, error: error.message });
      return next(error);
    }
  });

  router.get('/package/:slug', async (req, res, next) => {
    try {
      const listings = await readListings();
      const pkg = resolvePublicPackage(listings.packages, req.params.slug, listings.supplierIds);
      if (!pkg) {
        noindex(res);
        return res.status(404).send('Package not found');
      }
      const supplier = listings.supplierById.get(pkg.supplierId);
      if (!supplier) {
        noindex(res);
        return res.status(404).send('Package not found');
      }

      const canonicalSlug = buildPublicPackageSlug(pkg);
      const campaignQuery = buildCampaignQuery(req.query);
      const canonicalSearch = campaignQuery ? `?${campaignQuery}` : '';
      const queryStart = req.originalUrl.indexOf('?');
      const incomingSearch = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);
      if (req.params.slug !== canonicalSlug || incomingSearch !== canonicalSearch) {
        return res.redirect(301, `/package/${canonicalSlug}${canonicalSearch}`);
      }

      const publishedUnclaimed = isPublishedUnclaimedSupplierBotProfile(supplier);
      const indexable = !publishedUnclaimed && getPackageIndexEligibility(pkg, supplier).eligible;
      const template = await readTemplate('package');
      const seo = buildPackageSeoModel(pkg, supplier, { baseUrl });
      const rendered = renderSeoHtml(template, 'package', pkg.id, seo, indexable);
      const html = publishedUnclaimed ? addUnclaimedPackageBanner(rendered) : rendered;
      res.setHeader(
        'Cache-Control',
        indexable ? INDEXABLE_CACHE_CONTROL : NON_INDEXABLE_CACHE_CONTROL
      );
      res.setHeader(
        'X-Robots-Tag',
        publishedUnclaimed
          ? 'noindex, nofollow, noarchive'
          : indexable
            ? 'index, follow, max-image-preview:large'
            : 'noindex, follow'
      );
      return res.status(200).type('html').send(html);
    } catch (error) {
      logger.error('Failed to render public package SEO page', {
        slug: req.params.slug,
        error: error.message,
      });
      return next(error);
    }
  });

  router.get('/events/:slug', async (req, res, next) => {
    try {
      const listings = await readListings();
      const event = resolvePublicEvent(listings.events, req.params.slug);
      if (!event) {
        noindex(res);
        return res.status(404).send('Event not found');
      }

      const canonicalSlug = buildPublicEventSlug(event);
      const campaignQuery = buildCampaignQuery(req.query);
      const canonicalSearch = campaignQuery ? `?${campaignQuery}` : '';
      const queryStart = req.originalUrl.indexOf('?');
      const incomingSearch = queryStart === -1 ? '' : req.originalUrl.slice(queryStart);
      if (req.params.slug !== canonicalSlug || incomingSearch !== canonicalSearch) {
        return res.redirect(301, `/events/${canonicalSlug}${canonicalSearch}`);
      }

      const indexable = isIndexablePublicEvent(event);
      const template = await readTemplate('event');
      const seo = buildEventSeoModel(event, { baseUrl });
      const html = renderSeoHtml(template, 'event', event.id, seo, indexable);
      res.setHeader(
        'X-Robots-Tag',
        indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'
      );
      res.setHeader(
        'Cache-Control',
        indexable ? INDEXABLE_CACHE_CONTROL : NON_INDEXABLE_CACHE_CONTROL
      );
      return res.status(200).type('html').send(html);
    } catch (error) {
      logger.error('Failed to render public event SEO page', {
        slug: req.params.slug,
        error: error.message,
      });
      return next(error);
    }
  });

  return router;
}

module.exports = createPublicListingSeoRouter;
