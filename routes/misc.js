/**
 * Miscellaneous Routes (reduced)
 *
 * Historical note: this file used to be a grab-bag of captcha, contact, maintenance,
 * and CSP endpoints. In Effort 3.1 those were split into dedicated route modules
 * (`routes/captcha.js`, `routes/contact.js`, `routes/maintenance.js`, `routes/csp.js`).
 * Only the venues proximity search remains here; it doesn't clearly belong to any
 * of the other modules and a dedicated `routes/venues.js` is a larger refactor.
 */

'use strict';

const express = require('express');
const QRCode = require('qrcode');
const logger = require('../utils/logger');
const { stripPublicSupplierPrivateFields } = require('../utils/supplierPublicProfile');
const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let geocoding;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Misc routes: dependencies object is required');
  }

  const required = ['dbUnified', 'geocoding'];
  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Misc routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  geocoding = deps.geocoding;
}

// ---------- Same-origin QR helper ----------

router.get('/tools/qr.png', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '')
      .trim()
      .slice(0, 500);
    const origin = `${req.protocol}://${req.get('host')}`;
    const url = new URL(rawUrl, origin);

    if (url.origin !== origin || !url.pathname.startsWith('/wedding/')) {
      return res
        .status(400)
        .json({ error: 'QR codes are only available for EventFlow wedding links.' });
    }

    const png = await QRCode.toBuffer(url.toString(), {
      errorCorrectionLevel: 'M',
      margin: 1,
      type: 'png',
      width: 256,
    });

    res.set({
      'Cache-Control': 'private, max-age=300',
      'Content-Type': 'image/png',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(png);
  } catch (error) {
    logger.warn('QR generation failed:', error.message);
    return res.status(400).json({ error: 'Unable to generate QR code.' });
  }
});

// ---------- Venues Proximity Search ----------

router.get('/venues/near', async (req, res) => {
  try {
    const { location, radiusMiles = 10 } = req.query;

    // Get all approved Venues category suppliers
    let venues = (await dbUnified.read('suppliers'))
      .filter(s => s.approved && s.category === 'Venues')
      .map(stripPublicSupplierPrivateFields);

    // If no location provided, return all venues
    if (!location || location.trim() === '') {
      // Add distance as null for all venues
      venues = venues.map(v => ({ ...v, distance: null }));

      return res.json({
        venues,
        total: venues.length,
        filtered: false,
        message: 'Showing all venues (no location filter)',
      });
    }

    // Try to geocode the location
    const coords = await geocoding.geocodeLocation(location);

    if (!coords) {
      // Could not geocode - return all venues with a warning
      venues = venues.map(v => ({ ...v, distance: null }));

      return res.json({
        venues,
        total: venues.length,
        filtered: false,
        radiusMiles: parseFloat(radiusMiles) || 10,
        warning: `Could not find location "${location}". Showing all venues.`,
      });
    }

    // Filter venues by proximity
    const radius = parseFloat(radiusMiles) || 10;

    // Calculate distance for each venue that has coordinates
    const venuesWithDistance = venues
      .map(venue => {
        if (
          venue.latitude !== null &&
          venue.latitude !== undefined &&
          venue.longitude !== null &&
          venue.longitude !== undefined
        ) {
          const distance = geocoding.calculateDistance(
            coords.latitude,
            coords.longitude,
            venue.latitude,
            venue.longitude
          );
          return { ...venue, distance };
        }
        // Venue without coordinates - exclude from proximity filter
        return null;
      })
      .filter(v => v !== null);

    // Filter by radius
    const nearbyVenues = venuesWithDistance.filter(v => v.distance <= radius);

    // Sort by distance
    nearbyVenues.sort((a, b) => a.distance - b.distance);

    res.json({
      venues: nearbyVenues,
      total: nearbyVenues.length,
      filtered: true,
      location: location,
      coordinates: coords,
      radiusMiles: radius,
      message: `Found ${nearbyVenues.length} venues within ${radius} miles of ${location}`,
    });
  } catch (error) {
    logger.error('Venue proximity search error:', error);
    res.status(500).json({
      error: 'Failed to search venues',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
