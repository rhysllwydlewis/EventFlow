/**
 * EventFlow UK locations — admin publishing API
 *
 * Backs the Location Pages admin area. Every route requires an authenticated
 * admin, every change is written to the audit trail, and the quality gate is
 * reported alongside the editorial state so an editor can see exactly why a
 * page is or is not indexable before they try to publish it.
 */

'use strict';

const express = require('express');
const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { authRequired, roleRequired, userExtractionMiddleware } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { apiLimiter, writeLimiter } = require('../middleware/rateLimits');
const registry = require('../services/locationRegistry.service');
const locationPages = require('../services/locationPage.service');
const { isPublicSupplier } = require('../services/publicSupplierSeo.service');
const {
  COLLECTIONS,
  LIMITS,
  PUBLICATION_STATES,
  PUBLICATION_STATE_VALUES,
} = require('../models/LocationContent');
const { __internal: locationRoutes } = require('./locations');

router.use(userExtractionMiddleware, authRequired, roleRequired('admin'));

/**
 * Trim and cap a string field.
 * @param {*} value Raw value.
 * @param {number} maxLength Maximum length.
 * @returns {string} Clean value.
 */
function cleanText(value, maxLength) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate and normalise editor-supplied planning sections.
 * @param {*} value Raw sections.
 * @returns {Object[]} Clean sections.
 */
function cleanSections(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, LIMITS.maxSections)
    .map(section => ({
      title: cleanText(section && section.title, LIMITS.sectionTitleMaxLength),
      // Paragraph breaks survive; everything else is collapsed by the renderer,
      // which escapes the text rather than trusting any markup in it.
      body: String((section && section.body) || '')
        .trim()
        .slice(0, LIMITS.sectionBodyMaxLength),
      sourceName: cleanText(section && section.sourceName, 120) || null,
      sourceUrl: cleanText(section && section.sourceUrl, 500) || null,
      sourceDate: cleanText(section && section.sourceDate, 40) || null,
    }))
    .filter(section => section.title && section.body);
}

/**
 * Validate and normalise editor-supplied FAQs.
 * @param {*} value Raw FAQs.
 * @returns {Object[]} Clean FAQs.
 */
function cleanFaqs(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, LIMITS.maxFaqs)
    .map(faq => ({
      question: cleanText(faq && faq.question, LIMITS.faqQuestionMaxLength),
      answer: cleanText(faq && faq.answer, LIMITS.faqAnswerMaxLength),
    }))
    .filter(faq => faq.question && faq.answer);
}

/**
 * Record an admin decision in the audit trail.
 * @param {Object} req Express request.
 * @param {string} action Action name.
 * @param {Object} details Action details.
 * @returns {Promise<void>} Resolves when written.
 */
async function recordAudit(req, action, details) {
  try {
    await dbUnified.insertOne('audit_logs', {
      id: dbUnified.uid ? dbUnified.uid() : `audit_${Date.now()}`,
      action,
      actorId: req.user && req.user.id ? req.user.id : null,
      actorEmail: req.user && req.user.email ? req.user.email : null,
      targetType: 'location_page',
      targetId: details.locationSlug,
      details,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Could not write a location page audit entry:', error.message);
  }
}

/**
 * Load everything needed to evaluate a page's quality gate.
 * @returns {Promise<Object>} Supporting data.
 */
async function loadGateInputs() {
  const [suppliers, users, packages, events, records] = await Promise.all([
    dbUnified.read('suppliers'),
    dbUnified.read('users'),
    dbUnified.read('packages'),
    dbUnified.read('public_calendar_events'),
    locationPages.loadPageRecords(dbUnified),
  ]);
  const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
  return {
    suppliers: (suppliers || []).filter(supplier => isPublicSupplier(supplier, validOwnerIds)),
    validOwnerIds,
    packages: packages || [],
    events: events || [],
    records,
  };
}

/**
 * Build the admin view of one city.
 * @param {Object} city Registry city.
 * @param {Object} data Supporting data.
 * @returns {Object} Admin row.
 */
function describeCity(city, data) {
  const page = locationPages.normalisePageRecord(city, data.records.get(city.slug));
  const published = new Set(
    registry
      .listCities()
      .filter(
        candidate =>
          locationPages.normalisePageRecord(candidate, data.records.get(candidate.slug)).status ===
          PUBLICATION_STATES.published
      )
      .map(candidate => candidate.slug)
  );

  const model = locationPages.buildCityPageModel({
    city,
    page,
    suppliers: data.suppliers,
    validOwnerIds: data.validOwnerIds,
    packages: data.packages,
    events: data.events,
    publishedSlugs: published,
  });

  return {
    slug: city.slug,
    name: city.name,
    nation: city.nation,
    region: city.region,
    alternateNames: city.alternateNames,
    status: page.status,
    indexingRequested: page.indexingRequested,
    indexable: model.indexable,
    publishedAt: page.publishedAt,
    lastReviewedAt: page.lastReviewedAt,
    reviewedBy: page.reviewedBy,
    seo: page.seo,
    content: page.content,
    metadata: model.metadata,
    gate: model.gate,
    supplierCount: model.rankedSuppliers.length,
    categoryCount: model.categories.length,
    packageCount: model.packages.length,
    eventCount: model.events.length,
    nearbyPublished: model.nearby.map(nearby => nearby.slug),
    warnings: buildWarnings(city, page, model, data),
  };
}

/**
 * Editorial quality warnings for one page.
 *
 * These are the problems a human should see before publishing: duplicated
 * metadata across cities, copy that reads as a find-and-replace of another
 * city, missing sources, weak inventory and stale reviews.
 * @param {Object} city Registry city.
 * @param {Object} page Normalised page record.
 * @param {Object} model Page model.
 * @param {Object} data Supporting data.
 * @returns {string[]} Warnings.
 */
function buildWarnings(city, page, model, data) {
  const warnings = [];

  for (const other of registry.listCities()) {
    if (other.slug === city.slug) {
      continue;
    }
    const otherPage = locationPages.normalisePageRecord(other, data.records.get(other.slug));
    if (page.seo.title && otherPage.seo.title === page.seo.title) {
      warnings.push(`Title is identical to ${other.name}`);
    }
    if (page.seo.metaDescription && otherPage.seo.metaDescription === page.seo.metaDescription) {
      warnings.push(`Meta description is identical to ${other.name}`);
    }
    if (page.content.intro && otherPage.content.intro === page.content.intro) {
      warnings.push(`Introduction is identical to ${other.name}`);
    }
    // A near-duplicate: the same copy with the city name swapped.
    if (
      page.content.intro &&
      otherPage.content.intro &&
      page.content.intro.split(city.name).join('__CITY__') ===
        otherPage.content.intro.split(other.name).join('__CITY__')
    ) {
      warnings.push(`Introduction differs from ${other.name} only by the city name`);
    }
  }

  if (!page.content.intro) {
    warnings.push('No local introduction has been written');
  }
  if (!page.content.planningSections.length) {
    warnings.push('No local planning section has been written');
  }
  for (const section of page.content.planningSections) {
    if (!section.sourceName && /\d/.test(String(section.body))) {
      warnings.push(`Section "${section.title}" quotes figures without a source`);
    }
  }
  if (model.rankedSuppliers.length < 3) {
    warnings.push('Fewer than three suppliers currently cover this city');
  }
  if (page.status === PUBLICATION_STATES.published && !model.nearby.length) {
    warnings.push('No published nearby pages are available to link to');
  }
  if (page.indexingRequested && !model.indexable) {
    warnings.push('Indexing is requested but the quality gate does not pass');
  }

  return [...new Set(warnings)];
}

/**
 * GET /api/v1/admin/locations
 * Every registry city with its editorial state and quality gate.
 */
router.get('/', apiLimiter, async (req, res) => {
  try {
    const data = await loadGateInputs();
    const items = registry.listCities().map(city => describeCity(city, data));
    const status = String(req.query.status || '').trim();
    const filtered = status ? items.filter(item => item.status === status) : items;

    return res.json({
      success: true,
      data: {
        items: filtered,
        summary: {
          total: items.length,
          published: items.filter(item => item.status === PUBLICATION_STATES.published).length,
          indexable: items.filter(item => item.indexable).length,
          pilot: items.filter(item => item.status === PUBLICATION_STATES.pilot).length,
        },
      },
    });
  } catch (error) {
    logger.error('Could not list location pages:', error);
    return res.status(500).json({ success: false, error: 'Failed to list location pages' });
  }
});

/**
 * GET /api/v1/admin/locations/:slug
 * One city, including a preview URL.
 */
router.get('/:slug', apiLimiter, async (req, res) => {
  try {
    const resolved = registry.resolveCity(req.params.slug);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'Unknown city' });
    }
    const data = await loadGateInputs();
    const item = describeCity(resolved.city, data);
    return res.json({
      success: true,
      data: { ...item, previewUrl: `/locations/${resolved.city.slug}` },
    });
  } catch (error) {
    logger.error('Could not load a location page:', error);
    return res.status(500).json({ success: false, error: 'Failed to load location page' });
  }
});

/**
 * PATCH /api/v1/admin/locations/:slug
 * Update editorial content, publication state and the indexing request.
 */
router.patch('/:slug', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const resolved = registry.resolveCity(req.params.slug);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'Unknown city' });
    }
    const city = resolved.city;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    if (body.status !== undefined && !PUBLICATION_STATE_VALUES.includes(body.status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of ${PUBLICATION_STATE_VALUES.join(', ')}`,
      });
    }

    const records = await locationPages.loadPageRecords(dbUnified);
    const existing = records.get(city.slug) || null;
    const current = locationPages.normalisePageRecord(city, existing);
    const now = new Date().toISOString();

    const next = {
      locationSlug: city.slug,
      status: body.status !== undefined ? body.status : current.status,
      indexingRequested:
        body.indexingRequested !== undefined
          ? body.indexingRequested === true
          : current.indexingRequested,
      seo: {
        title:
          body.seo && body.seo.title !== undefined
            ? cleanText(body.seo.title, 70)
            : current.seo.title,
        metaDescription:
          body.seo && body.seo.metaDescription !== undefined
            ? cleanText(body.seo.metaDescription, 160)
            : current.seo.metaDescription,
      },
      content: {
        heroImageUrl:
          body.content && body.content.heroImageUrl !== undefined
            ? cleanText(body.content.heroImageUrl, 500) || null
            : current.content.heroImageUrl,
        heroImageAlt:
          body.content && body.content.heroImageAlt !== undefined
            ? cleanText(body.content.heroImageAlt, 200) || null
            : current.content.heroImageAlt,
        intro:
          body.content && body.content.intro !== undefined
            ? cleanText(body.content.intro, LIMITS.introMaxLength)
            : current.content.intro,
        planningSections:
          body.content && body.content.planningSections !== undefined
            ? cleanSections(body.content.planningSections)
            : current.content.planningSections,
        faqs:
          body.content && body.content.faqs !== undefined
            ? cleanFaqs(body.content.faqs)
            : current.content.faqs,
      },
      lastReviewedAt: current.lastReviewedAt,
      reviewedBy: current.reviewedBy,
      publishedAt: current.publishedAt,
      updatedAt: now,
    };

    // Marking a page reviewed is an explicit act by a named person, never a
    // side effect of saving a typo fix.
    if (body.markReviewed === true) {
      next.lastReviewedAt = now;
      next.reviewedBy = (req.user && (req.user.email || req.user.id)) || 'admin';
    }
    if (next.status === PUBLICATION_STATES.published && !next.publishedAt) {
      next.publishedAt = now;
    }
    if (next.status !== PUBLICATION_STATES.published) {
      next.publishedAt = null;
    }

    if (existing) {
      await dbUnified.updateOne(COLLECTIONS.locationPages, { locationSlug: city.slug }, next);
    } else {
      await dbUnified.insertOne(COLLECTIONS.locationPages, {
        id: dbUnified.uid ? dbUnified.uid() : `locpage_${city.slug}`,
        createdAt: now,
        ...next,
      });
    }

    // The public pages hold a short read cache; an editor must see their own
    // publish immediately rather than up to a minute later.
    if (locationRoutes && typeof locationRoutes.resetLocationDataCache === 'function') {
      locationRoutes.resetLocationDataCache();
    }

    await recordAudit(req, 'location_page_updated', {
      locationSlug: city.slug,
      status: next.status,
      indexingRequested: next.indexingRequested,
      markReviewed: body.markReviewed === true,
    });

    const data = await loadGateInputs();
    return res.json({ success: true, data: describeCity(city, data) });
  } catch (error) {
    logger.error('Could not update a location page:', error);
    return res.status(500).json({ success: false, error: 'Failed to update location page' });
  }
});

module.exports = router;
module.exports.__internal = { buildWarnings, cleanFaqs, cleanSections, cleanText, describeCity };
