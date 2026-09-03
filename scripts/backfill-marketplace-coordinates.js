/**
 * Backfill script: Geocode existing marketplace listings that have a location
 * string but are missing locationCoordinates.
 *
 * Usage:
 *   node scripts/backfill-marketplace-coordinates.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Show what would be updated without writing to the database
 *   --limit N   Process at most N listings (default: all)
 *
 * Requirements:
 *   - MONGODB_URI environment variable (or .env file)
 *   - Network access to postcodes.io for UK postcode geocoding
 *
 * Notes:
 *   - Rate-limited to 10 requests per second to respect postcodes.io limits
 *   - Skips listings that already have locationCoordinates
 *   - Skips listings with no location string
 *   - Non-fatal: listings that cannot be geocoded are skipped with a warning
 */

'use strict';

const { MongoClient } = require('mongodb');
require('dotenv').config();

const RATE_LIMIT_MS = 100; // 100ms between geocode requests (10 req/s)
const POSTCODES_IO_BASE = 'https://api.postcodes.io';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

const logger = {
  info: (...a) => console.log('[INFO]', ...a),
  warn: (...a) => console.warn('[WARN]', ...a),
  error: (...a) => console.error('[ERROR]', ...a),
};

/**
 * Pause execution for the given number of milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Geocode a UK postcode using postcodes.io
 * @param {string} postcode
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocodePostcode(postcode) {
  const normalized = postcode.replace(/\s/g, '').toUpperCase();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `${POSTCODES_IO_BASE}/postcodes/${encodeURIComponent(normalized)}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 200 && data.result) {
      return { lat: data.result.latitude, lng: data.result.longitude };
    }

    return null;
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn(`Geocoding timeout for: ${postcode}`);
    } else {
      logger.warn(`Geocoding error for ${postcode}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Attempt to geocode a location string (postcode or free text)
 * @param {string} location
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
function geocodeLocation(location) {
  if (!location || typeof location !== 'string') {
    return null;
  }

  const trimmed = location.trim();
  if (!trimmed) {
    return null;
  }

  // Try as postcode (postcodes.io is flexible)
  const postcodePattern = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  if (postcodePattern.test(trimmed)) {
    return geocodePostcode(trimmed);
  }

  // Try anyway in case it's a partial postcode district or area
  return geocodePostcode(trimmed);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    logger.error('MONGODB_URI environment variable is required');
    process.exit(1);
  }

  logger.info(`Starting marketplace coordinates backfill${isDryRun ? ' (DRY RUN)' : ''}...`);
  if (limit > 0) {
    logger.info(`Processing at most ${limit} listings`);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('marketplace_listings');

    // Find listings with a location string but missing locationCoordinates
    const query = {
      location: { $exists: true, $nin: ['', null] },
      $or: [
        { locationCoordinates: { $exists: false } },
        { locationCoordinates: null },
        { 'locationCoordinates.lat': { $exists: false } },
      ],
    };

    const cursor = collection.find(query);
    const total = await collection.countDocuments(query);

    logger.info(`Found ${total} listing(s) without locationCoordinates`);

    if (total === 0) {
      logger.info('Nothing to backfill. All listings already have coordinates.');
      return;
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for await (const listing of cursor) {
      if (limit > 0 && processed >= limit) {
        logger.info(`Reached limit of ${limit} listings. Stopping.`);
        break;
      }

      processed++;
      const location = listing.location;

      logger.info(
        `[${processed}/${total}] Processing listing ${listing.id || listing._id}: "${location}"`
      );

      // Rate limiting
      if (processed > 1) {
        await sleep(RATE_LIMIT_MS);
      }

      const coords = await geocodeLocation(location);

      if (!coords) {
        logger.warn(`  Could not geocode "${location}" — skipping`);
        skipped++;
        continue;
      }

      logger.info(`  → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);

      if (isDryRun) {
        updated++;
        continue;
      }

      try {
        await collection.updateOne({ _id: listing._id }, { $set: { locationCoordinates: coords } });
        updated++;
      } catch (err) {
        logger.error(`  Failed to update listing ${listing._id}: ${err.message}`);
        failed++;
      }
    }

    logger.info('');
    logger.info('=== Backfill complete ===');
    logger.info(`Processed : ${processed}`);
    logger.info(`Updated   : ${updated}${isDryRun ? ' (dry run — no writes)' : ''}`);
    logger.info(`Skipped   : ${skipped} (could not geocode)`);
    logger.info(`Failed    : ${failed} (database write errors)`);
  } finally {
    await client.close();
  }
}

run().catch(err => {
  logger.error('Unhandled error:', err.message);
  process.exit(1);
});
