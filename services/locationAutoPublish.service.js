/**
 * EventFlow UK locations — automatic publication
 *
 * A city page needs no editorial copy to be genuinely useful: its supplier
 * list, packages, events and hero photograph are all already assembled from
 * real platform data (see `locationPage.service.js` and
 * `locationHeroImage.service.js`). The one thing standing between a city and
 * being reachable was a human remembering to flip its status in the admin
 * screen. This service does that automatically, on a schedule, for any city
 * nobody has looked at yet — so coverage keeps pace with real supplier growth
 * without manual upkeep.
 *
 * Two safety nets keep this from overriding editorial judgement:
 *  - a city an admin has ever saved through the admin editor is marked
 *    `managedBy: 'admin'` and is never touched by automation again, even if
 *    it is still in draft;
 *  - automation only ever publishes a page (making it reachable and listed on
 *    the hub); it never requests indexing. A person still has to look at a
 *    city and flip that switch before search engines can find it — the
 *    thin/duplicate-content risk of putting dozens of automatically composed
 *    pages in front of Google unreviewed is not one this service takes.
 */

'use strict';

const schedule = require('node-schedule');

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const backgroundJobs = require('./backgroundJobTelemetry.service');
const schedulerLock = require('./schedulerLock.service');
const { runScheduledJob, runIfMissed } = require('./scheduledJobRunner');
const registry = require('./locationRegistry.service');
const supplierLocation = require('./supplierLocation.service');
const locationPages = require('./locationPage.service');
const { isPublicSupplier } = require('./publicSupplierSeo.service');
const { COLLECTIONS, PUBLICATION_STATES } = require('../models/LocationContent');

/** Matches the "fewer than three suppliers" warning the admin screen already shows. */
const MIN_SUPPLIERS_TO_PUBLISH = 3;

const MANAGED_BY_AUTOMATION = 'automation';
const DEFAULT_CRON = '30 3 * * *';
const EXPECTED_INTERVAL_MS = 24 * 60 * 60 * 1000;

let promotionRunning = false;

/**
 * Publish every registry city that has real supplier coverage and has never
 * been touched by an admin.
 * @param {Object} [options] Dependencies.
 * @param {Object} [options.db] Database handle.
 * @param {Object} [options.log] Logger.
 * @param {Date} [options.now] Current time.
 * @returns {Promise<{checked: number, promoted: number, promotedSlugs: string[], skipped: boolean}>} Result.
 */
async function promoteEligibleCities({ db = dbUnified, log = logger, now = new Date() } = {}) {
  if (promotionRunning) {
    return { checked: 0, promoted: 0, promotedSlugs: [], skipped: true };
  }

  promotionRunning = true;
  try {
    const [suppliers, users, records] = await Promise.all([
      db.read('suppliers'),
      db.read('users'),
      locationPages.loadPageRecords(db),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
    const publicSuppliers = (suppliers || []).filter(supplier =>
      isPublicSupplier(supplier, validOwnerIds)
    );
    const nowIso = now.toISOString();
    const cities = registry.listCities();

    let promoted = 0;
    const promotedSlugs = [];

    for (const city of cities) {
      const existing = records.get(city.slug);

      // A city a human has ever saved through the admin editor belongs to
      // them from then on, whatever its status — automation only ever acts on
      // a city nobody has looked at yet.
      if (existing && existing.managedBy !== MANAGED_BY_AUTOMATION) {
        continue;
      }
      // Automation never re-processes a city it has already published, and
      // never demotes one whose supplier coverage later dips.
      if (existing && existing.status !== PUBLICATION_STATES.draft) {
        continue;
      }

      const rankedSuppliers = supplierLocation.rankSuppliersForCity(publicSuppliers, city, {
        validOwnerIds,
      });
      if (rankedSuppliers.length < MIN_SUPPLIERS_TO_PUBLISH) {
        continue;
      }

      const next = {
        locationSlug: city.slug,
        status: PUBLICATION_STATES.published,
        managedBy: MANAGED_BY_AUTOMATION,
        // Indexing stays a human decision; see the module comment.
        indexingRequested: false,
        publishedAt: (existing && existing.publishedAt) || nowIso,
        updatedAt: nowIso,
      };

      if (existing) {
        await db.updateOne(COLLECTIONS.locationPages, { locationSlug: city.slug }, next);
      } else {
        await db.insertOne(COLLECTIONS.locationPages, {
          id: db.uid ? db.uid() : `locpage_${city.slug}`,
          createdAt: nowIso,
          ...next,
        });
      }

      promoted += 1;
      promotedSlugs.push(city.slug);
    }

    if (promoted > 0) {
      log.info(
        `[location-auto-publish] Published ${promoted} city page(s): ${promotedSlugs.join(', ')}`
      );
    }

    return { checked: cities.length, promoted, promotedSlugs, skipped: false };
  } finally {
    promotionRunning = false;
  }
}

/**
 * Schedule the automatic publication run.
 * @param {Object} [options] Dependencies, mirroring the review-request maintenance scheduler.
 * @returns {{scheduled: boolean, cronExpr: string|null, nextRun: Date|null}} Schedule result.
 */
function scheduleAutoPublish({ db = dbUnified, log = logger, scheduleModule = schedule } = {}) {
  const enabledValue = process.env.LOCATION_AUTO_PUBLISH_ENABLED;
  const enabled =
    enabledValue === undefined
      ? process.env.NODE_ENV === 'production'
      : enabledValue !== 'false' && enabledValue !== '0';

  if (!enabled) {
    log.info('[location-auto-publish] Scheduler disabled');
    return { scheduled: false, cronExpr: null, nextRun: null };
  }

  const cronExpr = process.env.LOCATION_AUTO_PUBLISH_CRON || DEFAULT_CRON;
  const runOnce = () => promoteEligibleCities({ db, log });
  const runTracked = () =>
    schedulerLock.withLock(backgroundJobs.JOB_KEYS.LOCATION_AUTO_PUBLISH, () =>
      runScheduledJob(backgroundJobs.JOB_KEYS.LOCATION_AUTO_PUBLISH, runOnce, { db, log })
    );

  // Pinned explicitly rather than relying on the container's default timezone.
  const job = scheduleModule.scheduleJob({ rule: cronExpr, tz: 'Etc/UTC' }, runTracked);

  if (!job) {
    log.error('[location-auto-publish] Invalid cron:', cronExpr);
    return { scheduled: false, cronExpr, nextRun: null };
  }

  // Publishing is idempotent (never re-processes a city it already
  // published or demotes one whose coverage later dips), so it's safe to
  // catch up on every boot if a scheduled tick was genuinely missed.
  setImmediate(() =>
    schedulerLock.withLock(backgroundJobs.JOB_KEYS.LOCATION_AUTO_PUBLISH, () =>
      runIfMissed(backgroundJobs.JOB_KEYS.LOCATION_AUTO_PUBLISH, runOnce, {
        expectedIntervalMs: EXPECTED_INTERVAL_MS,
        db,
        log,
      })
    )
  );

  const nextRun = job.nextInvocation();
  log.info(
    `[location-auto-publish] Scheduled: cron="${cronExpr}", nextRun=${
      nextRun ? nextRun.toISOString() : 'unknown'
    }`
  );
  return { scheduled: true, cronExpr, nextRun };
}

/**
 * Schedule the job and report the outcome in the same startup-banner style
 * `server.js` uses for its other schedulers.
 *
 * This exists so that reporting logic — what gets logged for a scheduled run
 * versus a disabled one — is a plain, directly testable function, rather than
 * inline branching inside `server.js`'s startup sequence, which nothing ever
 * exercises in a test.
 * @param {Object} [options] Forwarded to `scheduleAutoPublish`.
 * @returns {{scheduled: boolean, cronExpr: string|null, nextRun: Date|null}} Schedule result.
 */
function logSchedulerStartup(options = {}) {
  const log = options.log || logger;
  log.info('');
  log.info('📍 Initializing Location Auto-Publish Scheduler...');
  const result = scheduleAutoPublish(options);

  if (result.scheduled) {
    log.info('   ✅ Location auto-publish scheduled');
    log.info(`   ✅ Cron: ${result.cronExpr}`);
    if (result.nextRun) {
      log.info(`   ⏰ Next run: ${result.nextRun.toISOString()}`);
    }
  } else {
    log.info('   ℹ️  Location auto-publish scheduler disabled');
    log.info('   Set LOCATION_AUTO_PUBLISH_ENABLED=true to enable');
  }

  return result;
}

module.exports = {
  DEFAULT_CRON,
  MANAGED_BY_AUTOMATION,
  MIN_SUPPLIERS_TO_PUBLISH,
  logSchedulerStartup,
  promoteEligibleCities,
  scheduleAutoPublish,
};
